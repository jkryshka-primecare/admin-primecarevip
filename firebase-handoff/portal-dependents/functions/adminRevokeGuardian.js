// functions/adminRevokeGuardian.js
// Admin plane. Sets ONE guardian entry to status: 'revoked'. The entry is kept
// (never deleted) so the audit trail can answer "who had access, when".
//
// A revoked guardian reads exactly like a stranger: denied at the identity
// check in readArtifact.js, no "access was removed" signal in the member UI.

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { log, logError } = require('./middleware/logger');
const { requireAdminCaller, selfAudience } = require('./middleware/requireAdminCaller');
const { revokeGuardian } = require('./core/services/patient/guardians');

function jsonError(res, status, code, reason, message) {
  return res.status(status).json({
    error: { code: status, status: code, message: message || reason, details: { reason } },
  });
}

const REASON_STATUS = {
  CHILD_NOT_FOUND: [404, 'NOT_FOUND'],
  GUARDIAN_NOT_FOUND: [404, 'NOT_FOUND'],
};

exports.adminRevokeGuardian = functions
  .runWith({ timeoutSeconds: 60 })
  .https.onRequest(async (req, res) => {
    res.set('Cache-Control', 'no-store');

    if (req.method !== 'POST') {
      res.set('Allow', 'POST');
      return jsonError(res, 405, 'FAILED_PRECONDITION', 'METHOD_NOT_ALLOWED');
    }

    const gate = await requireAdminCaller(req, selfAudience(req, 'adminRevokeGuardian'));
    if (!gate.ok) {
      log('adminRevokeGuardian', 'caller-rejected', { reason: gate.reason });
      return jsonError(res, gate.status, 'PERMISSION_DENIED', gate.reason);
    }

    let body;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    } catch (e) {
      return jsonError(res, 400, 'INVALID_ARGUMENT', 'MALFORMED_BODY');
    }

    const childElationId = String(body.childElationId || '').trim();
    const actor = String(body.actor || '').trim().toLowerCase();
    const reason = String(body.reason || '').slice(0, 500);
    const guardianElationId = String(body.guardianElationId || '').trim();
    const guardianEmail = String(body.guardianEmail || '').trim().toLowerCase();

    if (!childElationId) return jsonError(res, 400, 'INVALID_ARGUMENT', 'CHILD_ID_REQUIRED');
    if (!actor) return jsonError(res, 400, 'INVALID_ARGUMENT', 'ACTOR_REQUIRED');
    if (!reason) return jsonError(res, 400, 'INVALID_ARGUMENT', 'REASON_REQUIRED');
    if (!guardianElationId && !guardianEmail) {
      return jsonError(res, 400, 'INVALID_ARGUMENT', 'GUARDIAN_IDENTITY_REQUIRED');
    }

    let result;
    try {
      result = await revokeGuardian(
        childElationId,
        { guardianElationId: guardianElationId || null, guardianEmail },
        actor,
        reason,
      );
    } catch (e) {
      const mapped = REASON_STATUS[e.reason];
      if (mapped) {
        log('adminRevokeGuardian', 'rejected', { childElationId, reason: e.reason });
        return jsonError(res, mapped[0], mapped[1], e.reason);
      }
      logError('adminRevokeGuardian', 'write-failed', { childElationId, message: e.message });
      return jsonError(res, 500, 'INTERNAL', 'WRITE_FAILED');
    }

    try {
      await admin.firestore().collection('portalAdminAudit').add({
        at: admin.firestore.Timestamp.now(),
        action: 'guardian_revoked',
        elationPatientId: childElationId,
        actor,
        reason,
        guardianRef: guardianElationId || `email:${guardianEmail.split('@')[1] || 'redacted'}`,
        previousStatus: result.before.status,
        ok: true,
      });
    } catch (e) {
      logError('adminRevokeGuardian', 'audit-write-failed', { message: e.message });
    }

    log('adminRevokeGuardian', 'revoked', { childElationId });
    return res.status(200).json({ ok: true, childElationId, guardian: result.after });
  });
