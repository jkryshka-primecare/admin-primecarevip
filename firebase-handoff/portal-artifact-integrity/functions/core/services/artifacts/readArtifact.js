/**
 * Release 2a · Option A — THE shared artifact read path.
 *
 * REWRITTEN against the real repo (primecarevip/prime-care-vip-app-v2,
 * functions/). The earlier draft assumed a Firestore-doc-keyed artifact path;
 * production actually serves artifacts from a uid-keyed Storage prefix:
 *
 *     elation-artifacts/<firebaseUid>/<reportId>/report.pdf
 *
 * Ownership is therefore proven by the *path*, and the uid comes from the
 * verified token — never from the request body. Only three handlers have an
 * artifact mode (getLabs, getImaging, getMedicalRecords); the other five are
 * list-only and have nothing to delegate.
 *
 * ORDER OF OPERATIONS (do not reorder):
 *   1. verifyPatientToken(req.headers.authorization)  -> uid (+ Guard B)
 *   2. resolvePatientForCaller(uid)                   -> elationPatientId (server-derived)
 *   3. D-068 allowlist gate                           -> 403 NOT_IN_ALLOWLIST
 *   4. assertNotSuspended(elationPatientId)           -> fails CLOSED (403 / 503)
 *   5. suppression: module off OR item hidden         -> 404 ARTIFACT_NOT_SYNCED
 *   6. object present? -> v4 signed URL | missing? -> enqueueRepair + preparing
 *
 * Suppression is checked BEFORE any Storage access, and answers exactly like
 * "not synced yet", so a member learns nothing about what was hidden.
 * Healing writes bytes only; it never grants access.
 *
 * Errors carry `.status`, `.code` and `.reason` so each wrapper can map them
 * straight into its existing `jsonError(res, status, code, reason, message)`
 * envelope.
 */

const admin = require('firebase-admin');

// eslint-disable-next-line import/no-unresolved
const { verifyPatientToken } = require('../../../middleware/verifyAuth');
// eslint-disable-next-line import/no-unresolved
const { resolvePatientForCaller } = require('../elation/resolvePatientForCaller');
const {
  getPortalAccess,
  assertNotSuspended,
  isModuleVisible,
  filterHidden,
} = require('../patient/portalAccess');
const { enqueueRepair, PREPARING } = require('./repairQueue');

/** Signed-URL TTL: default, and the hard cap a caller can never exceed. */
const DEFAULT_TTL_SECONDS = 300;
const MAX_TTL_SECONDS = 900;

/** The one bucket artifacts live in. Pinned, never caller-supplied. */
const ARTIFACT_BUCKET = 'prive-care-vip.firebasestorage.app';

/** Wrapper -> portalAccess module key. One "Records" toggle governs records. */
const MODULE_KEYS = Object.freeze({
  labs: 'labs',
  imaging: 'imaging',
  records: 'records',
});

/** Stored `category` (set by ingestElationReports) -> portalAccess module. */
const CATEGORY_TO_MODULE = Object.freeze({
  lab: 'labs',
  imaging: 'imaging',
  medical_records: 'records',
});

function fail(status, code, reason, message, extra) {
  const err = new Error(message || reason);
  err.status = status;
  err.code = code;
  err.reason = reason;
  Object.assign(err, extra || {});
  return err;
}

/** Hidden / module-off / missing all read as ABSENT — never as "forbidden". */
function notSynced() {
  return fail(404, 'NOT_FOUND', 'ARTIFACT_NOT_SYNCED', 'This report is not available yet.');
}

function clampTtl(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TTL_SECONDS;
  return Math.min(Math.floor(n), MAX_TTL_SECONDS);
}

