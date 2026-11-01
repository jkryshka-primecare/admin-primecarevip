// functions/socialSignIn.js
// Google + Apple sign-in callables (issue #585). Inert unless the Firestore
// flags are on: config/socialSignIn { enabled: true } AND
// config/socialSignIn/practices/{practiceId} { enabled: true } for the member's
// practice. No env var, no deploy-production.yml change.
//
//   socialLinkExisting        path A: provider email == an existing Auth login
//                             email bound to exactly one eligible roster doc -> link.
//   socialStartVerification   path B step 1: name + DOB -> exactly one roster doc,
//                             DOB + eligibility re-checked against the LIVE Elation
//                             chart, Twilio Verify code to the chart phone (email
//                             only for a claimed member whose chart has NO phone).
//   socialConfirmVerification path B step 2: Twilio Verify check -> link onto the
//                             bound UID, or (never claimed) the governed claim:
//                             lease -> create(pre-chosen uid) -> link -> bindMember
//                             -> shared post-claim hydration, with cleanup.
//
// Every success returns a custom token minted from the TRUE-CASE uid. No path
// creates an Auth user for an already-bound member. No patient lookup by email.
// Every successful link is recorded in socialLinks/{providerId}|{providerUid};
// the beforeSocialSignIn blocking function only admits linked identities found there.

const admin = require('firebase-admin');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { logError } = require('./middleware/logger');
const { verifyProviderIdToken } = require('./core/services/auth/providerToken');
const S = require('./core/services/auth/socialSignIn');
const verify = require('./core/services/auth/verifySender');
const { checkThrottle, recordFailure, clearThrottle } = require('./core/services/patient/dobThrottle');
const { bindMember } = require('./core/services/patient/bindMember');
const { runPostClaimSteps } = require('./core/services/patient/postClaim');
const { elationGet } = require('./core/services/elation/client');

const ELATION_CLIENT_ID = defineSecret('ELATION_CLIENT_ID');
const ELATION_CLIENT_SECRET = defineSecret('ELATION_CLIENT_SECRET');

const db = () => admin.firestore();
// Twilio Verify secrets: bound ONLY to the two path-B callables (hold lifted 2026-10-30).
const VERIFY_SECRETS = verify.VERIFY_SECRET_NAMES.map((n) => defineSecret(n));
const OPTS = { timeoutSeconds: 180, memory: '512MiB', secrets: [ELATION_CLIENT_ID, ELATION_CLIENT_SECRET] };
const VERIFY_OPTS = { ...OPTS, secrets: [...OPTS.secrets, ...VERIFY_SECRETS] };

const linkDocId = (providerId, providerUid) => `${providerId}|${providerUid}`;

function deps() {
  return {
    getUserByEmail: async (email) => {
      try { return await admin.auth().getUserByEmail(email); }
      catch (e) { if (e.code === 'auth/user-not-found') return null; throw e; }
    },
    getUser: (uid) => admin.auth().getUser(uid),
    updateUser: (uid, props) => admin.auth().updateUser(uid, props),
    findRosterByUid: async (lcUid) => {
      const q = await db().collection('patients').where('firebaseUid', '==', lcUid).limit(3).get();
      return q.docs.map((d) => ({ id: d.id, data: d.data() }));
    },
    findRosterByDob: async (dob) => {
      const q = await db().collection('patients').where('dob', '==', dob).limit(50).get();
      return q.docs.map((d) => ({ id: d.id, data: d.data() }));
    },
  };
}

async function audit(entry) {
  // No tokens, codes, emails or phone numbers in the audit row.
  await db().collection('portalAdminAudit').add({ at: admin.firestore.Timestamp.now(), actor: 'socialSignIn', ...entry });
}

