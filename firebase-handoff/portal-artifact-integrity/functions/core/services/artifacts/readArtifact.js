/**
 * Release 2a · Option A — THE shared artifact read path.
 *
 * Every member-facing artifact read (labs, imaging, medications, letters,
 * medical records, appointments, problems, allergies, my-record) routes through
 * `handleArtifactRead`. One ownership resolver, one suppression check, one
 * signer. This is the module the red-team suite imports, so the gate guards the
 * code that actually serves members.
 *
 * ORDER OF OPERATIONS (do not reorder — each step depends on the one above):
 *   1. verifyPatientToken(req)                 -> firebase uid, never trusted input
 *   2. resolvePatientForCaller(uid)            -> elationPatientId, SERVER-DERIVED
 *   3. assertNotSuspended(elationPatientId)    -> fails CLOSED (403)
 *   4. ownership: the document must live under THAT patient        (else 403)
 *   5. suppression: module off or item hidden reads as ABSENT      (404)
 *   6. object present? -> signed URL   |   missing? -> enqueueRepair + preparing
 *
 * The request body is NEVER a source of identity. A caller may supply
 * `patientId`; it is ignored. Steering the repair queue at someone else's PHI
 * is therefore impossible from this entry point (see repairQueue.js).
 *
 * Errors carry `.status` so the HTTP wrappers can map them directly, and
 * `.state` for the non-error "preparing" case.
 */

const admin = require('firebase-admin');

// eslint-disable-next-line import/no-unresolved
const { verifyPatientToken } = require('../../../middleware/verifyPatientToken');
// eslint-disable-next-line import/no-unresolved
const { resolvePatientForCaller } = require('../elation/resolvePatientForCaller');
const {
  getPortalAccess,
  assertNotSuspended,
  isModuleVisible,
} = require('../patient/portalAccess');
const { enqueueRepair, PREPARING } = require('./repairQueue');

/** Default TTL for a minted URL, and the hard cap a caller cannot exceed. */
const DEFAULT_TTL_SECONDS = 300;
const MAX_TTL_SECONDS = 900;

/**
 * Subcollection -> portalAccess module key. Mirrors ENFORCEMENT.md so a single
 * "Records" toggle governs both letters and medical records.
 */
const COLLECTION_MODULE = Object.freeze({
  labs: 'labs',
  imaging: 'imaging',
  medications: 'medications',
  letters: 'records',
  documents: 'records',
  records: 'records',
  appointments: 'appointments',
  problems: 'conditions',
  allergies: 'allergies',
});

function fail(status, message, extra) {
  const err = new Error(message);
  err.status = status;
  Object.assign(err, extra || {});
  return err;
}

/** Hidden / module-off / unknown all read as ABSENT — never as "forbidden". */
function notFound() {
  return fail(404, 'Not found');
}

function bearer(req) {
  const header = (req && req.headers && req.headers.authorization) || '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
}

function clampTtl(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TTL_SECONDS;
  return Math.min(Math.floor(n), MAX_TTL_SECONDS);
}

/** Per-patient item suppression, tolerant of both list and map shapes. */
function isItemHidden(access, patientDoc, moduleKey, collection, documentId) {
  const fromAccess = (access && access.hiddenItems && access.hiddenItems[moduleKey]) || [];
  if (Array.isArray(fromAccess) && fromAccess.map(String).includes(String(documentId))) return true;
  const local = patientDoc && patientDoc.portalAccess && patientDoc.portalAccess.hidden;
  const bucketed = local && (local[collection] || local[moduleKey]);
  if (!bucketed) return false;
  if (Array.isArray(bucketed)) return bucketed.map(String).includes(String(documentId));
  return bucketed[documentId] === true;
}

/**
 * Serve one artifact.
 *
 * @param {{ headers: object, body?: object }} req  raw request (token source)
 * @param {{ documentId: string, collection?: string, ttlSeconds?: number }} params
 * @returns {Promise<{ url?: string, expiresAt?: string, state?: string, message?: string }>}
 */
async function handleArtifactRead(req, params = {}) {
  const documentId = String((params && params.documentId) || '').trim();
  if (!documentId) throw fail(400, 'documentId is required');

  const collection = COLLECTION_MODULE[String(params.collection || 'documents')]
    ? String(params.collection || 'documents')
    : 'documents';
  const moduleKey = COLLECTION_MODULE[collection];

  // 1. Authenticate. No token, no read — and the uid is the only identity used.
  const token = bearer(req);
  if (!token) throw fail(401, 'Missing bearer token');
  let decoded;
  try {
    decoded = await verifyPatientToken(token);
  } catch (err) {
    throw fail(401, 'Invalid token');
  }
  const uid = decoded && (decoded.uid || decoded.user_id);
  if (!uid || decoded.unauthenticated) throw fail(401, 'Invalid token');

  // 2. Server-derived ownership. Anything in req.body is deliberately ignored.
  const patient = await resolvePatientForCaller(uid);
  const patientId = patient && (patient.id || patient.patientId);
  if (!patientId) throw fail(403, 'No patient record for caller');

  // 3. Suspension fails CLOSED.
  try {
    await assertNotSuspended(patientId);
  } catch (err) {
    if (err && err.portalReason === 'ACCESS_SUSPENDED') throw fail(403, 'Portal access suspended');
    throw fail(503, 'Access check failed');
  }

  const db = admin.firestore();
  const patientRef = db.collection('patients').doc(String(patientId));

  // 4. Ownership: the reference must live under THIS patient. A guessed path
  //    for someone else's document resolves to nothing here, so the read is
  //    denied before any Storage lookup happens.
  const docSnap = await patientRef.collection(collection).doc(documentId).get();
  if (!docSnap.exists) throw fail(403, 'Not permitted');
  const docData = docSnap.data() || {};

  // 5. Suppression reads as absence, and it is evaluated AFTER healing has had
  //    its say elsewhere — healing only writes bytes, it never grants access.
  const access = await getPortalAccess(patientId);
  if (!isModuleVisible(access, moduleKey)) throw notFound();
  const patientSnap = await patientRef.get();
  const patientData = patientSnap.exists ? patientSnap.data() : {};
  if (isItemHidden(access, patientData, moduleKey, collection, documentId)) throw notFound();

  const path = docData.artifactPath || docData.path;
  if (!path) throw notFound();

  // 6. Object present? Sign it. Missing? Enqueue a server-scoped repair and
  //    return immediately — the member is never blocked on Elation.
  const file = admin.storage().bucket().file(path);
  const [exists] = await file.exists();
  if (!exists) {
    await enqueueRepair({ patientId }, { documentId, path });
    return { ...PREPARING };
  }

  const ttlSeconds = clampTtl(params.ttlSeconds);
  const expires = Date.now() + ttlSeconds * 1000;
  const [url] = await file.getSignedUrl({ action: 'read', expires });

  return {
    url,
    expiresAt: new Date(expires).toISOString(),
    documentId,
    collection,
  };
}

module.exports = {
  handleArtifactRead,
  COLLECTION_MODULE,
  DEFAULT_TTL_SECONDS,
  MAX_TTL_SECONDS,
};
