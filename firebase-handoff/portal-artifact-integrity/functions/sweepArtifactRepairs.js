/**
 * Release 2a · B — artifact self-heal sweep.
 *
 * Drains `artifact_repair_queue` (rows enqueued by auditArtifactCoverage and by
 * the read path's on-miss backstop): re-fetches each document's printable from
 * Elation, stores it at the recorded path, verifies the bytes, and marks the row
 * repaired. Healing is STORAGE-ONLY — it never touches portalAccess, so a healed
 * artifact for a hidden item or a suspended patient stays unreadable. The read
 * path is the only place suppression is decided.
 *
 * 2026-08-30 — LARGE-TAIL AMENDMENT
 * ---------------------------------
 * #462 lowered the backfill's artifact ceiling and added an artifact sub-budget,
 * so heavy patients now DEFER artifacts to this sweep instead of failing them.
 * That pushes a multi-thousand-row tail here, and a nightly cron capped at 100
 * rows would take ~20 nights to drain it. This file therefore gains, without
 * inventing any new mechanism:
 *
 *   1. An admin-invokable HTTP arm (`adminRunArtifactRepairSweep`) on the SAME
 *      code path as the cron — the operator console can drive bounded, on-demand
 *      passes. The 03:45 cron is unchanged and still runs.
 *   2. The #460 run-level durability model, copied field-for-field from
 *      backfillElationReportsHttp: run doc + lease + 30s heartbeat +
 *      soft-budget pause + resume/reclaim + operator reset — plus the #462
 *      per-item instance-cap start guard, so a run spans the 540s gen1 cap
 *      safely and is resumed by re-POSTing the same runId.
 *   3. The #461 Elation throttle. Every printable fetch goes through
 *      `uploadArtifact` REQUIRED FROM backfillElationReports — that is the ONE
 *      process-wide gate (ELATION_MAX_INFLIGHT, default 3, + pacing + retry with
 *      abortable backoff), not a second copy. A sweep and a backfill sharing an
 *      instance therefore share the ceiling instead of doubling it.
 *
 * Queue contract: rows are idempotent by key (`<patientId>:<documentId>`).
 * `repairedAt != null` rows are excluded by the query, so a re-run never
 * re-fetches what is already present, and the cursor only ever moves forward.
 *
 * Alerting: parked rows (MAX_FAILURES consecutive failures) are counted on the
 * run doc and reported ONCE PER RUN as a single aggregated log line with a
 * sample — never one alert per row, which at a 2,000-row tail would page
 * hundreds of times.
 *
 * MEMORY: printables are buffered (the shared Elation client exposes no stream).
 * Unlike the backfill, this job sits continuously at the artifact ceiling, so it
 * runs at 1GB — with ELATION_MAX_INFLIGHT <= 3 the steady-state resident set is
 * at most 3 buffered PDFs (~16MB worst case each ≈ 50MB) plus the runtime, which
 * leaves ample headroom. Do NOT raise ELATION_MAX_INFLIGHT above 3.
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { requireAdminCaller, selfAudience } = require('./middleware/requireAdminCaller');
const { artifactBucketName } = require('./core/config/artifactBucket');
// THE SHARED THROTTLE. Requiring these (rather than re-implementing a fetch)
// is what guarantees one gate process-wide.
const {
  uploadArtifact,
  verifyPdfHeader,
  withPatientDeadline,
  abortElationBackoff,
} = require('./backfillElationReports');

const REGION = 'us-central1';
const QUEUE_COLLECTION = 'artifact_repair_queue';
const RUNS_COLLECTION = 'artifact_repair_runs';
const AUDIT_COLLECTION = 'artifact_repair_audit';

const BATCH_LIMIT = Math.max(1, Number(process.env.ARTIFACT_SWEEP_CRON_LIMIT || 100)); // cron pass
const MAX_ITEMS = Math.max(1, Number(process.env.ARTIFACT_SWEEP_MAX_ITEMS || 5000));   // hard cap per run
const CHUNK_SIZE = Math.max(1, Math.min(200, Number(process.env.ARTIFACT_SWEEP_CHUNK || 25)));
const MAX_FAILURES = 5;

// Per-item wall-clock budget. One item = one printable fetch + save + verify;
// #462 put the artifact ceiling at 60s with 1 attempt, so 120s covers the fetch,
// the GCS save and the ranged verify with room to spare.
const ITEM_BUDGET_MS = Math.max(10000, Number(process.env.ARTIFACT_SWEEP_ITEM_BUDGET_MS || 120000));
// #462 instance-cap start guard. An item is only STARTED when its whole budget
// fits before the instance deadline, so a SIGKILL can never land mid-item.
// The override may only RAISE it: setting it BELOW ITEM_BUDGET_MS would let an
// item start with less headroom than it can consume and be killed at the cap,
// which is the exact failure the guard exists to prevent.
const ITEM_START_BUDGET_MS = Math.max(
  ITEM_BUDGET_MS,
  Number(process.env.ARTIFACT_SWEEP_ITEM_START_BUDGET_MS || ITEM_BUDGET_MS),
);

const INSTANCE_MAX_MS = 540 * 1000;   // must match runWith.timeoutSeconds
const SOFT_BUDGET_MS = 500 * 1000;    // stop starting new chunks here
const FINALIZE_RESERVE_MS = Math.max(0, Number(process.env.ARTIFACT_SWEEP_FINALIZE_RESERVE_MS || 25000));
const LEASE_TTL_MS = 120 * 1000;
const HEARTBEAT_MS = 30 * 1000;
const INSTANCE_ID = `${process.env.K_REVISION || 'local'}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Transient upstream statuses: back the run off, never park the document. */
const TRANSIENT = new Set([429, 500, 502, 503, 504]);