// D-068 pre-G9 read gate, mirrored from the handlers so the shared path keeps
// the same fail-closed behavior when it is called directly.
function isReadAllowed(elationPatientId) {
  if (process.env.ELATION_FULL_SYNC_ENABLED === 'true') return true;
  const allow = (process.env.ELATION_READ_ALLOWLIST || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  return allow.includes(String(elationPatientId));
}

function objectPathFor(uid, reportId) {
  return `elation-artifacts/${uid}/${reportId}/report.pdf`;
}

/**
 * Serve one artifact.
 *
 * @param {{ headers: object, body?: object }} req  raw request — token source only
 * @param {{ reportId: string, module: 'labs'|'imaging'|'records', ttlSeconds?: number }} params
 * @returns {Promise<{ signedUrl?: string, expiresAt?: string, contentType?: string, state?: string }>}
 */
async function handleArtifactRead(req, params = {}) {
  const reportId = String((params && params.reportId) || '').trim();
  if (!reportId) throw fail(400, 'INVALID_ARGUMENT', 'MISSING_REPORT_ID', 'reportId is required.');

  const moduleKey = MODULE_KEYS[String(params.module || '')];
  if (!moduleKey) throw fail(400, 'INVALID_ARGUMENT', 'UNKNOWN_MODULE', 'Unknown module.');

  // 1. Authenticate. The uid on the verified token is the only identity used;
  //    anything in req.body (including a patientId) is deliberately ignored.
  let user;
  try {
    user = await verifyPatientToken(req && req.headers && req.headers.authorization);
  } catch (err) {
    throw fail(err.httpErrorCode?.status || 401, 'UNAUTHENTICATED',
      err.details?.reason || 'NO_TOKEN', err.message);
  }
  if (!user || !user.uid || user.uid === 'unauthenticated') {
    throw fail(401, 'UNAUTHENTICATED', 'NO_TOKEN', 'Authentication required.');
  }
  const uid = String(user.uid).toLowerCase();

  // 2. Server-derived patient. Ownership never comes from the caller.
  let doc;
  try {
    doc = await resolvePatientForCaller(uid);
  } catch (err) {
    const status = err.httpErrorCode?.status || 500;
    throw fail(status, status === 404 ? 'NOT_FOUND' : status === 401 ? 'UNAUTHENTICATED' : 'INTERNAL',
      err.details?.reason || 'INTERNAL', err.message);
  }
  const elationPatientId = doc && doc.id;
  if (!elationPatientId) {
    throw fail(403, 'PERMISSION_DENIED', 'NO_PATIENT_BOUND', 'No patient record for this account.');
  }

  // 3. Pre-G9 allowlist gate — fail closed.
  if (!isReadAllowed(elationPatientId)) {
    throw fail(403, 'PERMISSION_DENIED', 'NOT_IN_ALLOWLIST',
      'Records access is not enabled for this account yet.');
  }

  // 4. Suspension fails CLOSED.
  try {
    await assertNotSuspended(elationPatientId);
  } catch (err) {
    if (err && err.portalReason === 'ACCESS_SUSPENDED') {
      throw fail(403, 'PERMISSION_DENIED', 'ACCESS_SUSPENDED',
        'Portal access for this account is currently paused. Please contact our office.');
    }
    throw fail(503, 'UNAVAILABLE', 'ACCESS_CHECK_FAILED', 'Please try again in a moment.');
  }

  // 5. Reference ownership FIRST, so suppression can be evaluated under the
  //    report's TRUE module. All artifact-bearing docs live in the patient's
  //    `labs` subcollection, discriminated by `category`. A guessed id
  //    belonging to another member resolves to nothing here — 404, and
  //    crucially NO repair is queued, so the healer can never be steered at
  //    someone else's PHI. Firestore only; no Storage access yet.
  let refSnap;
  try {
    refSnap = await admin.firestore()
      .collection('patients').doc(String(elationPatientId))
      .collection('labs').doc(reportId)
      .get();
  } catch (err) {
    throw fail(503, 'UNAVAILABLE', 'ACCESS_CHECK_FAILED', 'Please try again in a moment.');
  }
  if (!refSnap.exists || refSnap.get('deleted') === true) throw notSynced();

  // 5b. Module cross-calling is a suppression bypass: a report hidden under
  //     `labs` must not be retrievable through the imaging or records wrapper.
  //     The effective module comes from the STORED category, never the caller,
  //     and a mismatch reads as absence.
  const effectiveModule = CATEGORY_TO_MODULE[String(refSnap.get('category') || '')];
  if (!effectiveModule || effectiveModule !== moduleKey) throw notSynced();

  // 6. Suppression reads as absence — evaluated BEFORE any Storage access.
  const portalAccess = await getPortalAccess(elationPatientId);
  if (!isModuleVisible(portalAccess, effectiveModule)) throw notSynced();
  if (filterHidden(portalAccess, effectiveModule, [{ id: reportId }], (it) => it.id).length === 0) {
    throw notSynced();
  }


  // 6b. The object itself lives under the caller's own uid prefix.
  const path = objectPathFor(uid, reportId);
  const file = admin.storage().bucket(ARTIFACT_BUCKET).file(path);


  let exists = false;
  try {
    [exists] = await file.exists();
  } catch (err) {
    throw fail(500, 'INTERNAL', 'STORAGE_ERROR', 'Storage unavailable.');
  }

  if (!exists) {
    // Server-scoped repair: the queue entry is derived from the resolved
    // patient, never from the request. The member is not blocked on Elation.
    try {
      await enqueueRepair({ patientId: elationPatientId, uid }, { documentId: reportId, path, module: effectiveModule });
    } catch (err) {
      // A repair-queue failure must never leak or change the member answer.
    }
    return { ...PREPARING };
  }

  const ttlSeconds = clampTtl(params.ttlSeconds);
  const expiresMs = Date.now() + ttlSeconds * 1000;
  let signedUrl;
  try {
    const [url] = await file.getSignedUrl({ version: 'v4', action: 'read', expires: expiresMs });
    signedUrl = url;
  } catch (err) {
    throw fail(500, 'INTERNAL', 'SIGN_ERROR', 'Could not prepare the report link.');
  }

  return {
    signedUrl,
    expiresAt: new Date(expiresMs).toISOString(),
    contentType: 'application/pdf',
  };
}

module.exports = {
  handleArtifactRead,
  MODULE_KEYS,
  CATEGORY_TO_MODULE,
  ARTIFACT_BUCKET,
  DEFAULT_TTL_SECONDS,
  MAX_TTL_SECONDS,
};
