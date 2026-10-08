// functions/adminSyncMemberEmail.js
// Admin plane. Refreshes ONE member's portal email from their Elation chart.
//
// Why: the roster doc (patients/{elationPatientId}) is written once at
// provisioning (create-if-absent) and the Firebase Auth user is created once
// at claim. Neither ever refreshes, so a member who changes their email in
// Elation/Hint after activating is locked out ("email and password don't
// match") and any invite goes to the stale address. See Brian Weiner,
// 2026-09-24.
//
// Safety:
//   - keyed by Elation patient ID only; the new address is READ FROM THE CHART,
//     never supplied by the caller (a caller-supplied address would be an
//     account-takeover path — same reasoning as adminIssueInvite)
//   - dryRun defaults to TRUE: returns before/after, writes nothing
//   - if a login exists, updates the Auth user's email so the member keeps
//     their account and password; refuses if another Auth user already owns
//     the new address (shared family emails) rather than guessing
//   - every apply writes a portalAdminAudit line
//
// Caller: Prime Care OS backend only (requireAdminCaller), like the other
// admin* functions. Export from functions/index.js and add to ADMIN_FUNCTIONS
// in deploy-production.yml in the same PR.

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { log, logError } = require('./middleware/logger');
const { requireAdminCaller, selfAudience } = require('./middleware/requireAdminCaller');
const { elationGet } = require('./core/services/elation/client');
const { elationEmail } = require('./core/services/patient/rosterProvision');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const lower = (v) => String(v == null ? '' : v).trim().toLowerCase();

function jsonError(res, status, code, reason, message) {
  return res.status(status).json({
    error: { code: status, status: code, message: message || reason, details: { reason } },
  });
}

// Same chart-email rule provisioning uses (first non-deleted entry), so the
// address we sync to is exactly the one a fresh roster doc would get.
function chartEmail(chart) {
  return lower(elationEmail(chart));
}

exports.adminSyncMemberEmail = functions
  .runWith({ timeoutSeconds: 60 })
  .https.onRequest(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
      res.set('Allow', 'POST');
      return jsonError(res, 405, 'FAILED_PRECONDITION', 'METHOD_NOT_ALLOWED');
    }

    const gate = await requireAdminCaller(req, selfAudience(req, 'adminSyncMemberEmail'));
    if (!gate.ok) return jsonError(res, gate.status, 'PERMISSION_DENIED', gate.reason);

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const elationPatientId = String(body.elationPatientId || '').trim();
    const actor = lower(body.actor);
    const reason = String(body.reason || '').slice(0, 500);
    const dryRun = body.dryRun !== false;

    if (!/^\d+$/.test(elationPatientId)) return jsonError(res, 400, 'INVALID_ARGUMENT', 'PATIENT_ID_REQUIRED');
    if (!actor) return jsonError(res, 400, 'INVALID_ARGUMENT', 'ACTOR_REQUIRED');

    const ref = admin.firestore().collection('patients').doc(elationPatientId);
    const snap = await ref.get();
    if (!snap.exists) return jsonError(res, 404, 'NOT_FOUND', 'NO_ROSTER_DOC');
    const patient = snap.data() || {};

    let chart;
    try {
      chart = await elationGet(`/patients/${elationPatientId}/`);
    } catch (e) {
      logError('adminSyncMemberEmail', 'chart-read-failed', { elationPatientId, reason: e.reason });
      return jsonError(res, 502, 'UNAVAILABLE', e.reason || 'ELATION_LOOKUP_FAILED');
    }
    const next = chartEmail(chart);
    if (!EMAIL_RE.test(next)) return jsonError(res, 422, 'FAILED_PRECONDITION', 'NO_EMAIL_ON_CHART');

    const rosterEmail = lower(patient.email);
    // Resolve the member's Firebase Auth account. NEVER getUser(firebaseUid):
    // firebaseUid is the lower-cased Firestore key (D-016/D-125) and Auth uids
    // are case-sensitive (D-112), so it misses for most claimed members — the
    // login email would then silently not be updated (the exact lock-out this
    // function fixes) and the dry-run would wrongly show loginEmail: null.
    // Order: true-case authUid, then the roster email the login was created with.
    let authUser = null;
    const trueUid = String(patient.authUid || '');
    if (trueUid) {
      try {
        authUser = await admin.auth().getUser(trueUid);
      } catch (e) {
        if (e.code !== 'auth/user-not-found') throw e;
      }
    }
    if (!authUser && rosterEmail) {
      try {
        authUser = await admin.auth().getUserByEmail(rosterEmail);
      } catch (e) {
        if (e.code !== 'auth/user-not-found') throw e;
      }
    }
    // A claimed record whose login we cannot find must not be "fixed" on the
    // roster alone — that would only move the mismatch. A human decides.
    if (!authUser && patient.firebaseUid) {
      return jsonError(res, 409, 'FAILED_PRECONDITION', 'LOGIN_NOT_RESOLVABLE');
    }
    const uid = authUser ? authUser.uid : '';
    const loginEmail = authUser ? lower(authUser.email) : null;

    const result = {
      ok: true,
      dryRun,
      elationPatientId,
      before: { rosterEmail, loginEmail },
      after: { rosterEmail: next, loginEmail: loginEmail === null ? null : next },
      changed: rosterEmail !== next || (loginEmail !== null && loginEmail !== next),
    };
    if (dryRun || !result.changed) return res.status(200).json(result);

    if (loginEmail !== null && loginEmail !== next) {
      try {
        const other = await admin.auth().getUserByEmail(next);
        if (other.uid === uid) throw Object.assign(new Error('self'), { code: 'auth/user-not-found' });
        // Someone else already signs in with this address (shared family
        // email). Never merge or steal — a human decides.
        return jsonError(res, 409, 'ALREADY_EXISTS', 'EMAIL_IN_USE_BY_OTHER_LOGIN');
      } catch (e) {
        if (e.code !== 'auth/user-not-found') throw e;
      }
      await admin.auth().updateUser(uid, { email: next, emailVerified: false });
    }
    await ref.update({
      email: next,
      emailSyncedAt: admin.firestore.Timestamp.now(),
      emailSyncedBy: actor,
      updatedAt: admin.firestore.Timestamp.now(),
    });

    await admin.firestore().collection('portalAdminAudit').add({
      at: admin.firestore.Timestamp.now(),
      action: 'member_email_synced',
      elationPatientId,
      actor,
      reason,
      from: rosterEmail,
      to: next,
      loginUpdated: loginEmail !== null && loginEmail !== next,
      ok: true,
    });
    log('adminSyncMemberEmail', 'synced', { elationPatientId });
    return res.status(200).json(result);
  });