const db = () => admin.firestore();
const stateRef = () => db().collection('artifact_repair_state');

function bucket() {
  // Never bare: heals must land in the bucket the read path serves from.
  return admin.storage().bucket(artifactBucketName());
}

function leaseIsLive(run) {
  const exp = Number(run && run.leaseExpiresAt) || 0;
  if (!exp) return false;
  return exp > Date.now();
}

// ---- global circuit breaker (unchanged semantics) --------------------------
async function readStatus() {
  const snap = await stateRef().doc('status').get();
  return snap.exists ? snap.data() : { paused: false };
}

async function pauseGlobal(reason, requires) {
  await stateRef().doc('status').set(
    { paused: true, reason, requires: requires || null, pausedAt: new Date().toISOString() },
    { merge: true },
  );
  functions.logger.error('artifact sweep paused', { reason, requires });
}

async function resumeGlobal() {
  await stateRef().doc('status').set(
    { paused: false, reason: null, requires: null, resumedAt: new Date().toISOString() },
    { merge: true },
  );
}

/**
 * Repair one queue row. Returns 'healed' | 'failed' | 'deferred' | 'blocked'.
 *
 * The fetch runs inside `withPatientDeadline`, which is what gives the shared
 * gate's retry logic a budget to charge against, and inside the #462 artifact
 * sub-budget accounting — the same code the backfill uses.
 */
async function repairOne(row, ref, tally) {
  try {
    const file = bucket().file(row.path);
    await withPatientDeadline(Date.now() + ITEM_BUDGET_MS, async () => {
      await uploadArtifact(file, row.documentId);
      // A successful save does not prove valid bytes: a corrupt source would be
      // stored and counted present by the next audit — a false green.
      await verifyPdfHeader(file);
    }).catch(async (err) => {
      // Never leave a bad object behind for the audit to count as coverage.
      await file.delete({ ignoreNotFound: true }).catch(() => {});
      throw err;
    });

    await ref.set(
      { repairedAt: new Date().toISOString(), failures: row.failures || 0, parked: false },
      { merge: true },
    );
    await db().collection(AUDIT_COLLECTION).add({
      at: new Date().toISOString(),
      action: 'healed',
      patientId: row.patientId,
      documentId: row.documentId,
      path: row.path,
      source: row.source || 'sweep',
    });
    return 'healed';
  } catch (err) {
    const status = Number.isFinite(Number(err && err.elationStatus))
      ? Number(err.elationStatus)
      : (err && err.status) || null;

    if (status === 402 || status === 403) {
      await pauseGlobal(
        `Elation/upstream returned ${status}`,
        status === 402 ? 'top_up' : 'admin_action',
      );
      return 'blocked';
    }
    if (TRANSIENT.has(status) || (err && err.reason === 'ELATION_RATE_LIMITED')) {
      await ref.set(
        { lastError: `transient ${status}`, updatedAt: new Date().toISOString() },
        { merge: true },
      );
      functions.logger.warn('artifact sweep: transient upstream, deferring run', {
        status, documentId: row.documentId,
      });
      return 'deferred';
    }

    const failures = (row.failures || 0) + 1;
    const parked = failures >= MAX_FAILURES;
    await ref.set(
      { failures, parked, lastError: String(err && err.reason ? err.reason : err && err.message).slice(0, 200), updatedAt: new Date().toISOString() },
      { merge: true },
    );
    await db().collection(AUDIT_COLLECTION).add({
      at: new Date().toISOString(),
      action: parked ? 'parked' : 'failed',
      patientId: row.patientId,
      documentId: row.documentId,
      path: row.path,
      error: String(err && err.reason ? err.reason : err && err.message).slice(0, 200),
    });
    if (parked && tally) {
      // AGGREGATED, not per-row: collected here and emitted ONCE at the end of
      // the run (see emitParkedAlert).
      tally.parked += 1;
      if (tally.parkedSample.length < 10) tally.parkedSample.push(row.documentId);
    }
    return 'failed';
  }
}

