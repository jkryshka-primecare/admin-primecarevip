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
 *   5. reference ownership: patients/<id>/labs/<reportId> exists & not deleted
 *   5b. effective module from stored `category` must match the wrapper
 *   6. suppression: module off OR item hidden         -> 404 ARTIFACT_NOT_SYNCED
 *   6b. object present? -> v4 signed URL | missing? -> enqueueRepair + preparing
 *
 * Ownership and suppression are both checked BEFORE any Storage access, and answers exactly like
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
const { resolveGuardianAccess } = require('../patient/guardians');
const {
  getInternalUid,
  objectPathFor,
  legacyObjectPathFor,
  legacyFallbackEnabled,
} = require('../patient/internalUid');
const { enqueueRepair, PREPARING } = require('./repairQueue');

/**
 * Release 2b guardian reads stay OFF until the internal-UID re-key (Part B) is
 * complete and the red-team is green. OFF means a guardian read is treated
 * exactly like a stranger read — absence, never "forbidden".
 *
 * CANARY SCOPING — FAIL CLOSED. `GUARDIAN_READS_ENABLED=true` is necessary but
 * NEVER sufficient: the caller must also match `GUARDIAN_READS_ALLOWLIST`.
 *
 *   - empty / unset allowlist  -> DENY ALL (a dropped or clobbered variable can
 *     never silently widen a canary into a global flip)
 *   - `*` (or `ALL`)           -> deliberate global widen, one explicit token
 *   - comma list               -> exactly those guardians
 *
 * Entries may be Firebase uids (lower-cased) or the guardian's OWN elation
 * record id — matching either is enough, so the operator does not have to know
 * which id space to use.
 */
