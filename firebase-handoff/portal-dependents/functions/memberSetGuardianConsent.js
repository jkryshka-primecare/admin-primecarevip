// functions/memberSetGuardianConsent.js
// MEMBER-facing, not admin. Called by the portal after a newly-turned-18
// member answers "keep sharing with your guardian?".
//
// This is the ONLY endpoint in 2b that a patient token may call. It can act on
// exactly one record — the caller's own — and can only resolve entries that are
// already 'pending_adult_consent' into 'active' or 'revoked'. It can never
// create a guardian, and never touches an already-revoked entry.

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { log, logError } = require('./middleware/logger');
const { verifyPatientToken } = require('./middleware/verifyAuth');
const { guardianKey, normalizeUid } = require('./core/services/patient/guardians');

function jsonError(res, status, code, reason, message) {
  return res.status(status).json({
    error: { code: status, status: code, message: message || reason, details: { reason } },
  });
}

exports.memberSetGuardianConsent = functions
  .runWith({ timeoutSeconds: 60 })
  .https.onRequest(async (req, res) => {
    res.set('Cache-Control', 'no-store');

    if (req.method !== 'POST') {
      res.set('Allow', 'POST');
      return jsonError(res, 405, 'FAILED_PRECONDITION', 'METHOD_NOT_ALLOWED');
    }

    // Patient self-auth: token-only, no role gate (D-067). verifyPatientToken
    // throws HttpsError with details.reason; normalize it to this file's
    // JSON error envelope so the member portal sees a stable shape.
    let uid;
    try {
      const auth = await verifyPatientToken(req.headers.authorization || '');
      uid = auth.uid;
    } catch (err) {
      const reason = (err && err.details && err.details.reason) || 'NO_TOKEN';
      return jsonError(res, 401, 'UNAUTHENTICATED', reason);
    }
    if (!uid || uid === 'unauthenticated') {
      return jsonError(res, 401, 'UNAUTHENTICATED', 'NO_TOKEN');
    }

    let body;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    } catch (e) {
      return jsonError(res, 400, 'INVALID_ARGUMENT', 'MALFORMED_BODY');
    }

    // decisions: [{ guardianElationId?, guardianEmail?, allow: bool }]
    const decisions = Array.isArray(body.decisions) ? body.decisions : null;
    if (!decisions || decisions.length === 0 || decisions.length > 10) {
      return jsonError(res, 400, 'INVALID_ARGUMENT', 'DECISIONS_REQUIRED');
    }

    const db = admin.firestore();

    // Resolve the caller's OWN record from the uid. The record id is never
    // taken from the request body — that would be the whole vulnerability.
    let ref;
    try {
      // UID CASE: roster docs store `firebaseUid` lower-cased (the
      // internalUid convention), while the Auth token carries the original
      // mixed-case uid. Try the raw form first for legacy docs, then the
      // normalized form, then `authUid`, so no member is locked out by case.
      const lowered = normalizeUid(uid);
      const attempts = [
        ['firebaseUid', uid],
        ...(lowered !== uid ? [['firebaseUid', lowered]] : []),
        ['authUid', uid],
      ];
      let found = null;
      for (const [field, value] of attempts) {
        // eslint-disable-next-line no-await-in-loop
        const snap = await db.collection('patients').where(field, '==', value).limit(1).get();
        if (!snap.empty) {
          found = snap.docs[0].ref;
          break;
        }
      }
      if (!found) return jsonError(res, 404, 'NOT_FOUND', 'NO_RECORD');
      ref = found;
    } catch (e) {
      logError('memberSetGuardianConsent', 'lookup-failed', { message: e.message });
      return jsonError(res, 500, 'INTERNAL', 'LOOKUP_FAILED');
    }

    let applied = 0;
    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.data() || {};
        if (data.dependent && data.dependent.isMinor) {
          const e = new Error('still a minor');
          e.reason = 'NOT_ELIGIBLE';
          throw e;
        }
        const guardians = Array.isArray(data.guardians) ? data.guardians.slice() : [];
        const now = admin.firestore.Timestamp.now();

        for (const d of decisions) {
          const key = guardianKey({
            guardianElationId: d.guardianElationId,
            guardianEmail: d.guardianEmail,
          });
          const idx = guardians.findIndex((g) => guardianKey(g) === key);
          if (idx < 0) continue;
          // Only a paused entry may be resolved here; a revoked one stays revoked.
          if (guardians[idx].status !== 'pending_adult_consent') continue;
          guardians[idx] = {
            ...guardians[idx],
            status: d.allow === true ? 'active' : 'revoked',
            reason: 'adult consent decision',
            ...(d.allow === true ? {} : { revokedBy: `member:${uid}`, revokedAt: now }),
          };
          applied += 1;
        }

        tx.set(ref, { guardians, guardianConsentAnsweredAt: now }, { merge: true });
      });
    } catch (e) {
      if (e.reason === 'NOT_ELIGIBLE') return jsonError(res, 409, 'FAILED_PRECONDITION', 'NOT_ELIGIBLE');
      logError('memberSetGuardianConsent', 'write-failed', { message: e.message });
      return jsonError(res, 500, 'INTERNAL', 'WRITE_FAILED');
    }

    try {
      await db.collection('portalAdminAudit').add({
        at: admin.firestore.Timestamp.now(),
        action: 'adult_consent_set',
        elationPatientId: ref.id,
        actor: `member:${uid}`,
        reason: 'adult consent decision',
        applied,
        ok: true,
      });
    } catch (e) {
      logError('memberSetGuardianConsent', 'audit-write-failed', { message: e.message });
    }

    log('memberSetGuardianConsent', 'applied', { applied });
    return res.status(200).json({ ok: true, applied });
  });