async function requireMasterFlag() {
  let on = false;
  try { const m = await db().doc(S.FLAG_MASTER_PATH).get(); on = m.exists && (m.data() || {}).enabled === true; }
  catch (_e) { on = false; }
  if (!on) throw new HttpsError('failed-precondition', 'SOCIAL_SIGNIN_DISABLED');
}
async function requirePracticeFlag(roster) {
  if (!(await S.readSocialFlag(db(), S.practiceOf(roster)))) throw new HttpsError('failed-precondition', 'SOCIAL_SIGNIN_DISABLED');
}

async function verified(data) {
  try {
    return await verifyProviderIdToken(String(data && data.providerId), String(data && data.idToken));
  } catch (e) {
    throw new HttpsError('unauthenticated', e.reason || 'BAD_TOKEN');
  }
}

async function recordLink(trueUid, id, elationPatientId) {
  await db().collection('socialLinks').doc(linkDocId(id.providerId, id.providerUid)).set({
    uid: trueUid, providerId: id.providerId, elationPatientId: String(elationPatientId), at: admin.firestore.Timestamp.now(),
  });
}

const mint = (trueUid) => admin.auth().createCustomToken(trueUid);
const refuse = () => new HttpsError('failed-precondition', 'CONTACT_PRACTICE');

// Resolve the TRUE-CASE login of a claimed roster doc. authUid only — no email
// fallback; anything unresolvable goes to a human.
async function claimedLogin(d, roster, elationPatientId) {
  let user = null;
  try { user = await admin.auth().getUser(String(roster.authUid || '')); } catch (_e) { user = null; }
  if (!user || user.uid.toLowerCase() !== String(roster.firebaseUid).toLowerCase()) return { ok: false, reason: 'LOGIN_NOT_RESOLVABLE' };
  const b = await S.resolveBinding(d, user.uid);
  if (!b.ok) return { ok: false, reason: b.reason };
  if (b.elationPatientId !== String(elationPatientId)) return { ok: false, reason: 'BINDING_MISMATCH' };
  return { ok: true, user };
}

// ---- path A ---------------------------------------------------------------
exports.socialLinkExisting = onCall(OPTS, async (req) => {
  await requireMasterFlag();
  const id = await verified(req.data);
  const d = deps();
  const c = await S.classifySocialIdentity(id, d);
  if (c.path !== 'A') {
    await audit({ action: 'social_classify', path: c.path, reason: c.reason, provider: id.providerId, elationPatientId: c.elationPatientId || null });
    return { path: c.path, reason: c.path === 'B' ? 'VERIFY_IDENTITY' : 'CONTACT_PRACTICE' };
  }
  await requirePracticeFlag({ practiceId: c.practiceId });
  try {
    const r = await S.linkProvider(d, c.trueUid, id);
    await recordLink(c.trueUid, id, c.elationPatientId);
    await audit({ action: 'social_link', path: 'A', provider: id.providerId, elationPatientId: c.elationPatientId, uid: c.trueUid.toLowerCase(), newlyLinked: r.linked });
  } catch (e) {
    logError('socialSignIn', 'link-failed', e, { elationPatientId: c.elationPatientId, reason: e.reason });
    await audit({ action: 'social_link_failed', path: 'A', provider: id.providerId, elationPatientId: c.elationPatientId, reason: e.reason || 'LINK_FAILED' });
    throw refuse();
  }
  return { path: 'A', customToken: await mint(c.trueUid) };
});

// ---- path B step 1 ----------------------------------------------------------
const NOT_VERIFIED = 'NOT_VERIFIED'; // generic: no-match, ambiguous and DOB mismatch look the same

