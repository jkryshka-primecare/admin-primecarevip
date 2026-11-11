// functions/claimAccount.js
// #302 — Claim/activation endpoint. PUBLIC, PRE-AUTH: the patient has no Firebase
// token and no Auth user yet — THIS flow creates the Auth user (D-096). The trust
// anchor is the single-use claim token (#301), not verifyPatientToken.
//
// Flow (fail-closed at every step):
//   method/CORS -> parse -> validateClaimToken -> resolve roster doc ->
//   already-claimed guard (firebaseUid present -> 409) -> password policy ->
//   token-keyed DOB throttle (tokenId = sha256(rawToken), Option 2) ->
//   audit-first (claim_dob_verified/claim_dob_failed) -> DOB compare ->
//   create Auth user -> set firebaseUid (lc) + clearThrottle -> consume token ->
//   200 { uid }.
//
// Invariant: Auth user exists  <=>  token consumed  <=>  future visits go to
// login, not claim. bindMember (#303) + backfill (#304) fire AFTER, separate PRs.
//
// #302 reads email + dob from the ROSTER DOC (written by #300 from the Elation
// export). The CLAIM path makes no live Elation call; the 9c HYDRATION step
// (#304) DOES — backfillElationReports/Letters call Elation via elationGet,
// so ELATION_CLIENT_ID + ELATION_CLIENT_SECRET are bound below (#350).
//
// Error envelope per D-010; details.reason on every 4xx/401/403. INVALID_TOKEN is
// GENERIC (bad/expired/used never disambiguated — anti-enumeration).

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { defineSecret } = require('firebase-functions/params');
const ELATION_CLIENT_ID = defineSecret('ELATION_CLIENT_ID');
const ELATION_CLIENT_SECRET = defineSecret('ELATION_CLIENT_SECRET');
const { log, logError } = require('./middleware/logger');
const { validateClaimToken, consumeClaimToken } = require('./core/services/patient/claimToken');
const { bindMember } = require('./core/services/patient/bindMember');
const { bindGuardianUid } = require('./core/services/patient/guardians');
const { backfillElationReports } = require('./backfillElationReports');
const { backfillElationLetters } = require('./backfillElationLetters');
// D-317 — the shared hydration-status authority. The `complete` rule and the
// deferral path live there so claim time and the recovery driver cannot drift.
const {
  CLAIM_SOFT_BUDGET_MS,
  DEFER_REASON_SOFT_BUDGET,
  STATUS_DEFERRED,
  SOURCE_CLAIM,
  reportsOk,
  lettersOk,
  terminalStatus,
  writeTerminalStatus,
  markDeferred,
} = require('./core/services/patient/hydrationStatus');
const { checkThrottle, recordFailure, clearThrottle } = require('./core/services/patient/dobThrottle');
const { runPostClaimSteps } = require('./core/services/patient/postClaim');
const { queueClaimHydration } = require('./core/services/patient/claimHydrationQueue');
const { setCors } = require('./core/config/allowedOrigins');

const DOB_RE = /^\d{4}-\d{2}-\d{2}$/;
const PW_MIN = 12;
const PW_MAX = 64;

// #510 claim-time guardian bind bounds. Mirrors getMyDependents: Firestore cannot
// query inside an array of maps, so the minor cohort is scanned and pre-filtered in
// memory under an explicit ceiling. A claimer with an implausible number of children
// is a data bug, not a family.
const {
  bindGuardianLinksForClaimer,
  GUARDIAN_BIND_MAX_SCAN,
  GUARDIAN_BIND_MAX_CHILDREN,
} = require('./core/services/patient/claimTimeGuardianBind');


// Small known-common set. Not exhaustive — the length + letter+digit rule and the
// email-derived check do the heavy lifting; this catches the obvious ones.
const COMMON_PASSWORDS = new Set([
  'password1234', 'passw0rd1234', '123456789012', 'qwerty123456',
  'password1111', 'letmein12345', 'welcome12345', 'admin1234567',
  'iloveyou1234', 'primecare123', 'changeme1234',
]);

function jsonError(res, status, code, reason, message, metadata) {
  return res.status(status).json({
    error: { code: status, status: code, message: message || reason, details: { reason, metadata: metadata || {} } },
  });
}

function parseBody(raw) {
  if (!raw) return {};
  if (typeof raw === 'string') { try { return JSON.parse(raw); } catch (e) { return {}; } }
  if (Buffer.isBuffer(raw)) { try { return JSON.parse(raw.toString('utf8')); } catch (e) { return {}; } }
  return raw;
}

