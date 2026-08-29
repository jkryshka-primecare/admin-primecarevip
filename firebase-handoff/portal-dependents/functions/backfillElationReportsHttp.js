// functions/backfillElationReportsHttp.js
// Release 2b · Part B — the ONLY HTTP surface for the Elation report ingest.
//
// `backfillElationReports.js` was deliberately runner-only. This wrapper adds an
// HTTP entrypoint so the Prime Care OS operator console can run the ingest
// without a Cloud Shell session, and it is a real attack surface, so it is gated
// harder than the runner ever needed to be:
//
//   1. `requireAdminCaller` — same gate as every other admin function, and the
//      export name below MUST be listed in ADMIN_FUNCTIONS in
//      deploy-production.yml so the post-deploy step strips `allUsers`.
//   2. THE COHORT SET IS THE AUTHORITY. Every id in the request is loaded and
//      re-validated here. The edge function and the UI validate shape; THIS is
//      the check that decides. Anything that fails is returned in `rejected`
//      and never reaches the ingest.
//   3. Dry run by default. `apply: true` must be explicit.
//   4. Hard cap on batch size — a mistake stays small enough to read.
//
// ADULT BACKFILL AMENDMENTS (2026-08-26 go-ahead):
//   * `cohort: 'minors' | 'adults'`, default 'minors'. The minor card is
//     byte-identical when the field is absent.
//       minors -> doc exists && isMinorRecord && ingestEligibility.eligible
//       adults -> doc exists && !isMinorRecord && soft-adult rule
//                 (status absent proceeds; explicit non-active rejects)
//   * `skipExisting`, `storeMedicalRecords`, `excludeReportTypes`, `concurrency`,
//     `chunkSize` pass through to the runner.
//   * Async runId protocol on apply: claim a run doc, return 202 immediately,
//     work server-side, checkpoint per completed id. Poll with
//     `{ action: 'status', runId }`. A timeout resumes by re-POSTing the same
//     runId — the pending list is what remains.
//   * Dry run returns `reportTypeCensus` (distinct report_type, counts, mapped
//     category, unmappedType) for the pre-apply review checkpoint.
//
// Attribution: the caller is always the `portal-admin` service account, so the
// human is recorded upstream in the admin app's `portal_admin_actions` table,
// written BEFORE this function is called. `actor` and `reason` are echoed into
// the run doc and the logs so the two trails can be joined.

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { log, logError } = require('./middleware/logger');
const { requireAdminCaller, selfAudience } = require('./middleware/requireAdminCaller');
const {
  ingestEligibility,
  adultBackfillEligibility,
  isMinorRecord,
} = require('./core/services/patient/ingestEligibility');

// The runner module. It exports its internal batch function; keep this require
// pointing at the REAL file in the repo — this wrapper adds no ingest logic of
// its own on purpose.
const runner = require('./backfillElationReports');

const MAX_IDS = 1000;      // the full adult roster (~972) fits in one claim
const DEFAULT_CHUNK = 40;  // ids per runner invocation (go-ahead item 4)
const DEFAULT_CONCURRENCY = 3; // lowered 2026-08-29: Elation throttling under sustained load
const RUNS_COLLECTION = 'backfill_runs';

