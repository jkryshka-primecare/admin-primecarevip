// functions/getLabs.js
// #228 — Patient self-read of their own lab reports (read-from-store, list + artifact).
// Twin of getImaging / getMedicalRecords: list mode reads the poller's stored
// docs, NOT live Elation. The old Elation GET /reports + client-side
// report_type==='Lab' filter was retired by D-079 / #233 — selection is now
// category == 'lab' on the stored docs, excluding tombstoned ones. The poller
// already ran mapLabReport at ingest, so stored docs carry the patient-safe
// shape and there is no re-normalize on the request path.
// Flow: verifyPatientToken -> Guard B -> resolvePatientForCaller(uid) ->
//   D-068 allowlist gate ->
//   phi_access_log fail-fast (own_labs_viewed) BEFORE any PHI read ->
//   portalAccess: assertNotSuspended (fails CLOSED, 403 ACCESS_SUSPENDED) ->
//   isModuleVisible('labs') (fails OPEN; hidden -> 200 { items: [], moduleUnavailable: true }) ->
//   Firestore read: this patient's labs subcollection, category == 'lab',
//   not tombstoned -> reshape to the list contract -> filterHidden -> return.
// Two modes (Option A, switched by presence of reportId in the POST body):
//   list mode (no reportId): stored structured results + report metadata.
//   artifact mode (reportId): serve the report PDF the sync already stored in
//     Firebase Storage via a 30-min v4 signed URL. STORAGE-ONLY — the patient
//     path never calls Elation; ownership is proven by the uid-keyed storage
//     path (elation-artifacts/<firebaseUid>/<reportId>/report.pdf). Not synced
//     yet, or suppressed by portalAccess -> 404 ARTIFACT_NOT_SYNCED. PDFs are
//     populated by the sync/seed side (D-065 store-once), never fetched on the
//     patient request. Signing uses the runtime SA's serviceAccountTokenCreator
//     self-grant (keyless, D-072).
// Secrets: ELATION_CLIENT_ID, ELATION_CLIENT_SECRET still bound via runWith —
// kept for the shared Elation-backed helpers on this module's cold path; the
// patient read itself does not call Elation.

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

// D-068 — pre-G9 read gate. A patient may read Elation data only if we're live
// (ELATION_FULL_SYNC_ENABLED) OR their resolved elationPatientId is explicitly
// allowlisted (ELATION_READ_ALLOWLIST, comma-separated). Self-retires post-G9.
// D-064 ownership remains the permanent control.
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