function emitParkedAlert(runId, tally) {
  if (!tally || !tally.parked) return;
  // ONE line per run. Point the log-based alert policy at this jsonPayload
  // marker (`artifact-repair-parked-summary`), never at the per-row rows.
  functions.logger.error('artifact-repair-parked-summary', {
    runId,
    parked: tally.parked,
    sampleDocumentIds: tally.parkedSample,
    note: 'aggregated per run — see artifact_repair_audit for the full set',
  });
}

/** Count of rows still needing repair (observability, cheap aggregate). */
async function remainingCount() {
  try {
    const agg = await db()
      .collection(QUEUE_COLLECTION)
      .where('repairedAt', '==', null)
      .where('parked', '==', false)
      .count()
      .get();
    return Number(agg.data().count) || 0;
  } catch (e) {
    return null; // count() unavailable on older SDKs — not worth failing a run
  }
}

/**
 * Drive one sweep run to completion, a pause, or the item cap.
 *
 * Cursor model: repaired and parked rows fall OUT of the query, so the cursor
 * (last visited doc id) only has to skip rows that failed-but-are-not-parked
 * this run. Re-running is therefore always safe and never re-fetches a present
 * artifact — exactly the queue contract the audit relies on.
 */
async function driveRun(runId, opts) {
  const options = opts || {};
  const startedAtMs = Date.now();
  const FieldValue = admin.firestore.FieldValue;
  const runRef = db().collection(RUNS_COLLECTION).doc(runId);

  const snap = await runRef.get();
  const run = snap.exists ? snap.data() || {} : {};
  const maxItems = Math.max(1, Math.min(MAX_ITEMS, Number(options.maxItems || run.maxItems || MAX_ITEMS)));
  const probeOnly = options.probeOnly === true;

  let cursor = run.cursor || null;
  let processed = Number(run.processed) || 0;
  const tally = {
    healed: Number((run.counters || {}).healed) || 0,
    failed: Number((run.counters || {}).failed) || 0,
    deferred: Number((run.counters || {}).deferred) || 0,
    parked: 0,
    parkedSample: [],
  };

  await runRef.set({
    runId,
    status: 'running',
    startedAt: FieldValue.serverTimestamp(),
    leaseOwner: INSTANCE_ID,
    leaseExpiresAt: Date.now() + LEASE_TTL_MS,
    cycles: FieldValue.increment(1),
    maxItems,
    probeOnly,
  }, { merge: true });

  const renewLease = () => ({ leaseOwner: INSTANCE_ID, leaseExpiresAt: Date.now() + LEASE_TTL_MS });

  let heartbeat = setInterval(() => {
    runRef.set(renewLease(), { merge: true })
      .catch((e) => functions.logger.error('artifact sweep heartbeat failed', e));
  }, HEARTBEAT_MS);
  if (heartbeat && typeof heartbeat.unref === 'function') heartbeat.unref();
  const stopHeartbeat = () => { if (heartbeat) { clearInterval(heartbeat); heartbeat = null; } };

  // Break any pending Elation backoff at the soft boundary so the run reaches
  // its pause write with the cursor intact instead of dying inside a sleep.
  let brake = setTimeout(() => {
    try { abortElationBackoff(); } catch (e) { /* best effort */ }
  }, Math.max(0, SOFT_BUDGET_MS - (Date.now() - startedAtMs)));
  if (brake && typeof brake.unref === 'function') brake.unref();
  const stopBrake = () => { if (brake) { clearTimeout(brake); brake = null; } };

  const instanceDeadlineAt = startedAtMs + INSTANCE_MAX_MS - FINALIZE_RESERVE_MS;

  const finish = async (status, pauseReason) => {
    stopHeartbeat(); stopBrake();
    emitParkedAlert(runId, tally);
    const remaining = await remainingCount();
    await runRef.set({
      status,
      pauseReason: pauseReason || null,
      cursor,
      processed,
      counters: { healed: tally.healed, failed: tally.failed, deferred: tally.deferred },
      parkedThisRun: tally.parked,
      remaining,
      leaseOwner: null,
      leaseExpiresAt: 0,
      updatedAt: FieldValue.serverTimestamp(),
      ...(status === 'complete' ? { finishedAt: FieldValue.serverTimestamp() } : {}),
      ...(status === 'paused' ? { pausedAt: FieldValue.serverTimestamp() } : {}),
    }, { merge: true });
    return {
      runId, status, pauseReason: pauseReason || null, processed, remaining,
      healed: tally.healed, failed: tally.failed, deferred: tally.deferred, parked: tally.parked,
    };
  };

  try {
    while (processed < maxItems) {
      if (Date.now() - startedAtMs >= SOFT_BUDGET_MS) {
        return await finish('paused', 'SOFT_BUDGET_REACHED');
      }

      let q = db().collection(QUEUE_COLLECTION)
        .where('repairedAt', '==', null)
        .where('parked', '==', false)
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(Math.min(CHUNK_SIZE, maxItems - processed));
      if (cursor) q = q.startAfter(cursor);
      const page = await q.get();
      if (page.empty) return await finish('complete', null);

      for (const doc of page.docs) {
        // #462 start guard, per ITEM: never begin work that could outlive the cap.
        if (Date.now() + ITEM_START_BUDGET_MS > instanceDeadlineAt) {
          return await finish('paused', 'INSTANCE_BUDGET_REACHED');
        }
        const outcome = await repairOne(doc.data() || {}, doc.ref, tally);
        cursor = doc.id;
        processed += 1;

        if (outcome === 'healed') tally.healed += 1;
        else if (outcome === 'deferred') tally.deferred += 1;
        else if (outcome !== 'blocked') tally.failed += 1;

        // Durable per-item checkpoint: a kill after this loses no progress.
        await runRef.set({
          cursor,
          processed,
          counters: { healed: tally.healed, failed: tally.failed, deferred: tally.deferred },
          lastItemAt: FieldValue.serverTimestamp(),
          ...renewLease(),
        }, { merge: true });

        if (outcome === 'blocked') return await finish('paused', 'UPSTREAM_BLOCKED');
        if (outcome === 'deferred') return await finish('paused', 'UPSTREAM_TRANSIENT');
        if (probeOnly) break;
      }

      if (probeOnly) break;
    }

    return await finish(processed >= maxItems ? 'paused' : 'complete',
      processed >= maxItems ? 'MAX_ITEMS_REACHED' : null);
  } catch (e) {
    stopHeartbeat(); stopBrake();
    functions.logger.error('artifact sweep run failed', e);
    emitParkedAlert(runId, tally);
    await runRef.set({
      status: 'error',
      // Never echo error text verbatim into a stored doc — it can embed PHI.
      errorReason: String((e && e.reason) || (e && e.code) || 'RUN_FAILED').slice(0, 120),
      cursor,
      processed,
      counters: { healed: tally.healed, failed: tally.failed, deferred: tally.deferred },
      leaseOwner: null,
      leaseExpiresAt: 0,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { runId, status: 'error', processed };
  } finally {
    stopHeartbeat(); stopBrake();
  }
}

/**
 * The nightly pass. Same code path as the manual arm — it just claims a
 * date-keyed run id and a small item cap, and honours the global pause with a
 * single probe item.
 */
async function sweep() {
  const status = await readStatus();
  const probeOnly = status.paused === true;
  const runId = `cron-${new Date().toISOString().slice(0, 10)}`;

  const existing = await db().collection(RUNS_COLLECTION).doc(runId).get();
  if (existing.exists && leaseIsLive(existing.data())) {
    functions.logger.info('artifact sweep: another run holds the lease, exiting');
    return { skipped: true };
  }

  const out = await driveRun(runId, { maxItems: probeOnly ? 1 : BATCH_LIMIT, probeOnly });
  // A successful probe while paused clears the global pause; a denied one keeps it.
  if (probeOnly && out.healed > 0) await resumeGlobal();
  return { probeOnly, ...out };
}

exports.sweepArtifactRepairs = functions
  .region(REGION)
  .runWith({ timeoutSeconds: 540, memory: '1GB', secrets: ['ELATION_CLIENT_ID', 'ELATION_CLIENT_SECRET'] })
  .pubsub.schedule('45 3 * * *')
  .timeZone('America/New_York')
  .onRun(async () => {
    const out = await sweep();
    functions.logger.info('artifact sweep complete', out);
    return null;
  });

// ---------------------------------------------------------------------------
// ADMIN-INVOKABLE ARM
//
// Same caller gate as every other admin function (`requireAdminCaller` +
// `selfAudience`), and the export name below MUST be added to ADMIN_FUNCTIONS in
// deploy-production.yml so the post-deploy step strips `allUsers`. The human
// super_admin check lives one layer up, in the portal-admin edge function, which
// is the only caller and which writes the audit row before invoking (same
// contract as backfillElationReports).
//
// Actions: 'start' (default), 'status', 'reset' — deliberately identical in
// shape to the backfill wrapper so the upcoming auto-resume driver can drive
// both loops with one implementation: POST -> poll status -> if
// `resumable && status !== 'complete'`, re-POST the same runId; stop when
// `status === 'complete' && remaining === 0`.
// ---------------------------------------------------------------------------
function jsonError(res, status, code, reason) {
  return res.status(status).json({
    error: { code: status, status: code, message: reason, details: { reason } },
  });
}

exports.adminRunArtifactRepairSweep = functions
  .region(REGION)
  .runWith({
    timeoutSeconds: 540,
    memory: '1GB',
    secrets: ['ELATION_CLIENT_ID', 'ELATION_CLIENT_SECRET'],
  })
  .https.onRequest(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
      res.set('Allow', 'POST');
      return jsonError(res, 405, 'FAILED_PRECONDITION', 'METHOD_NOT_ALLOWED');
    }
    const gate = await requireAdminCaller(req, selfAudience(req, 'adminRunArtifactRepairSweep'));
    if (!gate.ok) return jsonError(res, gate.status, 'PERMISSION_DENIED', gate.reason);

    let body;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    } catch (e) {
      return jsonError(res, 400, 'INVALID_ARGUMENT', 'MALFORMED_BODY');
    }

    const action = String(body.action || 'start');
    const actor = String(body.actor || '').slice(0, 320) || 'unknown';
    const reason = String(body.reason || '').slice(0, 500);

    // ---- status poll -----------------------------------------------------
    if (action === 'status') {
      const runId = String(body.runId || '').trim();
      if (!/^[A-Za-z0-9_-]{6,64}$/.test(runId)) {
        return jsonError(res, 400, 'INVALID_ARGUMENT', 'MALFORMED_RUN_ID');
      }
      const snap = await db().collection(RUNS_COLLECTION).doc(runId).get();
      if (!snap.exists) return jsonError(res, 404, 'NOT_FOUND', 'NO_SUCH_RUN');
      const d = snap.data() || {};
      const globalStatus = await readStatus();
      return res.status(200).json({
        runId,
        status: d.status || 'unknown',
        processed: Number(d.processed) || 0,
        maxItems: Number(d.maxItems) || null,
        counters: d.counters || {},
        parkedThisRun: Number(d.parkedThisRun) || 0,
        remaining: d.remaining == null ? await remainingCount() : Number(d.remaining),
        cursor: d.cursor || null,
        cycles: Number(d.cycles) || 0,
        pauseReason: d.pauseReason || null,
        errorReason: d.errorReason || null,
        leaseOwner: d.leaseOwner || null,
        leaseExpiresAt: Number(d.leaseExpiresAt) || 0,
        leaseLive: leaseIsLive(d),
        resumable: d.status !== 'complete' && !leaseIsLive(d),
        staleLease: d.status === 'running' && !leaseIsLive(d),
        globalPaused: globalStatus.paused === true,
        globalPauseReason: globalStatus.reason || null,
      });
    }

    // ---- reset (zombie clear) -------------------------------------------
    if (action === 'reset') {
      const runId = String(body.runId || '').trim();
      if (!/^[A-Za-z0-9_-]{6,64}$/.test(runId)) {
        return jsonError(res, 400, 'INVALID_ARGUMENT', 'MALFORMED_RUN_ID');
      }
      if (!reason) return jsonError(res, 400, 'INVALID_ARGUMENT', 'REASON_REQUIRED');
      const runRef = db().collection(RUNS_COLLECTION).doc(runId);
      const snap = await runRef.get();
      if (!snap.exists) return jsonError(res, 404, 'NOT_FOUND', 'NO_SUCH_RUN');
      const d = snap.data() || {};
      if (leaseIsLive(d) && body.force !== true) {
        return res.status(409).json({
          error: { code: 409, status: 'ABORTED', message: 'Run lease is still live', details: { reason: 'LEASE_LIVE', runId } },
        });
      }
      const FieldValue = admin.firestore.FieldValue;
      await runRef.set({
        status: 'paused',
        pauseReason: 'OPERATOR_RESET',
        leaseOwner: null,
        leaseExpiresAt: 0,
        resetBy: actor,
        resetReason: reason,
        resetAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      // The global circuit breaker is separate: clearing it is explicit.
      if (body.clearGlobalPause === true) await resumeGlobal();
      return res.status(200).json({ runId, status: 'paused', reset: true, resumable: true });
    }

    if (action !== 'start') return jsonError(res, 400, 'INVALID_ARGUMENT', 'UNKNOWN_ACTION');

    // ---- start / resume --------------------------------------------------
    if (!reason) return jsonError(res, 400, 'INVALID_ARGUMENT', 'REASON_REQUIRED');
    const FieldValue = admin.firestore.FieldValue;
    const runId = String(body.runId || '').trim() || db().collection(RUNS_COLLECTION).doc().id;
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(runId)) {
      return jsonError(res, 400, 'INVALID_ARGUMENT', 'MALFORMED_RUN_ID');
    }
    const maxItems = Math.max(1, Math.min(MAX_ITEMS, Number(body.maxItems) || MAX_ITEMS));

    const runRef = db().collection(RUNS_COLLECTION).doc(runId);
    const existing = await runRef.get();
    if (existing.exists) {
      const d = existing.data() || {};
      // Only a LIVE lease means genuinely in progress; an expired lease on a
      // 'running' doc means the instance died — reclaim rather than 409 forever.
      if (d.status === 'running' && leaseIsLive(d)) {
        return res.status(409).json({
          error: { code: 409, status: 'ABORTED', message: 'Run already in progress', details: { reason: 'RUN_IN_PROGRESS', runId } },
        });
      }
      if (d.status === 'complete') {
        return res.status(200).json({ runId, status: 'complete', alreadyComplete: true, remaining: await remainingCount() });
      }
      await runRef.set({
        resumedAt: FieldValue.serverTimestamp(),
        actor,
        reason,
        reclaimedFrom: d.status === 'running' ? (d.leaseOwner || 'unknown') : null,
      }, { merge: true });
    } else {
      await runRef.set({
        runId,
        actor,
        reason,
        status: 'claimed',
        maxItems,
        processed: 0,
        cursor: null,
        counters: {},
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    // 202 first, then drain server-side; every item is checkpointed as it
    // finishes, so an instance kill at 540s loses no progress — re-POST runId.
    res.status(202).json({
      started: true,
      async: true,
      runId,
      maxItems,
      remaining: await remainingCount(),
      poll: { action: 'status', runId },
    });

    try {
      const out = await driveRun(runId, { maxItems });
      functions.logger.info('artifact sweep run finished', out);
    } catch (e) {
      functions.logger.error('artifact sweep run threw', e);
    }
  });

exports._sweep = sweep;
exports._driveRun = driveRun;
