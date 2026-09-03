// functions/adminIssueInvite.js
// Admin plane. Mints a single-use claim token for ONE patient and emails the
// claim link — the same mint + template the human-run scripts/issueInvites.cjs
// uses, moved behind an authenticated endpoint so staff can send from
// Prime Care OS instead of a terminal.
//
// Caller: the Prime Care OS backend only, as portal-admin@prive-care-vip with
// a Google OIDC identity token. No patient token is accepted here.
//
// Safety carried over from the CLI:
//   - one patient per call (no unbounded fan-out)
//   - refuses when a live token already exists unless reissue:true is passed,
//     which revokes the old one first (never two live links for one patient)
//   - raw token is never persisted, never logged, never returned to the caller
//   - every call writes a no-PHI audit line

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const sgMail = require('@sendgrid/mail');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const { log, logError } = require('./middleware/logger');
const { requireAdminCaller, selfAudience } = require('./middleware/requireAdminCaller');
const { issueClaimToken } = require('./core/services/patient/claimToken');
const { revokeLiveTokens } = require('./adminRevokeInvite');

const PROJECT_ID = process.env.GCLOUD_PROJECT || 'prive-care-vip';
const CLAIM_BASE = 'https://care.primecarevip.com/claim';

function jsonError(res, status, code, reason, message) {
  return res.status(status).json({
    error: { code: status, status: code, message: message || reason, details: { reason } },
  });
}

function claimEmailHtml(claimLink) {
  return (
    '<div style="background-color:#f4f4f5;padding:24px 0;font-family:Arial,Helvetica,sans-serif;">' +
      '<div style="width:100%;max-width:600px;box-sizing:border-box;margin:0 auto;background-color:#ffffff;padding:32px;">' +
        '<img src="https://care.primecarevip.com/email/prime-care-vip-email-logo-color.png" alt="Prime Care VIP" width="220" style="width:220px;max-width:70%;height:auto;display:block;margin-bottom:24px;" />' +
        '<p style="color:#333333;font-size:16px;line-height:1.5;margin:0 0 16px;">Dear Prime Care VIP Member,</p>' +
        '<p style="color:#333333;font-size:16px;line-height:1.5;margin:0 0 16px;">We\'re excited to invite you to your new Prime Care VIP Patient Portal! It\'s a secure, convenient way to stay connected with your care, where you can view your lab and imaging results, medications, and upcoming appointments in one place.</p>' +
        '<p style="color:#111111;font-size:18px;font-weight:bold;line-height:1.5;margin:24px 0 8px;">Activate your portal</p>' +
        '<p style="color:#333333;font-size:16px;line-height:1.5;margin:0 0 16px;">Use your unique invitation link below to create your account:</p>' +
        `<p style="margin:0 0 16px;"><a href="${claimLink}" style="color:#1a73e8;font-size:16px;word-break:break-all;">${claimLink}</a></p>` +
        '<p style="color:#333333;font-size:16px;line-height:1.5;margin:0 0 16px;">For your security, this link is just for you and expires in 30 days. If it expires before you finish, contact us and we\'ll send a new one.</p>' +
        '<p style="color:#333333;font-size:16px;line-height:1.5;margin:0 0 24px;">Need help? Email us at health@primecarevip.com or call 561-948-2020.</p>' +
        '<p style="color:#333333;font-size:16px;line-height:1.5;margin:0;">Warmly,<br />The Prime Care VIP Team</p>' +
      '</div>' +
    '</div>'
  );
}

let sendgridReady = false;
async function initSendgrid() {
  if (sendgridReady) return;
  const client = new SecretManagerServiceClient();
  const [version] = await client.accessSecretVersion({
    name: `projects/${PROJECT_ID}/secrets/SENDGRID_API_KEY/versions/latest`,
  });
  sgMail.setApiKey(version.payload.data.toString('utf8'));
  sendgridReady = true;
}

async function audit(entry) {
  try {
    await admin.firestore().collection('portalAdminAudit').add({
      at: admin.firestore.Timestamp.now(),
      ...entry,
    });
  } catch (e) {
    logError('adminIssueInvite', 'audit-write-failed', { message: e.message });
  }
}

