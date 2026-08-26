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
const { ingestEligibility, isMinorRecord } = require('./core/services/patient/ingestEligibility');

// The runner module. It exports its internal batch function; keep this require
// pointing at the REAL file in the repo — this wrapper adds no ingest logic of
// its own on purpose.
const runner = require('./backfillElationReports');

const MAX_IDS = 1000;      // the full adult roster (~972) fits in one claim
const DEFAULT_CHUNK = 40;  // ids per runner invocation (go-ahead item 4)
const DEFAULT_CONCURRENCY = 5;
const RUNS_COLLECTION = 'backfill_runs';

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
 * adults: the doc must exist, must NOT be a minor, and follows the D-080 SOFT
 *   adult rule — an absent `status` proceeds (the supplied roster is the
 *   authority for "active"), an explicit non-active value rejects.
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
      if (minor) {
        rejected.push({ patientId: id, reason: 'IS_A_MINOR' });
        return;
      }
      // Soft-adult rule: only an EXPLICIT non-active status rejects.
      if (data.status !== undefined && !ingestEligibility(data).eligible) {
        rejected.push({ patientId: id, reason: 'NOT_ACTIVE' });
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

  await runRef.set({ status: 'running', startedAt: FieldValue.serverTimestamp() }, { merge: true });

  const chunkSize = Math.max(1, Math.min(200, Number(opts.chunkSize) || DEFAULT_CHUNK));

  try {
    while (pending.length) {
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
      }, { merge: true });
    }

    await runRef.set({
      status: 'complete',
      finishedAt: FieldValue.serverTimestamp(),
      counters,
      reportTypeCensus: census,
      failed,
      pending: [],
    }, { merge: true });
  } catch (e) {
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
    }, { merge: true });
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
        counters: d.counters || {},
        reportTypeCensus: Object.values(d.reportTypeCensus || {}).sort((a, b) => b.count - a.count),
        failed: d.failed || [],
        rejected: d.rejected || [],
        errorReason: d.errorReason || null,
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
        if (d.status === 'running') {
          return res.status(409).json({
            error: { code: 409, status: 'ABORTED', message: 'Run already in progress', details: { reason: 'RUN_IN_PROGRESS', runId } },
          });
        }
        // Resume: keep whatever is still pending.
        await runRef.set({ resumedAt: FieldValue.serverTimestamp(), actor, reason }, { merge: true });
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
