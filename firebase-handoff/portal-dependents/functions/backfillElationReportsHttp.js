// functions/backfillElationReportsHttp.js
// Release 2b · Part B — the ONLY HTTP surface for the minor-track report ingest.
//
// `backfillElationReports.js` was deliberately runner-only. This wrapper adds an
// HTTP entrypoint so the Prime Care OS operator console can run the minor
// ingest without a Cloud Shell session, and it is a real new attack surface, so
// it is gated harder than the runner ever needed to be:
//
//   1. `requireAdminCaller` — same gate as every other admin function, and the
//      export name below MUST be listed in ADMIN_FUNCTIONS in
//      lock-admin-invokers.yml so the post-deploy step strips `allUsers`.
//   2. THE MINOR SET IS THE AUTHORITY. Every id in the request is loaded and
//      re-validated here against `dependent.isMinor === true` plus at least one
//      `active` guardian (via ingestEligibility). The edge function and the UI
//      validate shape; THIS is the check that decides. Anything that fails is
//      returned in `rejected` and never reaches the ingest.
//   3. Dry run by default. `apply: true` must be explicit.
//   4. Hard cap on batch size — a mistake stays small enough to read.
//
// Attribution: the caller is always the `portal-admin` service account, so the
// human is recorded upstream in the admin app's `portal_admin_actions` table,
// written BEFORE this function is called. `actor` and `reason` are echoed into
// the logs here so the two trails can be joined.

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { log, logError } = require('./middleware/logger');
const { requireAdminCaller, selfAudience } = require('./middleware/requireAdminCaller');
const { ingestEligibility, isMinorRecord } = require('./core/services/patient/ingestEligibility');

// The runner module. It exports its internal batch function; keep this require
// pointing at the REAL file in the repo — this wrapper adds no ingest logic of
// its own on purpose.
const runner = require('./backfillElationReports');

const MAX_IDS = 500;

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
 * Authoritative membership check. A patient reaches the ingest only when its
 * own doc says it is a minor AND ingestEligibility admits it (>= 1 active
 * guardian). A missing doc is rejected here — unlike the backfill's D-080 soft
 * posture, an explicitly targeted id must exist to be targeted.
 */
async function partitionByMinorSet(ids) {
  const db = admin.firestore();
  const eligible = [];
  const rejected = [];
  const refs = ids.map((id) => db.collection('patients').doc(id));
  const snaps = await db.getAll(...refs);

  snaps.forEach((snap, i) => {
    const id = ids[i];
    if (!snap.exists) {
      rejected.push({ patientId: id, reason: 'NO_PATIENT_DOC' });
      return;
    }
    const data = snap.data() || {};
    if (!isMinorRecord(data)) {
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

    const parsed = parseIds(body.patientIds);
    if (parsed.error) return jsonError(res, 400, 'INVALID_ARGUMENT', parsed.error);

    const apply = body.apply === true;
    const actor = String(body.actor || '').slice(0, 320) || 'unknown';
    const reason = String(body.reason || '').slice(0, 500);

    try {
      const { eligible, rejected } = await partitionByMinorSet(parsed.ids);

      if (!apply) {
        log('backfillElationReports', 'dry-run', {
          actor, requested: parsed.ids.length, eligible: eligible.length, rejected: rejected.length,
        });
        return res.status(200).json({
          apply: false,
          requested: parsed.ids.length,
          eligible: eligible.length,
          wouldIngest: eligible.length,
          rejected,
        });
      }

      if (eligible.length === 0) {
        return res.status(200).json({
          apply: true, requested: parsed.ids.length, ingested: 0, skipped: 0, failed: [], rejected,
        });
      }

      // Delegate to the real runner. Its signature is positional and id-array
      // only — (db, FieldValue, elationPatientIds) — and it re-applies the §2a
      // gate per patient, so a guardian revoked between this check and the
      // write is still caught. `actor`/`reason` are NOT runner inputs: the human
      // is attributed in the admin app's portal_admin_actions row (written
      // before this call) and echoed into the logs below.
      const raw = await runner.backfillElationReports(
        admin.firestore(),
        admin.firestore.FieldValue,
        eligible,
      );

      // Normalize the runner's report to the same shape as the empty-eligible
      // branch above, so the caller sees one contract either way.
      const r = raw && typeof raw === 'object' ? raw : {};
      const c = r.counters || {};
      const per = Array.isArray(r.perPatient) ? r.perPatient : [];
      // The runner reports in `counters`/`perPatient`; it never emits
      // ingested/skipped/failed. Deriving them here is what stops the
      // contradiction where patientsErrored: 5 sits next to failed: [].
      const report = {
        ...r,
        ingested: Number.isFinite(r.ingested) ? r.ingested : (Number(c.stored) || 0),
        skipped: Number.isFinite(r.skipped) ? r.skipped
          : (Number(c.patientsSkippedNotAllowlisted) || 0)
            + (Number(c.patientsSkippedNonActive) || 0),
        failed: Array.isArray(r.failed) && r.failed.length
          ? r.failed
          : per
            .filter((p) => p && p.errors > 0)
            .map((p) => ({
              patientId: p.elationPatientId,
              errors: p.errors,
              stage: p.lastError ? p.lastError.stage : null,
              reason: p.lastError ? p.lastError.reason : null,
              status: p.lastError ? p.lastError.status : null,
              message: p.lastError ? p.lastError.message : null,
            })),
      };

      log('backfillElationReports', 'applied', {
        actor, eligible: eligible.length, rejected: rejected.length,
      });
      // Runner fields first: the wrapper's own apply/requested/rejected always win.
      return res.status(200).json({ ...report, apply: true, requested: parsed.ids.length, rejected });
    } catch (e) {
      logError('backfillElationReports', e);
      // Never echo runner error text — it can embed PHI.
      return jsonError(res, 500, 'INTERNAL', 'MINOR_INGEST_FAILED', 'Minor ingest failed.');
    }
  });

exports._partitionByMinorSet = partitionByMinorSet;
