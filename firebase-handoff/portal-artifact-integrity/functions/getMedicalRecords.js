// functions/getMedicalRecords.js
// #282 — Patient self-read of their own medical-records documents (read-from-store, list + artifact).
// Clone of getImaging: reads the poller's stored docs at labs/category=='medical_records',
// never live Elation, no secrets. Medical records carry NO structured results (metadata + PDF only),
// so the response omits `results` entirely. No `resultedDate` on these docs — sort/display by documentDate.
// Flow: verifyPatientToken -> Guard B -> resolvePatientForCaller(uid) ->
//   D-068 allowlist gate ->
//   phi_access_log fail-fast (own_medical_records_viewed | own_medical_record_artifact_viewed) BEFORE any PHI read ->
//   artifact mode (reportId present): storage-only 30-min v4 signed URL (D-072 keyless) ->
//   list mode: Firestore read labs/category=='medical_records', not tombstoned -> reshape -> return.
// Errors use the jsonError envelope (raw onRequest — no HttpsError).

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { verifyPatientToken } = require('./middleware/verifyAuth');
const { log, logError } = require('./middleware/logger');
const { resolvePatientForCaller } = require('./core/services/elation/resolvePatientForCaller');
const {
  getPortalAccess, assertNotSuspended, isModuleVisible, filterHidden,
} = require('./core/services/patient/portalAccess');
const { handleArtifactRead } = require('./core/services/artifacts/readArtifact');

const ALLOWED_ORIGINS = ['https://care.primecarevip.com', 'http://localhost:5173'];

function isReadAllowed(elationPatientId) {
  if (process.env.ELATION_FULL_SYNC_ENABLED === 'true') return true;
  const allow = (process.env.ELATION_READ_ALLOWLIST || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  return allow.includes(String(elationPatientId));
}

function jsonError(res, status, code, reason, message) {
  return res.status(status).json({
    error: { code: status, status: code, message: message || reason, details: { reason, metadata: {} } },
  });
}

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
  }
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');
}