function guardianAllowlist() {
  return (process.env.GUARDIAN_READS_ALLOWLIST || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function guardianAllowlistIsGlobal(allow) {
  return allow.includes('*') || allow.includes('all');
}

function guardianReadsEnabledFor(uid, callerElationId) {
  if (process.env.GUARDIAN_READS_ENABLED !== 'true') return false;
  const allow = guardianAllowlist();
  if (allow.length === 0) return false; // fail closed: no scope = no guardian reads
  if (guardianAllowlistIsGlobal(allow)) return true;
  return allow.includes(String(uid || '').toLowerCase())
    || (callerElationId ? allow.includes(String(callerElationId).toLowerCase()) : false);
}



/**
 * Proxy audit (enforcement rule 4): every read logs BOTH uids. Self-reads set
 * acting == subject. No PHI beyond ids already logged; failures never change
 * the member answer.
 */
async function logAccess({ actingUid, subjectUid, subjectElationId, reportId, moduleKey, mode, outcome }) {
  try {
    await admin.firestore().collection('phi_access_log').add({
      actingUid: actingUid || null,
      subjectUid: subjectUid || null,
      subjectElationId: subjectElationId || null,
      reportId: reportId || null,
      module: moduleKey || null,
      mode,
      outcome,
      at: new Date().toISOString(),
    });
  } catch (_e) {
    // Logging is best-effort; it must never leak or alter the answer.
  }
}


/** Signed-URL TTL: default, and the hard cap a caller can never exceed. */
const DEFAULT_TTL_SECONDS = 300;
const MAX_TTL_SECONDS = 900;

/** The one bucket artifacts live in. Pinned, never caller-supplied. */
const { ARTIFACT_BUCKET, artifactBucketName } = require('../../config/artifactBucket');

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

// Storage paths now come from `core/services/patient/internalUid` — the object
// is keyed on the RECORD's internalUid, never on the caller's token uid. See
// Part B: minors have no firebaseUid, so a uid-keyed path made guardian reads
// unserveable and would have mislocated the child's PDF under the guardian.


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

  // 2. Resolve the SUBJECT record. Two id spaces, kept distinct:
  //      - the Firestore RECORD is keyed by elationPatientId (what a guardian
  //        link points at);
  //      - the Storage OBJECT is keyed by that record's `internalUid`.
  //    A guardian-only account may resolve to no record of its own, which is
  //    fine — the guardian check below is what authorizes the read.
  let doc = null;
  try {
    doc = await resolvePatientForCaller(uid);
  } catch (err) {
    const status = err.httpErrorCode?.status || 500;
    if (status !== 404) {
      throw fail(status, status === 401 ? 'UNAUTHENTICATED' : 'INTERNAL',
        err.details?.reason || 'INTERNAL', err.message);
    }
  }
  const selfElationId = doc && doc.id ? String(doc.id) : null;

  // The caller MAY name a child. That id is untrusted until
  // resolveGuardianAccess passes: no internalUid resolution, no Storage touch,
  // no signed URL and no repair enqueue happen before authorization succeeds.
  const requestedChildId = String(
    (params && params.childElationId) || (req && req.body && req.body.childElationId) || '',
  ).trim();
  const elationPatientId = requestedChildId || selfElationId;
  if (!elationPatientId) {
    throw fail(403, 'PERMISSION_DENIED', 'NO_PATIENT_BOUND', 'No patient record for this account.');
  }

  let mode = null;
  let guardianAccess = null;
  if (selfElationId && selfElationId === elationPatientId) {
    mode = 'self';
  } else if (guardianReadsEnabledFor(uid, selfElationId)) {
    // Phase 1 (chart-backed): authorization is the strict, both-non-empty match
    // of the caller's OWN elation record id against the entry's
    // guardianElationId, plus status === 'active'. A caller with no owned
    // record (selfElationId null) is denied before any comparison, so a
    // null-guardianElationId (email_on_file) entry can never be matched.
    // Fails CLOSED; the uid bind inside is best-effort only.
    guardianAccess = await resolveGuardianAccess(elationPatientId, {
      uid,
      callerElationId: selfElationId,
    });
    if (guardianAccess && guardianAccess.authorized) mode = 'guardian';
  }
  if (!mode) {
    // Absence-never-forbidden: an unlinked, revoked or pending target answers
    // exactly like a stranger's guess. Nothing here reveals the child exists.
    await logAccess({ actingUid: uid, subjectElationId: null, reportId, moduleKey, mode: 'denied', outcome: 'unauthorized' });
    throw notSynced();
  }
  if (guardianAccess && guardianAccess.bound && guardianAccess.reason === 'CHART_MATCH') {
    // Audit the bind itself with both uids, as with the read.
    await logAccess({
      actingUid: uid, subjectUid: null, subjectElationId: elationPatientId,
      reportId, moduleKey, mode: 'guardian', outcome: 'guardian_uid_bound',
    });
  }


  // 3. Pre-G9 allowlist gate — fail closed, on the SUBJECT's record.
  if (!isReadAllowed(elationPatientId)) {
    throw fail(403, 'PERMISSION_DENIED', 'NOT_IN_ALLOWLIST',
      'Records access is not enabled for this account yet.');
  }

  // 4. Suspension fails CLOSED — evaluated on the CHILD's record for a proxy
  //    read (enforcement rule 2), never on the guardian's.
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
  //    report's TRUE module. All artifact-bearing docs live in the subject's
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

  // 6. Suppression reads as absence — evaluated BEFORE any Storage access, and
  //    always on the SUBJECT's record. A guardian never sees more than the
  //    child's own settings allow, and a hidden item is the identical absence.
  const portalAccess = await getPortalAccess(elationPatientId);
  if (!isModuleVisible(portalAccess, effectiveModule)) throw notSynced();
  if (filterHidden(portalAccess, effectiveModule, [{ id: reportId }], (it) => it.id).length === 0) {
    throw notSynced();
  }


  // 6b. Only now — after authorization — is the STORAGE key resolved. The
  //     object lives under the SUBJECT record's internalUid.
  const { internalUid, legacyUid } = await getInternalUid(elationPatientId);
  const path = objectPathFor(internalUid, reportId);
  const bucket = admin.storage().bucket(artifactBucketName());

  let exists = false;
  let servedPath = path;
  try {
    if (path) [exists] = await bucket.file(path).exists();
    if (!exists && legacyFallbackEnabled() && legacyUid) {
      // Dual-read window (Part B step 2): serve the legacy firebaseUid path
      // while the object backfill runs. Removed once coverage is 100% under
      // the new key. A record with no legacyUid (every minor) never reaches
      // this branch, so a guardian read is only ever served re-keyed.
      const legacyPath = legacyObjectPathFor(legacyUid, reportId);
      [exists] = await bucket.file(legacyPath).exists();
      if (exists) servedPath = legacyPath;
    }
  } catch (err) {
    throw fail(500, 'INTERNAL', 'STORAGE_ERROR', 'Storage unavailable.');
  }

  if (!exists) {
    // Server-scoped repair: the queue entry is derived from the authorized
    // subject, never from the request, and it is keyed on the internalUid
    // path — so a heal can never land a child's PDF under a guardian prefix.
    try {
      if (path) {
        await enqueueRepair(
          { patientId: elationPatientId, internalUid },
          { documentId: reportId, path, module: effectiveModule },
        );
      }
    } catch (err) {
      // A repair-queue failure must never leak or change the member answer.
    }
    await logAccess({
      actingUid: uid, subjectUid: internalUid, subjectElationId: elationPatientId,
      reportId, moduleKey: effectiveModule, mode, outcome: 'preparing',
    });
    return { ...PREPARING };
  }


  const ttlSeconds = clampTtl(params.ttlSeconds);
  const expiresMs = Date.now() + ttlSeconds * 1000;
  let signedUrl;
  try {
    const [url] = await bucket
      .file(servedPath)
      .getSignedUrl({ version: 'v4', action: 'read', expires: expiresMs });
    signedUrl = url;
  } catch (err) {
    throw fail(500, 'INTERNAL', 'SIGN_ERROR', 'Could not prepare the report link.');
  }

  await logAccess({
    actingUid: uid, subjectUid: internalUid, subjectElationId: elationPatientId,
    reportId, moduleKey: effectiveModule, mode, outcome: 'served',
  });

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
