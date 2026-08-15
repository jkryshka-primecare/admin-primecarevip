// functions/adminGetPortalAccess.js
// Admin plane, read-only. One call that tells Prime Care OS everything it
// needs to render a member's Portal tab:
//
//   - claim state (never invited / invited with a live link / claimed)
//   - current visibility + access doc
//   - the roster demographics the portal actually shows, so staff can compare
//     them against Elation and spot drift
//
// Raw claim tokens are never exposed — doc ids are sha256 hashes and are not
// returned. Only "a live token exists, expiring on X" is disclosed.

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { log, logError } = require('./middleware/logger');
const { requireAdminCaller, selfAudience } = require('./middleware/requireAdminCaller');
const { getPortalAccess } = require('./core/services/patient/portalAccess');

function jsonError(res, status, code, reason, message) {
  return res.status(status).json({
    error: { code: status, status: code, message: message || reason, details: { reason } },
  });
}

function iso(ts) {
  return ts && typeof ts.toDate === 'function' ? ts.toDate().toISOString() : null;
}

exports.adminGetPortalAccess = functions
  .runWith({ timeoutSeconds: 60 })
  .https.onRequest(async (req, res) => {
    res.set('Cache-Control', 'no-store');

    if (req.method !== 'POST') {
      res.set('Allow', 'POST');
      return jsonError(res, 405, 'FAILED_PRECONDITION', 'METHOD_NOT_ALLOWED');
    }

    const gate = await requireAdminCaller(req, selfAudience(req, 'adminGetPortalAccess'));
    if (!gate.ok) {
      log('adminGetPortalAccess', 'caller-rejected', { reason: gate.reason });
      return jsonError(res, gate.status, 'PERMISSION_DENIED', gate.reason);
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const elationPatientId = String(body.elationPatientId || '').trim();
    if (!elationPatientId) return jsonError(res, 400, 'INVALID_ARGUMENT', 'PATIENT_ID_REQUIRED');

    try {
      const db = admin.firestore();
      const [rosterSnap, tokenSnap, access] = await Promise.all([
        db.collection('patients').doc(elationPatientId).get(),
        db.collection('claimTokens').where('elationPatientId', '==', elationPatientId).get(),
        getPortalAccess(elationPatientId),
      ]);

      if (!rosterSnap.exists) return jsonError(res, 404, 'NOT_FOUND', 'NO_ROSTER_DOC');
      const p = rosterSnap.data() || {};

      const nowMs = Date.now();
      let liveToken = null;
      let lastIssuedAt = null;
      for (const d of tokenSnap.docs) {
        const t = d.data() || {};
        const created = iso(t.createdAt);
        if (created && (!lastIssuedAt || created > lastIssuedAt)) lastIssuedAt = created;
        const expMs = t.expiresAt && typeof t.expiresAt.toMillis === 'function' ? t.expiresAt.toMillis() : 0;
        if (!t.usedAt && expMs > nowMs) {
          liveToken = { expiresAt: iso(t.expiresAt), issuedAt: created, cohort: t.cohort || null };
        }
      }

      const claimed = Boolean(p.firebaseUid);
      const claimState = claimed
        ? 'claimed'
        : liveToken
          ? 'invited'
          : lastIssuedAt
            ? 'expired_or_revoked'
            : 'not_invited';

      return res.status(200).json({
        ok: true,
        elationPatientId,
        claim: {
          state: claimState,
          claimedAt: iso(p.claimedAt) || null,
          liveToken,
          lastIssuedAt,
          webAccessVerifiedAt: iso(p.webAccessVerifiedAt) || null,
        },
        access,
        roster: {
          firstName: p.firstName || null,
          lastName: p.lastName || null,
          email: p.email || null,
          phone: p.phone || null,
          dob: p.dob || null,
          status: p.status || null,
          updatedAt: iso(p.updatedAt) || null,
        },
      });
    } catch (e) {
      logError('adminGetPortalAccess', 'read-failed', { elationPatientId, message: e.message });
      return jsonError(res, 500, 'INTERNAL', 'READ_FAILED');
    }
  });