exports.getMedicalRecords = functions
  .https.onRequest(async (req, res) => {
    setCors(req, res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') {
      res.set('Allow', 'POST, OPTIONS');
      return jsonError(res, 405, 'FAILED_PRECONDITION', 'METHOD_NOT_ALLOWED', 'Only POST is supported.');
    }

    let user;
    try {
      user = await verifyPatientToken(req.headers.authorization);
    } catch (err) {
      return jsonError(
        res,
        err.httpErrorCode?.status || 401,
        (err.code === 'unauthenticated' ? 'UNAUTHENTICATED' : err.code === 'permission-denied' ? 'PERMISSION_DENIED' : err.code) || 'UNAUTHENTICATED',
        err.details?.reason || 'NO_TOKEN',
        err.message,
      );
    }

    if (!user || user.uid === 'unauthenticated') {
      return jsonError(res, 401, 'UNAUTHENTICATED', 'NO_TOKEN', 'Authentication required.');
    }

    const uid = user.uid.toLowerCase();

    const reportId = (req.body && req.body.reportId != null && req.body.reportId !== '')
      ? String(req.body.reportId)
      : null;
    const wantArtifact = reportId !== null;

    let doc;
    try {
      doc = await resolvePatientForCaller(uid);
    } catch (err) {
      const status = err.httpErrorCode?.status || 500;
      const reason = err.details?.reason || 'INTERNAL';
      const code = status === 404 ? 'NOT_FOUND' : status === 401 ? 'UNAUTHENTICATED' : 'INTERNAL';
      if (status >= 500) logError('getMedicalRecords', 'resolve-failed', err, { uid, reason });
      return jsonError(res, status, code, reason, err.message);
    }
    const elationPatientId = doc.id;
    const d = doc.data() || {};

    if (!isReadAllowed(elationPatientId)) {
      log('getMedicalRecords', 'not-allowlisted', { uid });
      return jsonError(res, 403, 'PERMISSION_DENIED', 'NOT_IN_ALLOWLIST', 'Records access is not enabled for this account yet.');
    }

    try {
      await admin.firestore().collection('phi_access_log').add({
        uid,
        role: user.role || 'patient',
        action: wantArtifact ? 'own_medical_record_artifact_viewed' : 'own_medical_records_viewed',
        elationPatientId,
        ...(wantArtifact ? { reportId } : {}),
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (err) {
      logError('getMedicalRecords', 'audit-failed', err, { uid });
      return jsonError(res, 500, 'INTERNAL', 'LOG_WRITE_ERROR', 'Failed to write access log.');
    }

    // Portal control plane (Prime Care OS) — suspension fails CLOSED, module
    // visibility fails OPEN. Placed after the audit-first write so a denial is
    // still recorded in phi_access_log.
    try {
      await assertNotSuspended(elationPatientId);
    } catch (err) {
      if (err.portalReason === 'ACCESS_SUSPENDED') {
        log('getMedicalRecords', 'access-suspended', { uid });
        return jsonError(res, 403, 'PERMISSION_DENIED', 'ACCESS_SUSPENDED',
          'Portal access for this account is currently paused. Please contact our office.');
      }
      logError('getMedicalRecords', 'access-check-failed', err, { uid });
      return jsonError(res, 503, 'UNAVAILABLE', 'ACCESS_CHECK_FAILED', 'Please try again in a moment.');
    }

    // getPortalAccess never throws — it returns the all-visible default on error.
    const portalAccess = await getPortalAccess(elationPatientId);
    if (!wantArtifact && !isModuleVisible(portalAccess, 'records')) {
      log('getMedicalRecords', 'module-hidden', { uid });
      return res.status(200).json({ moduleUnavailable: true });
    }

    // --- Artifact mode (Release 2a, Option A): delegated to THE shared read
    // path. Ownership (uid-keyed storage prefix), suppression (module off or
    // item hidden -> 404 ARTIFACT_NOT_SYNCED), the missing-object repair
    // enqueue and signing all live in one module now. Identity is derived
    // server-side from the bearer token; req.body is never an identity source.
    // The audit-first phi_access_log write above still runs before this call,
    // so denials remain audited.
    if (wantArtifact) {
      try {
        const out = await handleArtifactRead(req, { reportId, module: 'records', ttlSeconds: 300 });
        log('getMedicalRecords', out.state ? 'artifact-preparing' : 'artifact-ok', { uid, reportId });
        return res.status(200).json(out);
      } catch (err) {
        if ((err.status || 500) >= 500) logError('getMedicalRecords', 'artifact-failed', err, { uid, reportId });
        return jsonError(res, err.status || 500, err.code || 'INTERNAL', err.reason || 'INTERNAL', err.message);
      }
    }

    let snap;
    try {
      snap = await admin.firestore()
        .collection('patients').doc(elationPatientId)
        .collection('labs')
        .where('category', '==', 'medical_records')
        .where('deleted', '==', false)
        .get();
    } catch (err) {
      logError('getMedicalRecords', 'store-read-failed', err, { uid });
      return jsonError(res, 502, 'INTERNAL', 'FIRESTORE_READ_ERROR', 'Could not load your medical records.');
    }

    const medicalRecords = snap.docs.map((docSnap) => {
      const x = docSnap.data() || {};
      return {
        id: docSnap.id,
        title: x.title ?? null,
        reportType: x.reportType ?? null,
        subCategory: x.subCategory ?? null,
        documentDate: x.documentDate ?? null,
        hasArtifact: !!x.hasArtifact,
      };
    });
    medicalRecords.sort((a, b) => String(b.documentDate || '').localeCompare(String(a.documentDate || '')));
    log('getMedicalRecords', 'ok', { uid, count: medicalRecords.length });
    const visibleMedicalRecords = filterHidden(portalAccess, 'records', medicalRecords, (it) => it.id);
    return res.status(200).json({ medicalRecords: visibleMedicalRecords, moduleUnavailable: false });
  });
