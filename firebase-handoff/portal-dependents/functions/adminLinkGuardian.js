// functions/adminLinkGuardian.js
// Admin plane. Attaches ONE guardian proxy to ONE minor. Idempotent per
// (child, guardian) pair, so the 194-row batch can be replayed safely.
//
// Writes only patients/<childElationId>.guardians[] + .dependent and one
// audit line. Never touches Elation, Hint, or portalAccess.

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { log, logError } = require('./middleware/logger');
const { requireAdminCaller, selfAudience } = require('./middleware/requireAdminCaller');
const { linkGuardian, SOURCES } = require('./core/services/patient/guardians');

function jsonError(res, status, code, reason, message) {
  return res.status(status).json({
    error: { code: status, status: code, message: message || reason, details: { reason } },
  });
}

const REASON_STATUS = {
  CHILD_NOT_FOUND: [404, 'NOT_FOUND'],
  CHILD_IS_ADULT: [409, 'FAILED_PRECONDITION'],
  CHILD_DOB_UNKNOWN: [409, 'FAILED_PRECONDITION'],
  SELF_LINK_REJECTED: [400, 'INVALID_ARGUMENT'],
  UNKNOWN_SOURCE: [400, 'INVALID_ARGUMENT'],
  GUARDIAN_IDENTITY_REQUIRED: [400, 'INVALID_ARGUMENT'],
};

exports.adminLinkGuardian = functions
  .runWith({ timeoutSeconds: 60 })
  .https.onRequest(async (req, res) => {
    res.set('Cache-Control', 'no-store');

    if (req.method !== 'POST') {
      res.set('Allow', 'POST');
      return jsonError(res, 405, 'FAILED_PRECONDITION', 'METHOD_NOT_ALLOWED');
    }

    const gate = await requireAdminCaller(req, selfAudience(req, 'adminLinkGuardian'));
    if (!gate.ok) {
      log('adminLinkGuardian', 'caller-rejected', { reason: gate.reason });
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
    const source = String(body.source || '').trim();
    const guardianElationId = String(body.guardianElationId || '').trim();
    const guardianHintId = String(body.guardianHintId || '').trim();
    const guardianEmail = String(body.guardianEmail || '').trim().toLowerCase();
    const guardianName = String(body.guardianName || '').trim();

    if (!childElationId) return jsonError(res, 400, 'INVALID_ARGUMENT', 'CHILD_ID_REQUIRED');
    if (!actor) return jsonError(res, 400, 'INVALID_ARGUMENT', 'ACTOR_REQUIRED');
    if (!reason) return jsonError(res, 400, 'INVALID_ARGUMENT', 'REASON_REQUIRED');
    if (!SOURCES.includes(source)) return jsonError(res, 400, 'INVALID_ARGUMENT', 'UNKNOWN_SOURCE');
    // Every row in the finalized export carries an email; it is the invite
    // target for email_on_file and the display fallback for the rest.
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(guardianEmail)) {
      return jsonError(res, 400, 'INVALID_ARGUMENT', 'GUARDIAN_EMAIL_INVALID');
    }
    if (source !== 'email_on_file' && !guardianElationId) {
      return jsonError(res, 400, 'INVALID_ARGUMENT', 'GUARDIAN_CHART_REQUIRED');
    }

    let result;
    try {
      result = await linkGuardian(
        childElationId,
        {
          guardianElationId: guardianElationId || null,
          guardianHintId: guardianHintId || null,
          guardianEmail,
          guardianName: guardianName || null,
          source,
        },
        actor,
        reason,
      );
    } catch (e) {
      const mapped = REASON_STATUS[e.reason];
      if (mapped) {
        log('adminLinkGuardian', 'rejected', { childElationId, reason: e.reason });
        return jsonError(res, mapped[0], mapped[1], e.reason);
      }
      logError('adminLinkGuardian', 'write-failed', { childElationId, message: e.message });
      return jsonError(res, 500, 'INTERNAL', 'WRITE_FAILED');
    }

    try {
      await admin.firestore().collection('portalAdminAudit').add({
        at: admin.firestore.Timestamp.now(),
        action: 'guardian_linked',
        elationPatientId: childElationId,
        actor,
        reason,
        created: result.created,
        source,
        // No names, no DOBs: the audit line stays PHI-free.
        guardianRef: guardianElationId || `email:${guardianEmail.split('@')[1] || 'redacted'}`,
        ok: true,
      });
    } catch (e) {
      logError('adminLinkGuardian', 'audit-write-failed', { message: e.message });
    }

    log('adminLinkGuardian', result.created ? 'linked' : 'updated', { childElationId, source });
    return res.status(200).json({
      ok: true,
      childElationId,
      created: result.created,
      guardian: result.after,
    });
  });