exports.socialStartVerification = onCall(VERIFY_OPTS, async (req) => {
  await requireMasterFlag();
  const id = await verified(req.data);
  const throttleKey = `social_${id.providerId}_${id.providerUid}`;
  const t = await checkThrottle(throttleKey);
  if (t.blocked) throw new HttpsError('resource-exhausted', t.hardLocked ? 'DOB_LOCKED' : 'DOB_THROTTLED', { retryAfter: t.hardLocked ? null : t.retryAfterSeconds });

  const { firstName, lastName, dob } = req.data || {};
  const d = deps();
  const cand = await S.findPathBCandidate(d, { firstName, lastName, dob });
  let chart = null;
  if (cand.ok) {
    try { chart = await elationGet(`/patients/${encodeURIComponent(cand.elationPatientId)}/`); }
    catch (e) { logError('socialSignIn', 'chart-read-failed', e, { elationPatientId: cand.elationPatientId }); throw new HttpsError('unavailable', 'TRY_AGAIN'); }
  }
  const liveDobOk = cand.ok && chart && String(chart.dob || '').slice(0, 10) === String(dob).trim();
  if (!liveDobOk) {
    await recordFailure(throttleKey);
    await audit({ action: 'social_verify_failed', path: 'B', provider: id.providerId, reason: cand.ok ? 'DOB_MISMATCH_LIVE' : cand.reason, elationPatientId: cand.ok ? cand.elationPatientId : null });
    throw new HttpsError('permission-denied', NOT_VERIFIED);
  }
  const pid = cand.elationPatientId;
  const stop = async (reason) => {
    await audit({ action: 'social_verify_stopped', path: 'B', provider: id.providerId, reason, elationPatientId: pid, needsReview: reason === 'PHONE_UNUSABLE_REVIEW' });
    return refuse();
  };
  await requirePracticeFlag(cand.roster);

  const claimed = Boolean(cand.roster.firebaseUid);
  let login = null;
  if (claimed) {
    const l = await claimedLogin(d, cand.roster, pid);
    if (!l.ok) throw await stop(l.reason);
    login = l.user;
  }
  const elig = S.eligibility({ roster: cand.roster, chart, authUser: login });
  if (!elig.ok) throw await stop(elig.reason);

  const ch = S.chooseVerifyChannel({ phone: S.chartPhoneStatus(chart), claimed, loginEmail: login && login.email });
  if (!ch.channel) throw await stop(ch.reason);

  let started;
  try { started = await verify.startVerification(ch); }
  catch (e) {
    logError('socialSignIn', 'verify-start-failed', e, { elationPatientId: pid, channel: ch.channel, reason: e.reason });
    await audit({ action: 'social_code_not_sent', path: 'B', provider: id.providerId, elationPatientId: pid, channel: ch.channel, reason: e.reason || 'VERIFY_START_FAILED' });
    throw new HttpsError('unavailable', 'CODE_NOT_SENT');
  }
  const ref = db().collection('socialChallenges').doc();
  await ref.set({
    ...S.newChallenge({ nowMs: Date.now(), elationPatientId: pid, providerId: id.providerId, providerUid: id.providerUid, channel: ch.channel, verificationSid: started.verificationSid }),
    createdAt: admin.firestore.Timestamp.now(),
  });
  await audit({ action: 'social_code_sent', path: 'B', provider: id.providerId, elationPatientId: pid, channel: ch.channel });
  return { challengeId: ref.id, channel: ch.channel, destination: S.maskDestination(ch) };
});

