// functions/adminRevokeInvite.js
// Admin plane. Kills every live (unused, unexpired) claim token for one
// patient — the "I sent that to the wrong address" / "the member forwarded
// their link" button.
//
// Marking usedAt is exactly what claimAccount treats as spent, so a revoked
// link collapses to the same generic 401 INVALID_TOKEN as a bad one. No new
// token state is invented.

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { log, logError } = require('./middleware/logger');
const { requireAdminCaller, selfAudience } = require('./middleware/requireAdminCaller');

const COLLECTION = 'claimTokens';

function jsonError(res, status, code, reason, message) {
  return res.status(status).json({
    error: { code: status, status: code, message: message || reason, details: { reason } },
  });
}

/**
 * Shared with adminIssueInvite (reissue path). Returns the number of tokens
 * revoked. Never logs or returns raw token material — doc ids are hashes.
 */
async function revokeLiveTokens(elationPatientId, actorEmail, reason) {
  const pid = String(elationPatientId || '').trim();
  if (!pid) throw new Error('revokeLiveTokens: elationPatientId required');

  const db = admin.firestore();
  const snap = await db.collection(COLLECTION).where('elationPatientId', '==', pid).get();

  const now = admin.firestore.Timestamp.now();
  const live = snap.docs.filter((d) => {
    const t = d.data() || {};
    const expMs = t.expiresAt && typeof t.expiresAt.toMillis === 'function' ? t.expiresAt.toMillis() : 0;
    return !t.usedAt && expMs > now.toMillis();
  });
  if (live.length === 0) return 0;

  const batch = db.batch();
  for (const d of live) {
    batch.update(d.ref, {
      usedAt: now,
      revokedAt: now,
      revokedBy: String(actorEmail || 'unknown'),
      revokeReason: String(reason || '').slice(0, 500),
    });
  }
  await batch.commit();
  return live.length;
}

exports.revokeLiveTokens = revokeLiveTokens;

exports.adminRevokeInvite = functions
  .runWith({ timeoutSeconds: 60 })
  .https.onRequest(async (req, res) => {
    res.set('Cache-Control', 'no-store');

    if (req.method !== 'POST') {
      res.set('Allow', 'POST');
      return jsonError(res, 405, 'FAILED_PRECONDITION', 'METHOD_NOT_ALLOWED');
    }

    const gate = await requireAdminCaller(req, selfAudience(req, 'adminRevokeInvite'));
    if (!gate.ok) {
      log('adminRevokeInvite', 'caller-rejected', { reason: gate.reason });
      return jsonError(res, gate.status, 'PERMISSION_DENIED', gate.reason);
    }

    let body;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    } catch (e) {
      return jsonError(res, 400, 'INVALID_ARGUMENT', 'MALFORMED_BODY');
    }
    const elationPatientId = String(body.elationPatientId || '').trim();
    const actor = String(body.actor || '').trim().toLowerCase();
    const reason = String(body.reason || '').slice(0, 500);

    if (!elationPatientId) return jsonError(res, 400, 'INVALID_ARGUMENT', 'PATIENT_ID_REQUIRED');
    if (!actor) return jsonError(res, 400, 'INVALID_ARGUMENT', 'ACTOR_REQUIRED');
    if (!reason) return jsonError(res, 400, 'INVALID_ARGUMENT', 'REASON_REQUIRED');

    let revoked;
    try {
      revoked = await revokeLiveTokens(elationPatientId, actor, reason);
    } catch (e) {
      logError('adminRevokeInvite', 'revoke-failed', { elationPatientId, message: e.message });
      return jsonError(res, 500, 'INTERNAL', 'REVOKE_FAILED');
    }

    try {
      await admin.firestore().collection('portalAdminAudit').add({
        at: admin.firestore.Timestamp.now(),
        action: 'invite_revoked',
        elationPatientId,
        actor,
        reason,
        revokedCount: revoked,
        ok: true,
      });
    } catch (e) {
      logError('adminRevokeInvite', 'audit-write-failed', { message: e.message });
    }

    log('adminRevokeInvite', 'revoked', { elationPatientId, revoked });
    return res.status(200).json({ ok: true, elationPatientId, revoked });
  });
