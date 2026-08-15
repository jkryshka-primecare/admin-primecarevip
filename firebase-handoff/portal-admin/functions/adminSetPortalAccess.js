// functions/adminSetPortalAccess.js
// Admin plane. Writes the per-member visibility + access state that the read
// endpoints enforce (see ENFORCEMENT.md).
//
// Only three things can change: status, module visibility, hidden item ids.
// There is no code path here that touches the roster doc, Elation, or Hint.

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { log, logError } = require('./middleware/logger');
const { requireAdminCaller, selfAudience } = require('./middleware/requireAdminCaller');
const { setPortalAccess, MODULES } = require('./core/services/patient/portalAccess');

function jsonError(res, status, code, reason, message) {
  return res.status(status).json({
    error: { code: status, status: code, message: message || reason, details: { reason } },
  });
}

exports.adminSetPortalAccess = functions
  .runWith({ timeoutSeconds: 60 })
  .https.onRequest(async (req, res) => {
    res.set('Cache-Control', 'no-store');

    if (req.method !== 'POST') {
      res.set('Allow', 'POST');
      return jsonError(res, 405, 'FAILED_PRECONDITION', 'METHOD_NOT_ALLOWED');
    }

    const gate = await requireAdminCaller(req, selfAudience(req, 'adminSetPortalAccess'));
    if (!gate.ok) {
      log('adminSetPortalAccess', 'caller-rejected', { reason: gate.reason });
      return jsonError(res, gate.status, 'PERMISSION_DENIED', gate.reason);
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const elationPatientId = String(body.elationPatientId || '').trim();
    const actor = String(body.actor || '').trim().toLowerCase();
    const reason = String(body.reason || '').slice(0, 500);
    const patch = body.patch && typeof body.patch === 'object' ? body.patch : null;

    if (!elationPatientId) return jsonError(res, 400, 'INVALID_ARGUMENT', 'PATIENT_ID_REQUIRED');
    if (!actor) return jsonError(res, 400, 'INVALID_ARGUMENT', 'ACTOR_REQUIRED');
    if (!reason) return jsonError(res, 400, 'INVALID_ARGUMENT', 'REASON_REQUIRED');
    if (!patch) return jsonError(res, 400, 'INVALID_ARGUMENT', 'PATCH_REQUIRED');

    if (patch.status && patch.status !== 'active' && patch.status !== 'suspended') {
      return jsonError(res, 400, 'INVALID_ARGUMENT', 'INVALID_STATUS');
    }
    for (const key of Object.keys(patch.modules || {})) {
      if (!MODULES.includes(key)) return jsonError(res, 400, 'INVALID_ARGUMENT', 'UNKNOWN_MODULE');
    }
    for (const key of Object.keys(patch.hiddenItems || {})) {
      if (!MODULES.includes(key)) return jsonError(res, 400, 'INVALID_ARGUMENT', 'UNKNOWN_MODULE');
    }

    let result;
    try {
      result = await setPortalAccess(elationPatientId, patch, actor, reason);
    } catch (e) {
      logError('adminSetPortalAccess', 'write-failed', { elationPatientId, message: e.message });
      return jsonError(res, 500, 'INTERNAL', 'WRITE_FAILED');
    }

    try {
      await admin.firestore().collection('portalAdminAudit').add({
        at: admin.firestore.Timestamp.now(),
        action: 'portal_access_set',
        elationPatientId,
        actor,
        reason,
        before: result.before,
        after: result.after,
        ok: true,
      });
    } catch (e) {
      logError('adminSetPortalAccess', 'audit-write-failed', { message: e.message });
    }

    log('adminSetPortalAccess', 'updated', { elationPatientId });
    return res.status(200).json({ ok: true, elationPatientId, before: result.before, after: result.after });
  });