// ---- governed claim for a never-claimed member (path B) ---------------------
// socialClaimLocks/{elationPatientId}: { state: pending|done|released, pendingUid, leaseUntilMs }
//   1. Transaction: refuse if the roster doc is already bound or a live lease is
//      held; otherwise take the lease and RECORD the uid we are about to create.
//   2. If an expired lease left a pendingUid behind (crash mid-claim), delete
//      that Auth user — but only if no roster doc is bound to it.
//   3. createUser(uid = pendingUid) -> linkProvider -> bindMember (transactional).
//   4. Any failure: delete the new user, release the lease. If the delete itself
//      fails the lease stays pending and step 2 of the next attempt finishes it.
// deleteIfUnbound is the ONLY deleteUser call in this flow. It refuses (returns
// false) unless the uid is one this flow minted for a claim lease AND nothing
// marks it as a real member login:
//   - no roster doc bound by firebaseUid (lower-case) OR authUid (true case);
//   - the Auth user has no password provider (path-B users are created
//     password-less; every claimed member login has one);
// Callers only pass a lease pendingUid, and the main path only after its own
// createUser succeeded in this same lease window.
async function deleteIfUnbound(uid) {
  const u = String(uid || '');
  if (!u) return false;
  const pats = db().collection('patients');
  const [byLc, byTrue] = await Promise.all([
    pats.where('firebaseUid', '==', u.toLowerCase()).limit(1).get(),
    pats.where('authUid', '==', u).limit(1).get(),
  ]);
  if (!byLc.empty || !byTrue.empty) return false;
  let user;
  try { user = await admin.auth().getUser(u); } catch (e) { if (e.code === 'auth/user-not-found') return true; throw e; }
  if ((user.providerData || []).some((p) => p.providerId === 'password') || user.passwordHash) return false;
  try { await admin.auth().deleteUser(u); } catch (e) { if (e.code !== 'auth/user-not-found') throw e; }
  return true;
}

async function governedSocialClaim({ elationPatientId, id, challengeId }) {
  const pid = String(elationPatientId);
  const lockRef = db().collection('socialClaimLocks').doc(pid);
  const patRef = db().collection('patients').doc(pid);
  const lease = await db().runTransaction(async (tx) => {
    const [lock, pat] = await Promise.all([tx.get(lockRef), tx.get(patRef)]);
    if (!pat.exists) return { ok: false, reason: 'NO_PATIENT_RECORD' };
    if (pat.get('firebaseUid')) return { ok: false, reason: 'ALREADY_BOUND' };
    const l = lock.exists ? lock.data() : null;
    const nowMs = Date.now();
    if (l && l.state === 'pending' && l.leaseUntilMs > nowMs) return { ok: false, reason: 'CLAIM_IN_PROGRESS' };
    const staleUid = l && l.state === 'pending' ? l.pendingUid : null;
    const pendingUid = db().collection('socialClaimLocks').doc().id;
    tx.set(lockRef, { state: 'pending', pendingUid, leaseUntilMs: nowMs + S.CLAIM_LEASE_MS, challengeId, providerId: id.providerId, at: admin.firestore.Timestamp.now() });
    return { ok: true, pendingUid, staleUid };
  });
  if (!lease.ok) return lease;
  if (lease.staleUid && !(await deleteIfUnbound(lease.staleUid))) {
    // Stale uid now belongs to a real login: leave it, release, refuse this attempt.
    await lockRef.set({ state: 'released', pendingUid: null, leaseUntilMs: 0, staleUidKept: lease.staleUid }, { merge: true });
    return { ok: false, reason: 'STALE_UID_IN_USE' };
  }

  const uid = lease.pendingUid;
  let created = false;
  try {
    await admin.auth().createUser({ uid, emailVerified: false });
    created = true;
    await S.linkProvider(deps(), uid, id);
    await bindMember({ db: db(), FieldValue: admin.firestore.FieldValue, elationPatientId: pid, rawUid: uid, actor: 'socialSignIn' });
  } catch (e) {
    let cleaned = false;
    // Never delete a uid this attempt did not create (e.g. uid-already-exists).
    try { cleaned = created ? await deleteIfUnbound(uid) : false; } catch (delErr) { logError('socialSignIn', 'claim-cleanup-failed', delErr, { elationPatientId: pid }); }
    if (cleaned) await lockRef.set({ state: 'released', pendingUid: null, leaseUntilMs: 0 }, { merge: true }).catch(() => {});
    return { ok: false, reason: (e.details && e.details.reason) || e.reason || 'BIND_FAILED' };
  }
  await lockRef.set({ state: 'done', pendingUid: null, leaseUntilMs: 0, boundUidLc: uid.toLowerCase() }, { merge: true });
  return { ok: true, uid };
}