// ---- RUN-LEVEL COMPLETION MODEL (2026-08-28) --------------------------------
// A 960-patient run cannot finish inside one 540s invocation. When the instance
// is SIGKILLed at the cap, driveRun's try/catch does NOT run (it only catches JS
// errors), so the run doc used to be left at status:'running' forever and the
// apply guard 409'd every resume of that runId — an unrecoverable zombie.
//
// Fix, three parts:
//   1. SOFT BUDGET. driveRun stops STARTING new chunks once elapsed exceeds
//      SOFT_BUDGET_MS (well under the 540s cap), flushes the cursor, writes
//      status:'paused', and returns cleanly.
//   2. RESUME. A 'paused' run is resumable: re-POST the same runId and the
//      wrapper continues from `pending` (the durable cursor).
//   3. LEASE + HEARTBEAT. Every running instance holds a lease (`leaseOwner`,
//      `leaseExpiresAt`) renewed by a 30s HEARTBEAT timer that runs independently
//      of patient completion, plus opportunistically on each checkpoint. The
//      heartbeat is what makes lease expiry mean "instance dead": a live instance
//      grinding on one slow patient (per-patient budget 420s >> the 120s TTL)
//      would otherwise let its own lease lapse and invite a concurrent reclaim.
//      The timer is cleared on every exit path (complete / pause / error).
const INSTANCE_MAX_MS = 540 * 1000;   // must match runWith.timeoutSeconds
const SOFT_BUDGET_MS = 500 * 1000;    // stop starting new work here
const LEASE_TTL_MS = 120 * 1000;      // renewed by the heartbeat, not by work
const HEARTBEAT_MS = 30 * 1000;       // lease renewal cadence while driveRun is active
const INSTANCE_ID = `${process.env.K_REVISION || 'local'}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function leaseIsLive(run) {
  const exp = Number(run && run.leaseExpiresAt) || 0;
  if (!exp) return false;                 // pre-lease doc => treat as dead
  return exp > Date.now();
}

function jsonError(res, status, code, reason, message) {
  return res.status(status).json({
    error: { code: status, status: code, message: message || reason, details: { reason } },
  });
}

function parseIds(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return { error: 'NO_PATIENT_IDS' };
  if (raw.length > MAX_IDS) return { error: 'TOO_MANY_PATIENT_IDS' };
  const ids = [];
  const seen = new Set();
  for (const item of raw) {
    const id = String(item == null ? '' : item).trim();
    if (!/^\d{6,25}$/.test(id)) return { error: 'MALFORMED_PATIENT_ID' };
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return { ids };
}

/**
 * Authoritative membership check, cohort-aware.
 *
 * minors: the doc must exist, say it is a minor TODAY, and pass ingestEligibility
 *   (>= 1 active guardian).
 * adults: the doc must exist, must NOT be a minor, and follows the D-081 RELAXED
 *   adult rule — `status` is a PORTAL CLAIM lifecycle field
 *   (not_invited -> invited -> active), NOT a membership status. The supplied
 *   roster is the authority for membership, so any un-claimed-but-rostered
 *   member proceeds. Only an explicit deactivated/removed status rejects.
 *
 * A missing doc is rejected in both cohorts — an explicitly targeted id must
 * exist to be targeted.
 */

async function partitionByCohort(ids, cohort) {
  const db = admin.firestore();
  const eligible = [];
  const rejected = [];
  // getAll caps at 1000 refs per call; chunk defensively.
  const snaps = [];
  for (let i = 0; i < ids.length; i += 300) {
    const slice = ids.slice(i, i + 300).map((id) => db.collection('patients').doc(id));
    const part = await db.getAll(...slice);
    part.forEach((s) => snaps.push(s));
  }

  snaps.forEach((snap, i) => {
    const id = ids[i];
    if (!snap.exists) {
      rejected.push({ patientId: id, reason: 'NO_PATIENT_DOC' });
      return;
    }
    const data = snap.data() || {};
    const minor = isMinorRecord(data);

    if (cohort === 'adults') {
      // Relaxed adult rule (D-081): portal claim state does not gate ingest.
      // Absent status proceeds; unclaimed lifecycle states proceed; anything
      // else (deactivated, removed, suspended, ...) rejects.
      const adultGate = adultBackfillEligibility(data);
      if (!adultGate.eligible) {
        rejected.push({ patientId: id, reason: adultGate.reason });
        return;
      }
      eligible.push(id);
      return;
    }


    // cohort === 'minors' (unchanged)
    if (!minor) {
      rejected.push({ patientId: id, reason: 'NOT_A_MINOR' });
      return;
    }
    const gate = ingestEligibility(data);
    if (!gate.eligible) {
      rejected.push({ patientId: id, reason: gate.reason || 'NOT_ELIGIBLE' });
      return;
    }
    eligible.push(id);
  });

  return { eligible, rejected };
}

/** Merge runner counters into the accumulated run totals. */
function mergeCounters(into, add) {
  const out = { ...into };
  Object.keys(add || {}).forEach((k) => {
    if (k === 'reportTypeCensus') return;
    if (typeof add[k] === 'number') out[k] = (Number(out[k]) || 0) + add[k];
  });
  return out;
}

function mergeCensus(into, census) {
  const out = { ...into };
  Object.values(census || {}).forEach((row) => {
    const key = row.reportType;
    if (!out[key]) out[key] = { ...row, count: 0 };
    out[key].count += row.count;
  });
  return out;
}

function derivedFailures(perPatient) {
  return (perPatient || [])
    .filter((p) => p && p.errors > 0)
    .map((p) => ({
      patientId: p.elationPatientId,
      errors: p.errors,
      stage: p.lastError ? p.lastError.stage : null,
      reason: p.lastError ? p.lastError.reason : null,
      status: p.lastError ? p.lastError.status : null,
      message: p.lastError ? p.lastError.message : null,
    }));
}

/**
 * Server-side worker for an async run. Reads the run doc, drains its `pending`
 * list in chunks, and checkpoints after EVERY completed id. Safe to re-enter:
 * a second call for the same runId simply continues from whatever is pending.
 */
async function driveRun(runId, opts) {
  const startedAtMs = Date.now();
  const db = admin.firestore();
  const runRef = db.collection(RUNS_COLLECTION).doc(runId);
  const FieldValue = admin.firestore.FieldValue;

  const snap = await runRef.get();
  if (!snap.exists) return;
  const run = snap.data() || {};
  let pending = Array.isArray(run.pending) ? run.pending.slice() : [];
  let counters = run.counters || {};
  let census = run.reportTypeCensus || {};
  let failed = Array.isArray(run.failed) ? run.failed : [];

  await runRef.set({
    status: 'running',
    startedAt: FieldValue.serverTimestamp(),
    leaseOwner: INSTANCE_ID,
    leaseExpiresAt: Date.now() + LEASE_TTL_MS,
    cycles: FieldValue.increment(1),
  }, { merge: true });

  const renewLease = () => ({
    leaseOwner: INSTANCE_ID,
    leaseExpiresAt: Date.now() + LEASE_TTL_MS,
  });

  // ---- lease heartbeat ---------------------------------------------------
  // Renews the lease every HEARTBEAT_MS for as long as this instance is alive,
  // regardless of whether any patient has completed. Without it a single slow
  // patient (per-patient budget 420s) outlives the 120s TTL and the run looks
  // dead to an operator/resume while it is still working — which is how two
  // concurrent instances (double Elation load, racing status writes) happen.
  // Writes ONLY the lease fields, so it can never clobber cursor state.
  let heartbeat = setInterval(() => {
    runRef
      .set(renewLease(), { merge: true })
      .catch((e) => logError('backfillElationReports', e));
  }, HEARTBEAT_MS);
  if (heartbeat && typeof heartbeat.unref === 'function') heartbeat.unref();
  const stopHeartbeat = () => {
    if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
  };

  const chunkSize = Math.max(1, Math.min(200, Number(opts.chunkSize) || DEFAULT_CHUNK));

  // ---- soft-budget backoff brake -----------------------------------------
  // The pause check below only runs BETWEEN chunks. If the soft budget is
  // reached while a chunk is mid-flight, any Elation retry sitting in a backoff
  // sleep would keep the instance busy doing nothing until the 540s kill. This
  // timer breaks every pending backoff at the boundary so those calls fail fast,
  // the chunk drains, and the loop reaches the pause write with its cursor intact.
  let backoffBrake = setTimeout(() => {
    try {
      const woken = typeof runner.abortElationBackoff === 'function' ? runner.abortElationBackoff() : 0;
      if (woken) log('backfillElationReports', 'backoff-brake', { runId, woken });
    } catch (e) { logError('backfillElationReports', e); }
  }, Math.max(0, SOFT_BUDGET_MS - (Date.now() - startedAtMs)));
  if (backoffBrake && typeof backoffBrake.unref === 'function') backoffBrake.unref();
  const stopBackoffBrake = () => {
    if (backoffBrake) { clearTimeout(backoffBrake); backoffBrake = null; }
  };

  try {
    while (pending.length) {
      // ---- graceful pre-timeout pause -------------------------------------
      // Never START a chunk we cannot expect to finish before the hard cap.
      if (Date.now() - startedAtMs >= SOFT_BUDGET_MS) {
        stopHeartbeat();   // no renewal may race the pause write
        await runRef.set({
          status: 'paused',
          pausedAt: FieldValue.serverTimestamp(),
          pauseReason: 'SOFT_BUDGET_REACHED',
          counters,
          reportTypeCensus: census,
          failed,
          pending,
          leaseOwner: null,
          leaseExpiresAt: 0,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        log('backfillElationReports', 'paused', { runId, remaining: pending.length });
        return;   // finally{} clears the heartbeat
      }

      const chunk = pending.slice(0, chunkSize);
      const done = [];

      const result = await runner.backfillElationReports(
        db,
        FieldValue,
        chunk,
        {
          cohort: opts.cohort,
          skipExisting: opts.skipExisting,
          storeMedicalRecords: opts.storeMedicalRecords,
          excludeReportTypes: opts.excludeReportTypes,
          concurrency: opts.concurrency,
          // Per-completed-id checkpoint (go-ahead item 4).
          onPatientComplete: async (pc) => {
            done.push(pc.elationPatientId);
            await runRef.set({
              completed: FieldValue.arrayUnion(pc.elationPatientId),
              pending: FieldValue.arrayRemove(pc.elationPatientId),
              lastPatientAt: FieldValue.serverTimestamp(),
              ...renewLease(),
            }, { merge: true });
          },
        },
      );

      counters = mergeCounters(counters, result.counters);
      census = mergeCensus(census, result.counters.reportTypeCensus);
      failed = failed.concat(derivedFailures(result.perPatient)).slice(0, 200);

      pending = pending.filter((id) => !done.includes(id) && !chunk.includes(id));

      await runRef.set({
        counters,
        reportTypeCensus: census,
        failed,
        pending,
        updatedAt: FieldValue.serverTimestamp(),
        ...renewLease(),
      }, { merge: true });
    }

    stopHeartbeat();   // no renewal may race the terminal write
    await runRef.set({
      status: 'complete',
      finishedAt: FieldValue.serverTimestamp(),
      counters,
      reportTypeCensus: census,
      failed,
      pending: [],
      leaseOwner: null,
      leaseExpiresAt: 0,
    }, { merge: true });
  } catch (e) {
    stopHeartbeat();
    logError('backfillElationReports', e);
    await runRef.set({
      status: 'error',
      // Never echo runner error text verbatim into a stored doc — it can embed PHI.
      errorReason: String((e && e.reason) || (e && e.code) || 'RUN_FAILED').slice(0, 120),
      updatedAt: FieldValue.serverTimestamp(),
      counters,
      reportTypeCensus: census,
      failed,
      pending,
      leaseOwner: null,
      leaseExpiresAt: 0,
    }, { merge: true });
  } finally {
    // Belt and braces: every exit path (including the graceful pause `return`
    // above) stops the timer. Only a SIGKILL leaves it unrenewed — which is
    // exactly the signal we want the lease to carry.
    stopHeartbeat();
  }
}

exports.backfillElationReports = functions
  // Elation credentials MUST be bound here. The runner calls the shared Elation
  // client, which reads ELATION_CLIENT_ID / ELATION_CLIENT_SECRET from
  // process.env; without this binding Secret Manager never injects them and
  // EVERY patient fails at the first Elation call (listed: 0, errors: 1).
  // Mirrors getLabs.js / adminProvisionPatients.js / sweepArtifactRepairs.js.
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

    const gate = await requireAdminCaller(req, selfAudience(req, 'backfillElationReports'));
    if (!gate.ok) return jsonError(res, gate.status, 'PERMISSION_DENIED', gate.reason);

    let body;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    } catch (e) {
      return jsonError(res, 400, 'INVALID_ARGUMENT', 'MALFORMED_BODY');
    }

    const db = admin.firestore();

    // ---- status poll ----------------------------------------------------
    if (body.action === 'status') {
      const runId = String(body.runId || '').trim();
      if (!/^[A-Za-z0-9_-]{6,64}$/.test(runId)) {
        return jsonError(res, 400, 'INVALID_ARGUMENT', 'MALFORMED_RUN_ID');
      }
      const snap = await db.collection(RUNS_COLLECTION).doc(runId).get();
      if (!snap.exists) return jsonError(res, 404, 'NOT_FOUND', 'NO_SUCH_RUN');
      const d = snap.data() || {};
      return res.status(200).json({
        runId,
        status: d.status || 'unknown',
        cohort: d.cohort || null,
        requested: Array.isArray(d.requested) ? d.requested.length : (d.requestedCount || 0),
        completed: Array.isArray(d.completed) ? d.completed.length : 0,
        pending: Array.isArray(d.pending) ? d.pending.length : 0,
        pendingIds: Array.isArray(d.pending) ? d.pending.slice(0, 50) : [],
        // Run-level completion model. `resumable` is what the operator acts on:
        // paused / error / claimed are always resumable; a 'running' run is only
        // resumable once its lease has expired (its instance is provably dead).
        cycles: Number(d.cycles) || 0,
        pauseReason: d.pauseReason || null,
        leaseOwner: d.leaseOwner || null,
        leaseExpiresAt: Number(d.leaseExpiresAt) || 0,
        leaseLive: leaseIsLive(d),
        resumable: d.status !== 'complete' && !leaseIsLive(d),
        staleLease: d.status === 'running' && !leaseIsLive(d),
        startedAt: d.startedAt && d.startedAt.toDate ? d.startedAt.toDate().toISOString() : null,
        pausedAt: d.pausedAt && d.pausedAt.toDate ? d.pausedAt.toDate().toISOString() : null,
        lastPatientAt: d.lastPatientAt && d.lastPatientAt.toDate ? d.lastPatientAt.toDate().toISOString() : null,
        updatedAt: d.updatedAt && d.updatedAt.toDate ? d.updatedAt.toDate().toISOString() : null,
        counters: d.counters || {},
        reportTypeCensus: Object.values(d.reportTypeCensus || {}).sort((a, b) => b.count - a.count),
        failed: d.failed || [],
        rejected: d.rejected || [],
        errorReason: d.errorReason || null,
      });
    }

    // ---- reset (zombie clear) -------------------------------------------
    // Operator escape hatch for run docs left at status:'running' by an instance
    // that was SIGKILLed before the pause path could fire (pre-lease zombies such
    // as TdyvnxsF5JKFCiTUXj85 / L0iCYecF1obm5bWklnAK). It NEVER touches ingested
    // data: it only rewrites the run doc's control fields, so the worst case is
    // that already-ingested ids are re-visited and skipped by skip-existing.
    if (body.action === 'reset') {
      const runId = String(body.runId || '').trim();
      if (!/^[A-Za-z0-9_-]{6,64}$/.test(runId)) {
        return jsonError(res, 400, 'INVALID_ARGUMENT', 'MALFORMED_RUN_ID');
      }
      const resetReason = String(body.reason || '').slice(0, 500);
      if (!resetReason) return jsonError(res, 400, 'INVALID_ARGUMENT', 'REASON_REQUIRED');
      const runRef = db.collection(RUNS_COLLECTION).doc(runId);
      const snap = await runRef.get();
      if (!snap.exists) return jsonError(res, 404, 'NOT_FOUND', 'NO_SUCH_RUN');
      const d = snap.data() || {};
      // Refuse to yank a run out from under a demonstrably live instance unless
      // the caller explicitly forces it.
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
        resetBy: String(body.actor || '').slice(0, 320) || 'unknown',
        resetReason,
        resetAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      log('backfillElationReports', 'reset', { runId, actor: body.actor || 'unknown' });
      return res.status(200).json({
        runId,
        status: 'paused',
        reset: true,
        pending: Array.isArray(d.pending) ? d.pending.length : 0,
        resumable: true,
      });
    }

    const cohort = body.cohort === 'adults' ? 'adults' : 'minors';
    const parsed = parseIds(body.patientIds);
    if (parsed.error) return jsonError(res, 400, 'INVALID_ARGUMENT', parsed.error);

    const apply = body.apply === true;
    const actor = String(body.actor || '').slice(0, 320) || 'unknown';
    const reason = String(body.reason || '').slice(0, 500);
    const skipExisting = body.skipExisting === true;
    const storeMedicalRecords = typeof body.storeMedicalRecords === 'boolean'
      ? body.storeMedicalRecords
      : undefined;
    const excludeList = Array.isArray(body.excludeReportTypes)
      ? body.excludeReportTypes.map((t) => String(t)).slice(0, 100)
      : [];
    const excludeReportTypes = excludeList.length ? new Set(excludeList) : null;
    const concurrency = Math.max(1, Math.min(10, Number(body.concurrency) || DEFAULT_CONCURRENCY));
    const chunkSize = Math.max(1, Math.min(200, Number(body.chunkSize) || DEFAULT_CHUNK));

    try {
      const { eligible, rejected } = await partitionByCohort(parsed.ids, cohort);

      // ---- DRY RUN ------------------------------------------------------
      // Synchronous: no writes, no PHI re-fetch — only the report stub list and
      // the existing stored docs. Returns the census for MK's review checkpoint.
      if (!apply) {
        let census = [];
        let counters = {};
        let perPatient = [];
        if (eligible.length) {
          const result = await runner.backfillElationReports(
            db,
            admin.firestore.FieldValue,
            eligible,
            {
              cohort,
              dryRun: true,
              skipExisting: true,
              storeMedicalRecords,
              concurrency,
            },
          );
          census = result.reportTypeCensus;
          counters = result.counters;
          perPatient = result.perPatient;
        }
        log('backfillElationReports', 'dry-run', {
          actor, cohort, requested: parsed.ids.length, eligible: eligible.length, rejected: rejected.length,
        });
        return res.status(200).json({
          apply: false,
          cohort,
          requested: parsed.ids.length,
          eligible: eligible.length,
          wouldIngest: Number(counters.wouldStore) || 0,
          alreadyStored: Number(counters.alreadyStored) || 0,
          skippedUnsigned: Number(counters.skippedUnsigned) || 0,
          skippedDeleted: Number(counters.skippedDeleted) || 0,
          skippedNotAllowlisted: Number(counters.patientsSkippedNotAllowlisted) || 0,
          skippedRecordsDeferred: Number(counters.skippedRecordsDeferred) || 0,
          reportTypeCensus: census,
          counters,
          perPatient,
          rejected,
        });
      }

      // ---- APPLY --------------------------------------------------------
      if (!reason) return jsonError(res, 400, 'INVALID_ARGUMENT', 'REASON_REQUIRED');

      if (eligible.length === 0) {
        return res.status(200).json({
          apply: true, cohort, requested: parsed.ids.length, ingested: 0, skipped: 0, failed: [], rejected,
        });
      }

      const FieldValue = admin.firestore.FieldValue;
      const runId = String(body.runId || '').trim() || db.collection(RUNS_COLLECTION).doc().id;
      if (!/^[A-Za-z0-9_-]{6,64}$/.test(runId)) {
        return jsonError(res, 400, 'INVALID_ARGUMENT', 'MALFORMED_RUN_ID');
      }
      const runRef = db.collection(RUNS_COLLECTION).doc(runId);
      const existing = await runRef.get();

      if (existing.exists) {
        const d = existing.data() || {};
        // A run is only genuinely in progress if its lease is LIVE. A lease is
        // renewed on every chunk and every completed id, with a TTL shorter than
        // the 540s instance cap, so an expired lease on a 'running' doc means the
        // instance died (SIGKILL at the cap, OOM, eviction) — reclaim it rather
        // than 409 forever.
        if (d.status === 'running' && leaseIsLive(d)) {
          return res.status(409).json({
            error: { code: 409, status: 'ABORTED', message: 'Run already in progress', details: { reason: 'RUN_IN_PROGRESS', runId } },
          });
        }
        if (d.status === 'complete') {
          return res.status(200).json({
            apply: true, runId, cohort, status: 'complete', alreadyComplete: true, requested: parsed.ids.length,
          });
        }
        // Resume: 'paused' (graceful), 'error', 'claimed', or a stale-lease
        // 'running'. `pending` is the durable cursor — keep whatever is left.
        await runRef.set({
          resumedAt: FieldValue.serverTimestamp(),
          actor,
          reason,
          reclaimedFrom: d.status === 'running' ? (d.leaseOwner || 'unknown') : null,
        }, { merge: true });
      } else {
        await runRef.set({
          runId,
          cohort,
          actor,
          reason,
          apply: true,
          status: 'claimed',
          options: { skipExisting, storeMedicalRecords: storeMedicalRecords ?? null, excludeReportTypes: excludeList, concurrency, chunkSize },
          requested: eligible,
          requestedCount: eligible.length,
          pending: eligible,
          completed: [],
          rejected,
          counters: {},
          reportTypeCensus: {},
          failed: [],
          createdAt: FieldValue.serverTimestamp(),
        });
      }

      // 202 first, then work server-side. Each id is checkpointed as it finishes,
      // so an instance kill at 540s loses no progress — re-POST the same runId.
      res.status(202).json({
        apply: true,
        async: true,
        runId,
        cohort,
        requested: parsed.ids.length,
        eligible: eligible.length,
        rejected,
        poll: { action: 'status', runId },
        // Resume model: the operator re-POSTs this same runId whenever status
        // comes back 'paused' (or 'running' with staleLease). There is no
        // self-re-invoke and no scheduler.
        resumeModel: 'operator-repost',
        softBudgetMs: SOFT_BUDGET_MS,
        instanceMaxMs: INSTANCE_MAX_MS,
      });

      await driveRun(runId, {
        cohort, skipExisting, storeMedicalRecords, excludeReportTypes, concurrency, chunkSize,
      });
      return undefined;
    } catch (e) {
      logError('backfillElationReports', e);
      if (res.headersSent) return undefined;
      // Never echo runner error text — it can embed PHI.
      return jsonError(res, 500, 'INTERNAL', 'INGEST_FAILED', 'Report ingest failed.');
    }
  });

exports._partitionByCohort = partitionByCohort;
// Back-compat alias for existing tests/imports (minor track).
exports._partitionByMinorSet = (ids) => partitionByCohort(ids, 'minors');