exports.getLabs = functions
  .runWith({ secrets: ['ELATION_CLIENT_ID', 'ELATION_CLIENT_SECRET'] })
  .https.onRequest(async (req, res) => {
    setCors(req, res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') {
      res.set('Allow', 'POST, OPTIONS');
      return jsonError(res, 405, 'FAILED_PRECONDITION', 'METHOD_NOT_ALLOWED', 'Only POST is supported.');
    }

    // --- Auth (verifyPatientToken only; ownership enforced by the resolver query) ---
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

    // Guard B: never run a PHI read for the permissive-mode sentinel.
    if (!user || user.uid === 'unauthenticated') {
      return jsonError(res, 401, 'UNAUTHENTICATED', 'NO_TOKEN', 'Authentication required.');
    }

    const uid = user.uid.toLowerCase();

    // Option A: presence of reportId switches this call from list mode to
    // artifact mode. Absent -> return the lab list (unchanged behavior).
    const reportId = (req.body && req.body.reportId != null && req.body.reportId !== '')
      ? String(req.body.reportId)
      : null;
    const wantArtifact = reportId !== null;

    // 1) Resolve caller's own bound patient doc (never a client-supplied id).
    let doc;
    try {
      doc = await resolvePatientForCaller(uid);
    } catch (err) {
      const status = err.httpErrorCode?.status || 500;
      const reason = err.details?.reason || 'INTERNAL';
      const code = status === 404 ? 'NOT_FOUND' : status === 401 ? 'UNAUTHENTICATED' : 'INTERNAL';
      if (status >= 500) logError('getLabs', 'resolve-failed', err, { uid, reason });
      return jsonError(res, status, code, reason, err.message);
    }
    const elationPatientId = doc.id;
    const d = doc.data() || {};

    // D-068 pre-G9 read gate — fail closed if not live and not allowlisted.
    if (!isReadAllowed(elationPatientId)) {
      log('getLabs', 'not-allowlisted', { uid });
      return jsonError(res, 403, 'PERMISSION_DENIED', 'NOT_IN_ALLOWLIST', 'Records access is not enabled for this account yet.');
    }

    // 3) AUDIT FIRST — fail-fast BEFORE any PHI read; captures which record.
    try {
      await admin.firestore().collection('phi_access_log').add({
        uid,
        role: user.role || 'patient',
        action: wantArtifact ? 'own_lab_artifact_viewed' : 'own_labs_viewed',
        elationPatientId,
        ...(wantArtifact ? { reportId } : {}),
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (err) {
      logError('getLabs', 'audit-failed', err, { uid });
      return jsonError(res, 500, 'INTERNAL', 'LOG_WRITE_ERROR', 'Failed to write access log.');
    }

    // Portal control plane (Prime Care OS) — suspension fails CLOSED, module
    // visibility fails OPEN. Placed after the audit-first write so a denial is
    // still recorded in phi_access_log.
    try {
      await assertNotSuspended(elationPatientId);
    } catch (err) {
      if (err.portalReason === 'ACCESS_SUSPENDED') {
        log('getLabs', 'access-suspended', { uid });
        return jsonError(res, 403, 'PERMISSION_DENIED', 'ACCESS_SUSPENDED',
          'Portal access for this account is currently paused. Please contact our office.');
      }
      logError('getLabs', 'access-check-failed', err, { uid });
      return jsonError(res, 503, 'UNAVAILABLE', 'ACCESS_CHECK_FAILED', 'Please try again in a moment.');
    }

    // getPortalAccess never throws — it returns the all-visible default on error.
    const portalAccess = await getPortalAccess(elationPatientId);
    if (!wantArtifact && !isModuleVisible(portalAccess, 'labs')) {
      log('getLabs', 'module-hidden', { uid });
      return res.status(200).json({ moduleUnavailable: true });
    }

    // --- Artifact mode (storage-only): serve a PDF the sync already stored.
    // The patient path NEVER calls Elation. Ownership is proven by the
    // uid-keyed storage path — only this caller's synced files live under
    // their firebaseUid. Not synced yet -> 404, never a live fetch.
    // --- Artifact mode (Release 2a, Option A): delegated to THE shared read
    // path. Ownership (uid-keyed storage prefix), suppression (module off or
    // item hidden -> 404 ARTIFACT_NOT_SYNCED), the missing-object repair
    // enqueue and signing all live in one module now. Identity is derived
    // server-side from the bearer token; req.body is never an identity source.
    // The audit-first phi_access_log write above still runs before this call,
    // so denials remain audited.
    if (wantArtifact) {
      try {
        const out = await handleArtifactRead(req, { reportId, module: 'labs', ttlSeconds: 300 });
        log('getLabs', out.state ? 'artifact-preparing' : 'artifact-ok', { uid, reportId });
        return res.status(200).json(out);
      } catch (err) {
        if ((err.status || 500) >= 500) logError('getLabs', 'artifact-failed', err, { uid, reportId });
        return jsonError(res, err.status || 500, err.code || 'INTERNAL', err.reason || 'INTERNAL', err.message);
      }
    }

    // 4) Read-from-store (D-079 / #233): list mode reads the poller's stored lab
    //    docs, not live Elation. Scope: this patient's own labs subcollection,
    //    category == 'lab', not tombstoned. The poller already ran mapLabReport at
    //    ingest, so stored docs carry the patient-safe shape — no re-normalize here.
    let snap;
    try {
      snap = await admin.firestore()
        .collection('patients').doc(elationPatientId)
        .collection('labs')
        .where('category', '==', 'lab')
        .where('deleted', '==', false)
        .get();
    } catch (err) {
      logError('getLabs', 'store-read-failed', err, { uid });
      return jsonError(res, 502, 'INTERNAL', 'FIRESTORE_READ_ERROR', 'Could not load your lab results.');
    }

    // 5) Reshape stored docs into the exact response shape the web app already
    //    consumes (contract-stable; INTEGRATION-CONTRACT v1.28). id = doc id
    //    (= reportId). reportType is a stored top-level field. Newest-first by
    //    resultedDate, matching the prior normalizeLabs sort.
    const labs = snap.docs.map((docSnap) => {
      const x = docSnap.data() || {};
      return {
        id: docSnap.id,
        title: x.title ?? null,
        reportType: x.reportType ?? null,
        documentDate: x.documentDate ?? null,
        resultedDate: x.resultedDate ?? null,
        hasArtifact: !!x.hasArtifact,
        results: Array.isArray(x.results) ? x.results : [],
      };
    });
    labs.sort((a, b) => String(b.resultedDate || '').localeCompare(String(a.resultedDate || '')));
    log('getLabs', 'ok', { uid, count: labs.length });
    const visibleLabs = filterHidden(portalAccess, 'labs', labs, (it) => it.id);
    return res.status(200).json({ labs: visibleLabs, moduleUnavailable: false });
  });