exports.adminIssueInvite = functions
  .runWith({ timeoutSeconds: 60 })
  .https.onRequest(async (req, res) => {
    res.set('Cache-Control', 'no-store');

    if (req.method !== 'POST') {
      res.set('Allow', 'POST');
      return jsonError(res, 405, 'FAILED_PRECONDITION', 'METHOD_NOT_ALLOWED');
    }

    const gate = await requireAdminCaller(req, selfAudience(req, 'adminIssueInvite'));
    if (!gate.ok) {
      log('adminIssueInvite', 'caller-rejected', { reason: gate.reason });
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
    const reissue = body.reissue === true;
    // Recovery path for a member whose roster doc says "claimed" but who has no
    // usable credential (claim link consumed, password never set, or the auth
    // user is gone). It deletes the Firebase Auth user, clears the claim marker
    // and then mints a fresh invite. Destructive, so it is explicit and audited.
    const resetClaim = body.resetClaim === true;

    if (!elationPatientId) return jsonError(res, 400, 'INVALID_ARGUMENT', 'PATIENT_ID_REQUIRED');
    if (!actor) return jsonError(res, 400, 'INVALID_ARGUMENT', 'ACTOR_REQUIRED');

    // Roster doc is the only source for the recipient address. There is no
    // caller-supplied override: the emailed link is a single-use account-claim
    // token, so directing it at an arbitrary address would be an account-
    // takeover path. Wrong roster email => fix the roster, then invite.
    const patientRef = admin.firestore().collection('patients').doc(elationPatientId);
    let patient;
    try {
      const snap = await patientRef.get();
      if (!snap.exists) return jsonError(res, 404, 'NOT_FOUND', 'NO_ROSTER_DOC');
      patient = snap.data() || {};
    } catch (e) {
      logError('adminIssueInvite', 'roster-read-failed', { message: e.message });
      return jsonError(res, 500, 'INTERNAL', 'ROSTER_READ_FAILED');
    }

    if (patient.firebaseUid) {
      if (!resetClaim) {
        return jsonError(res, 409, 'ALREADY_EXISTS', 'ALREADY_CLAIMED',
          'This member has already activated their portal account.');
      }
      const previousUid = String(patient.firebaseUid);
      try {
        try {
          await admin.auth().deleteUser(previousUid);
        } catch (e) {
          if (e.code !== 'auth/user-not-found') throw e;
        }
        await patientRef.update({
          firebaseUid: admin.firestore.FieldValue.delete(),
          claimedAt: admin.firestore.FieldValue.delete(),
          webAccessVerifiedAt: admin.firestore.FieldValue.delete(),
          claimReset: {
            at: admin.firestore.Timestamp.now(),
            by: actor,
            reason,
            previousUid,
          },
        });
      } catch (e) {
        logError('adminIssueInvite', 'claim-reset-failed', { elationPatientId, message: e.message });
        return jsonError(res, 500, 'INTERNAL', 'CLAIM_RESET_FAILED');
      }
      await audit({ action: 'claim_reset', elationPatientId, actor, reason, previousUid, ok: true });
      log('adminIssueInvite', 'claim-reset', { elationPatientId });
    }

    const recipient = typeof patient.email === 'string' ? patient.email.trim() : '';
    if (!recipient) return jsonError(res, 422, 'FAILED_PRECONDITION', 'NO_EMAIL_ON_ROSTER');

    if (reissue) {
      try {
        await revokeLiveTokens(elationPatientId, actor, `reissue: ${reason}`);
      } catch (e) {
        logError('adminIssueInvite', 'revoke-before-reissue-failed', { message: e.message });
        return jsonError(res, 500, 'INTERNAL', 'REVOKE_FAILED');
      }
    }

    let rawToken;
    try {
      ({ rawToken } = await issueClaimToken(elationPatientId, 'existing'));
    } catch (e) {
      if (e.code === 'LIVE_TOKEN_EXISTS') {
        return jsonError(res, 409, 'ALREADY_EXISTS', 'LIVE_TOKEN_EXISTS',
          'A live invitation link already exists for this member. Reissue to replace it.');
      }
      logError('adminIssueInvite', 'mint-failed', { elationPatientId, message: e.message });
      return jsonError(res, 500, 'INTERNAL', 'MINT_FAILED');
    }

    const claimLink = `${CLAIM_BASE}?t=${rawToken}`;

    try {
      await initSendgrid();
      await sgMail.send({
        to: recipient,
        from: { email: 'health@primecarevip.com', name: 'Prime Care VIP' },
        subject: 'Your Prime Care VIP patient portal is ready',
        content: [{ type: 'text/html', value: claimEmailHtml(claimLink) }],
      });
    } catch (e) {
      logError('adminIssueInvite', 'send-failed', { elationPatientId, message: e.message });
      // The token is live but undelivered. Revoke it so a half-sent invite
      // never leaves a dangling claim link behind.
      try { await revokeLiveTokens(elationPatientId, actor, 'send failed'); } catch (_) { /* noop */ }
      await audit({
        action: 'invite_send_failed', elationPatientId, actor, reason, sentTo: recipient, ok: false,
      });
      return jsonError(res, 502, 'UNAVAILABLE', 'EMAIL_SEND_FAILED');
    }

    await audit({
      action: reissue ? 'invite_reissued' : 'invite_sent',
      elationPatientId,
      actor,
      reason,
      // The destination is the whole risk surface for this action, so it is
      // recorded verbatim. It is roster data, never caller-supplied.
      sentTo: recipient,
      ok: true,
    });
    log('adminIssueInvite', 'sent', { elationPatientId, reissue });

    return res.status(200).json({
      ok: true,
      elationPatientId,
      sentAt: new Date().toISOString(),
      // Raw token deliberately absent. The admin app never sees a live link.
    });
  });
