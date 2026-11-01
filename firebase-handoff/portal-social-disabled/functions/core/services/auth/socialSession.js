// REVIEW ONLY. Native providers remain disabled; no Firebase provider mutations.
const crypto = require('node:crypto');
const TTL = 10 * 60 * 1000;
const digest = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const random = () => crypto.randomBytes(32).toString('base64url');
const fail = (reason) => { const e = new Error(reason); e.reason = reason; throw e; };
const issuerOf = (p) => p === 'google.com' ? 'https://accounts.google.com' : p === 'apple.com' ? 'https://appleid.apple.com' : fail('UNSUPPORTED_PROVIDER');
const identityKey = (id) => digest(`${issuerOf(id.providerId)}\0${id.providerUid}`);
function gate(a, proof, now, stages) {
  if (!a || typeof proof !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(proof) || a.proofHash !== digest(proof)) fail('INVALID_ATTEMPT');
  if (a.expiresAtMs <= now) fail('ATTEMPT_EXPIRED');
  if (!stages.includes(a.stage)) fail('ATTEMPT_USED');
}
function checkIdentity(a, id) {
  if (a.providerId !== id.providerId || (a.identityKey && a.identityKey !== identityKey(id))) fail('IDENTITY_MISMATCH');
  if (!id.nonce || a.nonceHash !== digest(id.nonce)) fail('NONCE_MISMATCH');
}
async function staffAccess(db, auth, req, env = process.env) {
  try {
    if (!req.auth || !req.auth.uid) return null;
    const uid = req.auth.uid;
    const [user, master, target] = await Promise.all([
      auth.getUser(uid), db.doc('config/socialSignIn').get(), db.collection('socialStaffTargets').doc(uid).get(),
    ]);
    if (user.disabled || !master.exists || master.get('enabled') !== true || !target.exists || target.get('enabled') !== true) return null;
    const practiceId = target.get('practiceId');
    if (typeof practiceId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(practiceId)) return null;
    const practice = await db.doc(`config/socialSignIn/practices/${practiceId}`).get();
    if (!practice.exists || practice.get('enabled') !== true) return null;
    return { uid, practiceId, google: Boolean(env.SOCIAL_GOOGLE_CLIENT_IDS), apple: Boolean(env.SOCIAL_APPLE_CLIENT_IDS) };
  } catch { return null; }
}
async function begin(db, providerId, access, now = Date.now()) {
  issuerOf(providerId);
  if (!access || !(providerId === 'google.com' ? access.google : access.apple)) fail('SOCIAL_SIGNIN_DISABLED');
  const ref = db.collection('socialAttempts').doc();
  const nonce = random(), proof = random();
  await db.runTransaction(async (tx) => {
    const throttle = db.collection('socialAttemptThrottle').doc(access.uid);
    const s = await tx.get(throttle);
    if (s.exists && s.get('nextAtMs') > now) fail('ATTEMPT_THROTTLED');
    tx.set(throttle, { nextAtMs: now + 30000 });
    tx.set(ref, { providerId, nonceHash: digest(nonce), proofHash: digest(proof), actorUid: access.uid,
      practiceId: access.practiceId, stage: 'new', expiresAtMs: now + TTL });
  });
  return { attemptId: ref.id, nonce, proof };
}
function attemptRef(db, data) {
  if (!data || !/^[A-Za-z0-9_-]{1,128}$/.test(String(data.attemptId || ''))) fail('INVALID_ATTEMPT');
  return db.collection('socialAttempts').doc(data.attemptId);
}
async function readAttempt(db, data, access, stages) {
  const s = await attemptRef(db, data).get(), a = s.exists ? s.data() : null;
  gate(a, data.proof, Date.now(), stages);
  if (!access || a.actorUid !== access.uid || a.practiceId !== access.practiceId) fail('INVALID_ATTEMPT');
  return a;
}
async function advance(db, data, id, from, to, extra = {}) {
  return db.runTransaction(async (tx) => {
    const ref = attemptRef(db, data), snap = await tx.get(ref), a = snap.exists ? snap.data() : null;
    gate(a, data.proof, Date.now(), from); checkIdentity(a, id);
    tx.update(ref, { stage: to, identityKey: identityKey(id), ...extra });
  });
}
// Atomic mapping + provider slot + roster uniqueness. Auth users are never updated.
async function link(db, uid, id, pid, { claimUid = null, generation = null, access = null, eligibility = null } = {}) {
  const key = identityKey(id);
  return db.runTransaction(async (tx) => {
    const mapping = db.collection('socialIdentityLinks').doc(key);
    const slot = db.collection('socialIdentitySlots').doc(digest(`${uid}\0${id.providerId}`));
    const patient = db.collection('patients').doc(String(pid));
    const [m, s, p, byLc, byTrue] = await Promise.all([
      tx.get(mapping), tx.get(slot), tx.get(patient),
      tx.get(db.collection('patients').where('firebaseUid', '==', uid.toLowerCase()).limit(3)),
      tx.get(db.collection('patients').where('authUid', '==', uid).limit(3)),
    ]);
    if (!p.exists) fail('NO_PATIENT_RECORD');
    if (access) {
      const [master, practice, target] = await Promise.all([
        tx.get(db.doc('config/socialSignIn')), tx.get(db.doc(`config/socialSignIn/practices/${access.practiceId}`)),
        tx.get(db.collection('socialStaffTargets').doc(access.uid)),
      ]);
      if (!master.exists || master.get('enabled') !== true || !practice.exists || practice.get('enabled') !== true || !target.exists || target.get('enabled') !== true || target.get('practiceId') !== access.practiceId || String(p.get('practiceId') || 'default') !== access.practiceId) fail('PRACTICE_SCOPE_CHANGED');
    }
    if (eligibility && !eligibility({ roster:p.data() }).ok) fail('MEMBER_INELIGIBLE');
    if (m.exists && (m.get('uid') !== uid || m.get('elationPatientId') !== String(pid))) fail('IDENTITY_OWNED');
    if (s.exists && s.get('identityKey') !== key) fail('PROVIDER_SLOT_OWNED');
    if (byLc.docs.some(d => d.id !== String(pid)) || byTrue.docs.some(d => d.id !== String(pid))) fail('AMBIGUOUS_BINDING');
    if (claimUid) {
      const lock = await tx.get(db.collection('socialClaimLocks').doc(String(pid)));
      if (claimUid !== uid || !lock.exists || lock.get('state') !== 'pending' || lock.get('pendingUid') !== uid || (generation && lock.get('generation') !== generation) || lock.get('leaseUntilMs') <= Date.now()) fail('CLAIM_LEASE_LOST');
      if (p.get('firebaseUid') || p.get('authUid')) fail('ALREADY_BOUND');
    } else if (p.get('authUid') !== uid || p.get('firebaseUid') !== uid.toLowerCase() || byLc.size !== 1 || byTrue.size !== 1) fail('BINDING_MISMATCH');
    tx.set(mapping, { uid, issuer: issuerOf(id.providerId), providerId: id.providerId, elationPatientId: String(pid) });
    tx.set(slot, { identityKey: key });
    if (claimUid) {
      tx.set(patient, { authUid: uid, firebaseUid: uid.toLowerCase(), boundAt: new Date() }, { merge: true });
      tx.set(db.collection('phi_access_log').doc(), { action: 'member_bound', elationPatientId: String(pid), boundAuthUid: uid, boundUid: uid.toLowerCase(), actor: 'socialSignIn', timestamp: new Date() });
    }
    return { linked: !m.exists };
  });
}
async function mapped(db, auth, S, deps, id) {
  const m = await db.collection('socialIdentityLinks').doc(identityKey(id)).get();
  if (!m.exists) return null;
  try {
    const user = await auth.getUser(m.get('uid'));
    const b = await S.resolveBinding(deps, user.uid);
    if (!b.ok || b.roster.authUid !== user.uid || b.elationPatientId !== m.get('elationPatientId') || !S.eligibility({ roster: b.roster, authUser: user }).ok) return { path: 'C' };
    return { path: 'A', trueUid: user.uid, elationPatientId: b.elationPatientId, practiceId: S.practiceOf(b.roster) };
  } catch { return { path: 'C' }; }
}
async function settleLease(db, ref, uid, generation, fields) {
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.get('pendingUid') !== uid || snap.get('generation') !== generation) return false;
    tx.set(ref, fields, { merge:true }); return true;
  });
}
module.exports = { TTL, digest, gate, checkIdentity, identityKey, staffAccess, begin, readAttempt, advance, link, mapped, settleLease };