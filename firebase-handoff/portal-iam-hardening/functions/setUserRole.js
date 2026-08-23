// functions/setUserRole.js
// Role mutation. Callable (onCall) — invoked directly by the signed-in admin
// console, so its public IAM invoker binding is load-bearing and it is
// deliberately NOT in the deploy workflow's ADMIN_FUNCTIONS lock list. The gate
// below is the only authorization boundary, so it is hard:
//
//   1. super_admin only. `admin` previously could mint `super_admin` — that was
//      a privilege-escalation path and is closed here.
//   2. No self-mutation. A super_admin cannot change their own role (demotion
//      lockout / silent self-elevation).
//   3. Audit-row-first, fail closed. The `role_change_audit` row is written
//      BEFORE the claim is set; if the write fails, the claim is never set.
//   4. A grant of `super_admin` additionally emits a WARNING log line
//      (`event: "super_admin_granted"`) for the log-based alert.

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { verifyAuth, requireRole, VALID_ROLES } = require('./middleware/verifyAuth');
const { log, logError } = require('./middleware/logger');

// Roles that confer administrative power over other accounts.
const PRIVILEGED_ROLES = ['super_admin', 'admin'];

exports.setUserRole = functions.https.onCall(async (data, context) => {
  let caller;
  try {
    caller = await verifyAuth(context);
  } catch (err) {
    throw err;
  }

  // Role mutation is super_admin-only. An `admin` must not be able to grant
  // `admin`/`super_admin` to anyone, including themselves.
  requireRole(caller, ['super_admin']);

  const { uid, role, reason } = data || {};

  if (!uid || typeof uid !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'uid is required', {
      reason: 'MISSING_PARAM',
      metadata: { field: 'uid' },
    });
  }
  if (!role || typeof role !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'role is required', {
      reason: 'MISSING_PARAM',
      metadata: { field: 'role' },
    });
  }
  if (!VALID_ROLES.includes(role)) {
    throw new functions.https.HttpsError('invalid-argument', `Invalid role: ${role}`, {
      reason: 'INVALID_ROLE',
      metadata: { role, validRoles: VALID_ROLES },
    });
  }

  // No self-mutation, in either direction.
  if (uid === caller.uid) {
    throw new functions.https.HttpsError('permission-denied', 'You cannot change your own role', {
      reason: 'SELF_ROLE_CHANGE',
      metadata: { uid },
    });
  }

  // Granting a privileged role requires a written justification, recorded in
  // the audit row.
  const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
  if (PRIVILEGED_ROLES.includes(role) && !trimmedReason) {
    throw new functions.https.HttpsError('invalid-argument', 'A reason is required when granting a privileged role', {
      reason: 'REASON_REQUIRED',
      metadata: { role },
    });
  }

  let targetUser;
  try {
    targetUser = await admin.auth().getUser(uid);
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      throw new functions.https.HttpsError('not-found', 'Target user not found', {
        reason: 'USER_NOT_FOUND',
        metadata: { uid },
      });
    }
    logError('setUserRole', 'get_user_failed', err, { uid, callerUid: caller.uid });
    throw new functions.https.HttpsError('internal', 'Failed to fetch user record');
  }

  const previousRole =
    (targetUser.customClaims && targetUser.customClaims.role) || null;

  // ---- Audit row FIRST, fail closed -------------------------------------
  // If we cannot attribute the change, we do not make the change.
  const db = admin.firestore();
  let auditRef;
  try {
    auditRef = await db.collection('role_change_audit').add({
      action: 'setUserRole',
      targetUid: uid,
      targetEmail: targetUser.email || null,
      previousRole,
      newRole: role,
      privileged: PRIVILEGED_ROLES.includes(role),
      reason: trimmedReason || null,
      actorUid: caller.uid,
      actorEmail: caller.email || null,
      actorRole: caller.role,
      outcome: 'attempted',
      at: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    logError('setUserRole', 'audit_write_failed', err, { uid, role, callerUid: caller.uid });
    throw new functions.https.HttpsError('unavailable', 'Audit log unavailable; role change refused', {
      reason: 'AUDIT_UNAVAILABLE',
      metadata: {},
    });
  }

  const finish = async (outcome, extra = {}) => {
    try {
      await auditRef.update({
        outcome,
        ...extra,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (e) {
      // Best effort — the attributing row already exists.
      logError('setUserRole', 'audit_finalize_failed', e, { auditId: auditRef.id });
    }
  };

  try {
    await admin.auth().setCustomUserClaims(uid, { role });
  } catch (err) {
    await finish('failed', { failure: 'set_claims_failed' });
    logError('setUserRole', 'set_claims_failed', err, { uid, role, callerUid: caller.uid });
    throw new functions.https.HttpsError('internal', 'Failed to set custom claims');
  }

  try {
    await db.collection('users').doc(uid).update({
      role,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    await finish('partial', { failure: 'firestore_update_failed' });
    logError('setUserRole', 'firestore_update_failed', err, { uid, role, callerUid: caller.uid });
    throw new functions.https.HttpsError('internal', 'Claims set but Firestore update failed');
  }

  await finish('applied');

  // ---- Alerting ----------------------------------------------------------
  // A super_admin grant is rare and high-impact: emit a WARNING line that the
  // log-based metric + alert policy keys off (see super-admin-grant-alert.md).
  if (role === 'super_admin') {
    console.warn(JSON.stringify({
      severity: 'WARNING',
      fn: 'setUserRole',
      event: 'super_admin_granted',
      targetUid: uid,
      previousRole,
      actorUid: caller.uid,
      actorEmail: caller.email || null,
      auditId: auditRef.id,
      timestamp: new Date().toISOString(),
    }));
  }

  log('setUserRole', 'role_set', {
    uid,
    role,
    previousRole,
    callerUid: caller.uid,
    auditId: auditRef.id,
    targetEmail: targetUser.email ?? null,
  });

  return { uid, role, previousRole, auditId: auditRef.id };
});