// ---- path B step 2 ----------------------------------------------------------
exports.socialConfirmVerification = onCall(VERIFY_OPTS, async (req) => {
  await requireMasterFlag();
  const id = await verified(req.data);
  const challengeId = String((req.data && req.data.challengeId) || '');
  const code = String((req.data && req.data.code) || '');
  if (!challengeId) throw new HttpsError('invalid-argument', 'NO_CHALLENGE');
  const ref = db().collection('socialChallenges').doc(challengeId);

  // Reserve one check (app-level cap) before asking Twilio.
  const gate = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const c = snap.exists ? snap.data() : null;
    const g = S.challengeGate(c, id, Date.now());
    if (!g.ok) return g;
    tx.update(ref, { checks: c.checks + 1 });
    return { ok: true, challenge: c };
  });
  if (!gate.ok) {
    await audit({ action: 'social_code_failed', path: 'B', provider: id.providerId, reason: gate.reason });
    throw new HttpsError('permission-denied', gate.reason);
  }
  let approved = false;
  try { approved = (await verify.checkVerification({ verificationSid: gate.challenge.verificationSid, code })).approved; }
  catch (e) {
    logError('socialSignIn', 'verify-check-failed', e, { reason: e.reason });
    throw new HttpsError('unavailable', 'TRY_AGAIN');
  }
  if (!approved) {
    await audit({ action: 'social_code_failed', path: 'B', provider: id.providerId, reason: 'CODE_MISMATCH', elationPatientId: gate.challenge.elationPatientId });
    throw new HttpsError('permission-denied', 'CODE_MISMATCH');
  }
  // Single use: mark used atomically; a second concurrent confirm loses here.
  const used = await db().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists || s.get('usedAtMs')) return false;
    tx.update(ref, { usedAtMs: Date.now() });
    return true;
  });
  if (!used) throw new HttpsError('permission-denied', 'CODE_USED');

  const elationPatientId = String(gate.challenge.elationPatientId);
  const d = deps();
  const roster = (await db().collection('patients').doc(elationPatientId).get()).data() || {};

  let trueUid;
  if (roster.firebaseUid) {
    const l = await claimedLogin(d, roster, elationPatientId);
    const elig = l.ok ? S.eligibility({ roster, authUser: l.user }) : { ok: false, reason: l.reason };
    if (!elig.ok) {
      await audit({ action: 'social_link_failed', path: 'B', provider: id.providerId, elationPatientId, reason: elig.reason });
      throw refuse();
    }
    trueUid = l.user.uid;
    try { await S.linkProvider(d, trueUid, id); await recordLink(trueUid, id, elationPatientId); }
    catch (e) {
      await audit({ action: 'social_link_failed', path: 'B', provider: id.providerId, elationPatientId, reason: e.reason || 'LINK_FAILED' });
      throw refuse();
    }
    await audit({ action: 'social_link', path: 'B', provider: id.providerId, elationPatientId, uid: trueUid.toLowerCase() });
  } else {
    const elig = S.eligibility({ roster });
    if (!elig.ok) {
      await audit({ action: 'social_claim_failed', path: 'B', provider: id.providerId, elationPatientId, reason: elig.reason });
      throw refuse();
    }
    const r = await governedSocialClaim({ elationPatientId, id, challengeId });
    if (!r.ok) {
      await audit({ action: 'social_claim_failed', path: 'B', provider: id.providerId, elationPatientId, reason: r.reason });
      throw refuse();
    }
    trueUid = r.uid;
    await recordLink(trueUid, id, elationPatientId);
    await runPostClaimSteps({ elationPatientId, uid: trueUid.toLowerCase(), actor: 'socialSignIn' });
    await audit({ action: 'social_claim', path: 'B', provider: id.providerId, elationPatientId, uid: trueUid.toLowerCase() });
  }
  await clearThrottle(`social_${id.providerId}_${id.providerUid}`).catch(() => {});
  return { path: 'B', customToken: await mint(trueUid) };
});

exports._test = { governedSocialClaim, deleteIfUnbound, linkDocId };