// Returns null if OK, else a { reason } for a 400. Policy (#302): 12-64 chars,
// >=1 letter AND >=1 digit, not email-derived, not a known-common password.
// Generic reason on failure — the client shows the rules up front.
function validatePassword(password, email) {
  if (typeof password !== 'string') return { reason: 'WEAK_PASSWORD' };
  if (password.length > PW_MAX) return { reason: 'PASSWORD_TOO_LONG' };
  if (password.length < PW_MIN) return { reason: 'WEAK_PASSWORD' };
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return { reason: 'WEAK_PASSWORD' };
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return { reason: 'WEAK_PASSWORD' };
  const localPart = String(email || '').split('@')[0].toLowerCase();
  if (localPart && localPart.length >= 3 && lower.includes(localPart)) return { reason: 'WEAK_PASSWORD' };
  return null;
}

// D-318: claim-time hydration runs the SAME reports/letters runners as the
// recovery driver, so it had the same OOM exposure — worse, in fact: no memory
// was declared at all, which means the gen-1 default of 256MiB. Artifacts now
// stream (peak ~one high-water mark), and 512MiB gives the Admin SDK plus the
// claim transaction comfortable headroom without over-provisioning a function
// that runs on every activation.
exports.claimAccount = functions.runWith({ timeoutSeconds: 180, memory: '512MB', secrets: [ELATION_CLIENT_ID, ELATION_CLIENT_SECRET] }).https.onRequest(async (req, res) => {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') {
    res.set('Allow', 'POST, OPTIONS');
    return jsonError(res, 405, 'FAILED_PRECONDITION', 'METHOD_NOT_ALLOWED', 'Only POST is supported.');
  }

  const body = parseBody(req.body);
  const rawToken = typeof body.token === 'string' ? body.token.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const providedDob = typeof body.dob === 'string' ? body.dob.trim() : '';

  // 1) Validate token. All failure reasons collapse to a GENERIC 401.
  let tokenInfo;
  try {
    tokenInfo = await validateClaimToken(rawToken);
  } catch (err) {
    log('claimAccount', 'token-rejected', { reason: err.claimReason || 'UNKNOWN' });
    return jsonError(res, 401, 'UNAUTHENTICATED', 'INVALID_TOKEN', 'This link is invalid or has expired.');
  }
  const { tokenId, elationPatientId } = tokenInfo;

  // 2) Resolve the roster doc (patients/{elationPatientId}). Written by #300.
  let docRef;
  let d;
  try {
    docRef = admin.firestore().collection('patients').doc(String(elationPatientId));
    const snap = await docRef.get();
    if (!snap.exists) {
      // Token points at a patient with no roster doc — treat as invalid link,
      // do not disclose. Should not happen if #300 ran before #301 issued.
      logError('claimAccount', 'roster-doc-missing', new Error('no patient doc'), { elationPatientId });
      return jsonError(res, 401, 'UNAUTHENTICATED', 'INVALID_TOKEN', 'This link is invalid or has expired.');
    }
    d = snap.data() || {};
  } catch (err) {
    logError('claimAccount', 'roster-read-failed', err, { elationPatientId });
    return jsonError(res, 500, 'INTERNAL', 'READ_ERROR', 'Something went wrong. Try again shortly.');
  }

  // 2b) Already-claimed guard. Auth user exists <=> token consumed; a live
  //     firebaseUid means this patient already set up their account.
  if (d.firebaseUid) {
    log('claimAccount', 'already-claimed', { elationPatientId });
    return jsonError(res, 409, 'ALREADY_EXISTS', 'ALREADY_CLAIMED', 'This account is already set up. Please sign in.');
  }

  const email = typeof d.email === 'string' ? d.email.trim() : '';
  const onFileDob = typeof d.dob === 'string' ? d.dob.trim() : '';

  // 3) Password policy (before any Auth work, before DOB throttle spend).
  const pwErr = validatePassword(password, email);
  if (pwErr) {
    if (pwErr.reason === 'PASSWORD_TOO_LONG') {
      return jsonError(res, 400, 'INVALID_ARGUMENT', 'PASSWORD_TOO_LONG', 'Password must be 64 characters or fewer.', { max: PW_MAX });
    }
    return jsonError(res, 400, 'INVALID_ARGUMENT', 'WEAK_PASSWORD', 'Password does not meet the requirements.', { min: PW_MIN, max: PW_MAX });
  }

  // 4) Fail closed if the roster doc has no DOB to second-factor against.
  if (!onFileDob) {
    logError('claimAccount', 'dob-unavailable', new Error('no dob on roster doc'), { elationPatientId });
    return jsonError(res, 403, 'PERMISSION_DENIED', 'DOB_UNAVAILABLE', 'We cannot verify your identity right now. Contact the practice.');
  }

  // 5) DOB throttle — token-keyed (tokenId = sha256(rawToken)). Check BEFORE compare.
  let throttle;
  try {
    throttle = await checkThrottle(tokenId);
  } catch (err) {
    logError('claimAccount', 'throttle-check-failed', err, { elationPatientId });
    return jsonError(res, 503, 'INTERNAL', 'THROTTLE_UNAVAILABLE', 'Verification is temporarily unavailable. Try again shortly.');
  }
  if (throttle.blocked) {
    if (throttle.hardLocked) {
      log('claimAccount', 'dob-hard-locked', { elationPatientId });
      return jsonError(res, 429, 'RESOURCE_EXHAUSTED', 'DOB_LOCKED', 'Too many attempts. Contact the practice to unlock.', { retryAfter: null });
    }
    log('claimAccount', 'dob-throttled', { elationPatientId, retryAfter: throttle.retryAfterSeconds });
    return jsonError(res, 429, 'RESOURCE_EXHAUSTED', 'DOB_THROTTLED', 'Too many attempts. Please wait before trying again.', { retryAfter: throttle.retryAfterSeconds });
  }

  // 6) AUDIT FIRST — fail-fast BEFORE the DOB comparison (PHI-adjacent, D-067).
  //    No uid exists yet; subject is the elationPatientId.
  async function audit(action) {
    await admin.firestore().collection('phi_access_log').add({
      uid: null,
      role: 'patient',
      action,
      elationPatientId,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  // 7) Compare DOB. Mismatch -> record failure (throttle) -> 403/429.
  if (!DOB_RE.test(providedDob) || providedDob !== onFileDob) {
    try { await audit('claim_dob_failed'); }
    catch (err) { logError('claimAccount', 'audit-failed', err, { elationPatientId }); return jsonError(res, 500, 'INTERNAL', 'LOG_WRITE_ERROR', 'Failed to write access log.'); }
    let failure;
    try {
      failure = await recordFailure(tokenId);
    } catch (err) {
      logError('claimAccount', 'throttle-record-failed', err, { elationPatientId });
      return jsonError(res, 503, 'INTERNAL', 'THROTTLE_UNAVAILABLE', 'Verification is temporarily unavailable. Try again shortly.');
    }
    if (failure.hardLocked) {
      log('claimAccount', 'dob-hard-locked', { elationPatientId });
      return jsonError(res, 429, 'RESOURCE_EXHAUSTED', 'DOB_LOCKED', 'Too many attempts. Contact the practice to unlock.', { retryAfter: null });
    }
    if (failure.retryAfterSeconds > 0) {
      log('claimAccount', 'dob-mismatch-throttled', { elationPatientId, retryAfter: failure.retryAfterSeconds });
      return jsonError(res, 429, 'RESOURCE_EXHAUSTED', 'DOB_THROTTLED', 'The date of birth did not match. Please wait before trying again.', { retryAfter: failure.retryAfterSeconds });
    }
    log('claimAccount', 'dob-mismatch', { elationPatientId });
    return jsonError(res, 403, 'PERMISSION_DENIED', 'DOB_MISMATCH', 'The date of birth did not match.');
  }

  // Match. Audit the success before creating the account.
  try { await audit('claim_dob_verified'); }
  catch (err) { logError('claimAccount', 'audit-failed', err, { elationPatientId }); return jsonError(res, 500, 'INTERNAL', 'LOG_WRITE_ERROR', 'Failed to write access log.'); }

  // 8) Create the Firebase Auth user (D-096). Email from the roster doc.
  let userRecord;
  let adopted = false; // D-118: true when we adopt a pre-existing orphan Auth user (never rollback-delete it)
  try {
    userRecord = await admin.auth().createUser({ email, password, emailVerified: false });
  } catch (err) {
    // D-118: email-already-exists reaching here means the roster doc is UNBOUND
    // (the L133 firebaseUid-set guard already returned 409 for genuinely-claimed
    // docs). So the existing Auth user is an ORPHAN from a prior run that created
    // the account but crashed before bind. IDENTIFY it and set adopted=true; the
    // password is NOT touched here — it is reset only AFTER a successful bind
    // proves the account is this patient's (see the post-bind block below).
    // adopted=true so the bind-failure rollback below NEVER deletes a pre-existing
    // account (protects a concurrent-race winner, #249).
    if (err && err.code === 'auth/email-already-exists') {
      // D-118: IDENTIFY the orphan here — do NOT touch its password yet. We have
      // only found a candidate account; we have not yet earned the right to modify
      // it. The password reset happens AFTER a successful bind (below), once
      // bindMember has atomically proven this uid belongs to THIS patient (guard C).
      try {
        const existing = await admin.auth().getUserByEmail(email);
        userRecord = existing;
        adopted = true;
        log('claimAccount', 'auth-orphan-identified', { elationPatientId, uid: String(existing.uid).toLowerCase() });
      } catch (adoptErr) {
        logError('claimAccount', 'auth-orphan-lookup-failed', adoptErr, { elationPatientId, code: adoptErr && adoptErr.code });
        return jsonError(res, 500, 'INTERNAL', 'ACCOUNT_CREATE_ERROR', 'Could not finish setup. Try again shortly.');
      }
    } else {
      logError('claimAccount', 'create-user-failed', err, { elationPatientId, code: err && err.code });
      return jsonError(res, 500, 'INTERNAL', 'ACCOUNT_CREATE_ERROR', 'Could not create your account. Try again shortly.');
    }
  }
  const uid = String(userRecord.uid).toLowerCase();

  // 9) Bind the uid onto the roster doc via bindMember — the SOLE writer of
  //    patients/{id}.firebaseUid (D-083). Replaces the former inline transaction
  //    (#303). bindMember runs its guards (A: doc exists; B: unbound or same-uid
  //    idempotent; C: uid not already on a DIFFERENT doc) + the linkage write +
  //    member_bound audit atomically in one transaction. We inject the CF's own
  //    admin instance (db, FieldValue) so there is a single firebase-admin/sentinel
  //    instance — bindMember never require()s admin itself (scripts/<->functions/).
  //
  //    Concurrency: two claims on one token can both pass step 2b and both reach
  //    createUser; step 8's catch IDENTIFIES (adopts) the existing user (D-118)
  //    rather than stopping — bindMember's transaction still guarantees exactly one
  //    bind, and guard C rejects an adopted uid already bound elsewhere BEFORE any
  //    password reset. The RACE LOSER (or any bind failure) is handled below: an
  //    Auth user this run CREATED is deleted; an ADOPTED pre-existing user is NOT
  //    (adopted flag) so the winner's account survives. bindMember throws
  //    HttpsError (D-010 shape); we catch and translate to this endpoint's
  //    jsonError envelope, never bubbling raw.
  const FieldValue = admin.firestore.FieldValue;
  let bindResult;
  try {
    bindResult = await bindMember({
      db: admin.firestore(),
      FieldValue,
      elationPatientId,
      rawUid: userRecord.uid,
      actor: 'claimAccount',
    });
  } catch (err) {
    const reason = err && err.details && err.details.reason;
    // Roll back the just-created Auth user in bind-failure paths (orphan cleanup).
    // D-118: NEVER delete an ADOPTED pre-existing account — only delete users this
    // run created. Deleting an adopted account could destroy a concurrent-race
    // winner's live bound account (#249).
    if (!adopted) {
      try { await admin.auth().deleteUser(userRecord.uid); }
      catch (delErr) { logError('claimAccount', 'rollback-delete-failed', delErr, { elationPatientId, uid }); }
    } else {
      log('claimAccount', 'rollback-skipped-adopted-user', { elationPatientId, uid });
    }

    if (reason === 'ALREADY_BOUND') {
      // This roster doc already carries a DIFFERENT uid — a concurrent winner or a
      // prior run bound it first. Route the loser to login (same posture as the old
      // lost-race 409).
      log('claimAccount', 'bind-lost-race', { elationPatientId, uid, reason });
      return jsonError(res, 409, 'ALREADY_EXISTS', 'ALREADY_CLAIMED', 'This account is already set up. Please sign in.');
    }
    if (reason === 'UID_ALREADY_BOUND') {
      // Guard C: this uid is already bound to ANOTHER patient doc. Should never
      // happen in the claim path (uid was just minted) — log loudly as an anomaly.
      logError('claimAccount', 'bind-uid-cross-doc', err, { elationPatientId, uid, boundTo: err.details && err.details.metadata && err.details.metadata.boundTo });
      return jsonError(res, 409, 'ALREADY_EXISTS', 'ALREADY_CLAIMED', 'This account is already set up. Please sign in.');
    }
    // Any other failure (guard A NO_PATIENT_RECORD, transaction/write error, etc.):
    // treat as an incomplete setup the patient can retry (token not yet consumed).
    logError('claimAccount', 'bind-uid-failed', err, { elationPatientId, uid, reason });
    return jsonError(res, 500, 'INTERNAL', 'ACCOUNT_CREATE_ERROR', 'Could not finish setup. Try again shortly.');
  }

  // D-118: If bindMember reported an IDEMPOTENT same-uid rebind (bindResult.alreadyBound),
  //   this uid was ALREADY bound to this patient by a prior/concurrent completed claim.
  //   Do NOT reset the password — a password reset auto-revokes the existing sessions
  //   (Firebase backend behavior), which would forcibly sign out the legitimate first
  //   claimant and let a second submitter overwrite their password. Route to login (409),
  //   same posture as the other already-claimed paths. Only a genuinely NEW bind proceeds.
  if (bindResult && bindResult.alreadyBound) {
    log('claimAccount', 'bind-idempotent-rebind', { elationPatientId, uid });
    return jsonError(res, 409, 'ALREADY_EXISTS', 'ALREADY_CLAIMED', 'This account is already set up. Please sign in.');
  }

  // D-118: Password reset for an ADOPTED account happens ONLY here — AFTER a
  //   successful, genuinely-new bind. bindMember's transaction has just atomically
  //   proven (guards B + C) that this uid is bound to THIS patient and no other, so
  //   resetting the password can never touch a stranger's account. A freshly-CREATED
  //   user (adopted=false) already had its password set at createUser; skip.
  if (adopted) {
    try {
      await admin.auth().updateUser(userRecord.uid, { password });
      log('claimAccount', 'auth-orphan-password-reset', { elationPatientId, uid });
    } catch (pwErr) {
      // Bind succeeded but the password update failed. The patient is now bound
      //   (firebaseUid set) but still on the OLD unknown password — and a retry would
      //   hit the L133 firebaseUid guard and 409, trapping them. Surface a DISTINCT,
      //   non-generic error so this is diagnosable and the patient is told to contact
      //   support rather than looping. Do NOT unbind (bindMember is sole writer,
      //   D-083; unbinding re-opens a race). Non-fatal to the bind; logged loudly.
      logError('claimAccount', 'auth-orphan-password-reset-failed', pwErr, { elationPatientId, uid, code: pwErr && pwErr.code });
      return jsonError(res, 500, 'INTERNAL', 'ADOPT_PASSWORD_RESET_FAILED', 'Your account is linked but the password could not be set. Please contact support.');
    }
  }

  // 9b / 9b-i / 9c) Shared post-bind steps (status active, guardian bind,
  //     first-claim hydration). Moved verbatim to core/services/patient/postClaim.js
  //     so social sign-in path B runs the identical hydration. Never throws.
  // Durable commit before returning a session; never launch background work here.
  try {
    await queueClaimHydration({ db: admin.firestore(), FieldValue, patientId: elationPatientId, rawUid: userRecord.uid });
  } catch (err) {
    logError('claimAccount', 'hydration-queue-failed', err, { elationPatientId });
    return jsonError(res, 503, 'UNAVAILABLE', 'SETUP_FINISHING', 'Your account is linked. Please sign in while setup finishes.');
  }
  await runPostClaimSteps({ elationPatientId, uid, actor: 'claimAccount', skipHydration: true });

  try { await clearThrottle(tokenId); }
  catch (err) { logError('claimAccount', 'throttle-clear-failed', err, { elationPatientId }); /* non-fatal: TTL cleans up */ }

  // 10) Consume the token — same success path as account creation. Invariant:
  //     account exists => token spent. A consume failure here is non-fatal to the
  //     patient (their account exists; already-claimed guard covers a re-visit),
  //     but we log it loudly.
  try {
    await consumeClaimToken(tokenId);
  } catch (err) {
    logError('claimAccount', 'consume-failed-post-create', err, { elationPatientId, uid, reason: err.claimReason });
    // Do NOT fail the response — the account is live and bound. Re-visits hit the
    // already-claimed guard. This is a monitorable anomaly, not a user-facing error.
  }

  // #505 one-step activation: mint a Firebase custom token so the hub can sign the
  // member in immediately. Fail-soft — on mint failure return loginToken:null and the
  // hub falls back to the two-step path. Mint from the TRUE-CASE uid (userRecord.uid),
  // NOT the lowercased `uid` (D-016 Firestore-key form) — that would mint for a
  // non-existent uid.
  let loginToken = null;
  try {
    loginToken = await admin.auth().createCustomToken(userRecord.uid);
  } catch (tokenErr) {
    logError('claimAccount', 'login-token-mint-failed', tokenErr, { elationPatientId, uid });
    // non-fatal: account is live + bound; hub treats null as success and routes to sign-in.
  }

  log('claimAccount', 'ok', { elationPatientId, uid, oneStep: !!loginToken });
  return res.status(200).json({ uid, loginToken });
});
