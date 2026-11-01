// functions/core/services/auth/socialSignIn.js
// Google + Apple sign-in for the member portal — decision core (issue #585).
//
// Hard rules:
//   1. NEVER a new Auth UID for an existing member. A social identity is only
//      ever LINKED onto the true-case Auth UID already bound to exactly one
//      roster doc (firebaseUid lowercased per D-016, authUid true-case per D-125).
//   2. Patients are NEVER looked up by email. Email only finds the Auth account
//      that already owns that login email; the patient comes from that UID's
//      existing binding (patients where firebaseUid == lc(uid)). The social
//      provider's email is never a patient locator and is never written to the
//      roster or chart.
//   3. Additive: the password provider is never removed. linkProvider re-reads
//      the user and fails loudly if a password provider disappeared.
//   4. Fail closed: any read error => refuse (path C) or flag OFF.
//   5. One-time codes are Twilio Verify's job (create + check). This module only
//      keeps the APP-level challenge binding (which provider identity may finish
//      which patient's challenge, its expiry and a check cap) — never a code.
//
// Everything here takes injected deps so it is unit-testable; the emulator
// suite (test/emulator/social-signin.test.js) drives the real wrappers.

const SOCIAL_PROVIDERS = new Set(['google.com', 'apple.com']);
const APPLE_RELAY_RE = /@privaterelay\.appleid\.com$/i;
const DOB_RE = /^\d{4}-\d{2}-\d{2}$/;

// App-level challenge binding (NOT an OTP): how long a started verification may
// be finished, and how many check calls one challenge may make before it is dead.
const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const CHALLENGE_MAX_CHECKS = 5;
// Path B new-member claim lease (see claimOrchestrator in socialSignIn.js wrapper).
const CLAIM_LEASE_MS = 2 * 60 * 1000;

const lower = (v) => String(v || '').trim().toLowerCase();
const normName = (v) => lower(v).replace(/\s+/g, ' ');

function isSocialProvider(providerId) {
  return SOCIAL_PROVIDERS.has(String(providerId || ''));
}

function isAppleRelay(email) {
  return APPLE_RELAY_RE.test(String(email || '').trim());
}

// ---- feature flag (Firestore, not env: no deploy-production.yml change) ----
// Master:   config/socialSignIn                          { enabled: true }
// Practice: config/socialSignIn/practices/{practiceId}   { enabled: true }
// Both must be literal true. Missing doc / read error => OFF.
const FLAG_MASTER_PATH = 'config/socialSignIn';
const flagPracticePath = (practiceId) => `config/socialSignIn/practices/${String(practiceId)}`;
const practiceOf = (roster) => String((roster && roster.practiceId) || 'default');

async function readSocialFlag(db, practiceId = 'default') {
  try {
    const [m, p] = await Promise.all([
      db.doc(FLAG_MASTER_PATH).get(),
      db.doc(flagPracticePath(practiceId)).get(),
    ]);
    const mOn = m.exists && (m.data() || {}).enabled === true;
    const pOn = p.exists && (p.data() || {}).enabled === true;
    return mOn && pOn;
  } catch (_e) {
    return false;
  }
}

// ---- eligibility: minor / guardian-track / deceased-inactive / suspended / disabled
function ageFromDob(dob, now = new Date()) {
  const m = String(dob || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!y || !mo || !d || mo > 12 || d > 31) return null;
  let age = now.getUTCFullYear() - y;
  if (now.getUTCMonth() + 1 < mo || (now.getUTCMonth() + 1 === mo && now.getUTCDate() < d)) age -= 1;
  return age < 0 || age > 130 ? null : age;
}

/**
 * Self-serve social sign-in is for adult, active, non-suspended members only.
 * Minors and dependents stay on the guardian track (never self-serve).
 * chart: live Elation chart when available (path B); roster-only for path A.
 * authUser: the existing Auth user when there is one.
 */
function eligibility({ roster, chart = null, authUser = null, now = new Date() }) {
  const r = roster || {};
  if (r.portalAccess && r.portalAccess.status === 'suspended') return { ok: false, reason: 'SUSPENDED' };
  if (authUser && authUser.disabled === true) return { ok: false, reason: 'AUTH_DISABLED' };
  const st = (chart && chart.patient_status) || {};
  const statusWord = lower(st.status || r.elationStatus);
  if (st.deceased_date || r.deceasedDate || statusWord.includes('deceased')) return { ok: false, reason: 'DECEASED' };
  if (statusWord.includes('inactive')) return { ok: false, reason: 'INACTIVE' };
  if (r.dependent && r.dependent.isMinor === true) return { ok: false, reason: 'MINOR_GUARDIAN_TRACK' };
  const age = ageFromDob((chart && chart.dob) || r.dob, now);
  if (age === null) return { ok: false, reason: 'DOB_UNKNOWN' };
  if (age < 18) return { ok: false, reason: 'MINOR_GUARDIAN_TRACK' };
  return { ok: true };
}

// ---- binding resolution ---------------------------------------------------
// deps.findRosterByUid(lcUid) -> array of { id, data }  (patients where firebaseUid == lcUid)
async function resolveBinding(deps, trueUid) {
  const rows = await deps.findRosterByUid(lower(trueUid));
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, reason: 'UNBOUND' };
  if (rows.length > 1) return { ok: false, reason: 'MULTI_BOUND' };
  const row = rows[0];
  const d = row.data || {};
  if (d.authUid && String(d.authUid) !== String(trueUid)) return { ok: false, reason: 'AUTHUID_CONFLICT' };
  return { ok: true, elationPatientId: String(row.id), roster: d };
}

/**
 * Classify a verified social identity into path A / B / C.
 * identity: { providerId, providerUid, email, emailVerified }
 * deps: { getUserByEmail(email) -> userRecord | null, findRosterByUid }
 */
async function classifySocialIdentity(identity, deps, now = new Date()) {
  const { providerId, email, emailVerified } = identity || {};
  if (!isSocialProvider(providerId)) return { path: 'C', reason: 'NOT_SOCIAL_PROVIDER' };
  if (!email || isAppleRelay(email)) return { path: 'B', reason: email ? 'APPLE_RELAY' : 'NO_EMAIL' };
  if (emailVerified !== true) return { path: 'B', reason: 'EMAIL_NOT_VERIFIED' };

  let user;
  try {
    user = await deps.getUserByEmail(lower(email));
  } catch (_e) {
    return { path: 'C', reason: 'AUTH_LOOKUP_FAILED' };
  }
  if (!user) return { path: 'B', reason: 'NO_AUTH_ACCOUNT' };

  let b;
  try {
    b = await resolveBinding(deps, user.uid);
  } catch (_e) {
    return { path: 'C', reason: 'ROSTER_LOOKUP_FAILED' };
  }
  if (!b.ok) return { path: 'C', reason: b.reason, trueUid: user.uid };
  const e = eligibility({ roster: b.roster, authUser: user, now });
  if (!e.ok) return { path: 'C', reason: e.reason, trueUid: user.uid, elationPatientId: b.elationPatientId };
  return { path: 'A', trueUid: user.uid, elationPatientId: b.elationPatientId, practiceId: practiceOf(b.roster) };
}

// ---- path B candidate (name + DOB; no email involved) ---------------------
// deps.findRosterByDob(dob) -> array of { id, data }
async function findPathBCandidate(deps, { firstName, lastName, dob }) {
  const f = normName(firstName);
  const l = normName(lastName);
  const d = String(dob || '').trim();
  if (!f || !l || !DOB_RE.test(d)) return { ok: false, reason: 'INVALID_INPUT' };
  const rows = await deps.findRosterByDob(d);
  const hits = (rows || []).filter((r) => {
    const x = r.data || {};
    return normName(x.firstName) === f && normName(x.lastName) === l && String(x.dob || '').slice(0, 10) === d;
  });
  if (hits.length === 0) return { ok: false, reason: 'NO_MATCH' };
  if (hits.length > 1) return { ok: false, reason: 'AMBIGUOUS' };
  return { ok: true, elationPatientId: String(hits[0].id), roster: hits[0].data || {} };
}

// ---- chart phone: ABSENT vs PRESENT-BUT-UNUSABLE ---------------------------
// absent:   no live phone entry with any digits on the chart
// unusable: a live phone exists but none normalizes to a US E.164 number
//           (international, short, garbled). This STOPS for staff review —
//           it is never silently treated as "no phone".
// usable:   { e164 } — Mobile preferred, then Main, then Home, then others.
function normalizeUsPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  let ten = null;
  if (digits.length === 10) ten = digits;
  else if (digits.length === 11 && digits.startsWith('1')) ten = digits.slice(1);
  if (!ten) return null;
  // NANP: area code and exchange cannot start with 0 or 1.
  if (/^[01]/.test(ten) || /^[01]/.test(ten.slice(3))) return null;
  return `+1${ten}`;
}

function chartPhoneStatus(chart) {
  const phones = (Array.isArray(chart && chart.phones) ? chart.phones : [])
    .filter((p) => p && !p.deleted_date && String(p.phone || '').replace(/\D/g, '').length > 0);
  if (phones.length === 0) return { status: 'absent' };
  const order = ['mobile', 'main', 'home'];
  const rank = (p) => { const i = order.indexOf(lower(p.phone_type)); return i === -1 ? 99 : i; };
  for (const p of [...phones].sort((a, b) => rank(a) - rank(b))) {
    const e164 = normalizeUsPhone(p.phone);
    if (e164) return { status: 'usable', e164 };
  }
  return { status: 'unusable' };
}

/**
 * Pick the Twilio Verify channel. Rules (owner-approved):
 *   usable chart phone          -> sms to that phone
 *   unusable chart phone        -> STOP for review (never email)
 *   absent phone + CLAIMED      -> email to the member's EXISTING login email,
 *                                  read from the true-case Auth user (not the
 *                                  roster copy, never the provider email);
 *                                  Apple relay / missing -> stop
 *   absent phone + UNCLAIMED    -> STOP: no self-serve. Staff use the governed
 *                                  invite flow (chart-email verified there).
 */
function chooseVerifyChannel({ phone, claimed, loginEmail }) {
  if (phone.status === 'usable') return { channel: 'sms', to: phone.e164 };
  if (phone.status === 'unusable') return { channel: null, reason: 'PHONE_UNUSABLE_REVIEW' };
  if (!claimed) return { channel: null, reason: 'UNCLAIMED_NO_PHONE' };
  if (!loginEmail || isAppleRelay(loginEmail)) return { channel: null, reason: 'NO_CONTACT_ON_FILE' };
  return { channel: 'email', to: lower(loginEmail) };
}

function maskDestination({ channel, to }) {
  if (channel === 'sms') return `***-***-${String(to).slice(-4)}`;
  if (channel === 'email') { const [u, d] = String(to).split('@'); return `${u.slice(0, 1)}***@${d}`; }
  return null;
}

// ---- app-level challenge binding (pure) ------------------------------------
// The record holds NO code. Twilio Verify owns generation, expiry and throttling
// of the code itself; this binds the challenge to one provider identity + patient.
function newChallenge({ nowMs, elationPatientId, providerId, providerUid, channel, verificationSid }) {
  return {
    elationPatientId: String(elationPatientId), providerId, providerUid, channel, verificationSid,
    expiresAtMs: nowMs + CHALLENGE_TTL_MS, checks: 0, usedAtMs: null,
  };
}

/** May this caller run ONE more Verify check against this challenge? */
function challengeGate(ch, { providerId, providerUid }, nowMs) {
  if (!ch) return { ok: false, reason: 'NO_CHALLENGE' };
  if (ch.providerId !== providerId || ch.providerUid !== providerUid) return { ok: false, reason: 'NO_CHALLENGE' };
  if (ch.usedAtMs) return { ok: false, reason: 'CODE_USED' };
  if (nowMs > ch.expiresAtMs) return { ok: false, reason: 'CODE_EXPIRED' };
  if (ch.checks >= CHALLENGE_MAX_CHECKS) return { ok: false, reason: 'CODE_LOCKED' };
  return { ok: true };
}

// ---- dry-run predictor (read-only gate before any canary) -----------------
/**
 * Predict the path an ACTIVE member would take. Pure; caller supplies facts.
 *   roster        patients/{id} data or null (no record at all)
 *   chart         live Elation chart or null
 *   authUser      Auth user for roster.authUid (true case) or null
 *   uidRows       number of roster docs with firebaseUid == lc(authUid)
 *   loginShared   the login email is also a roster email of another member
 * Returns { google, apple } where each is 'A' | 'B' | 'C' + reason.
 *   Google: path A when the member signs in with a Google account AT their
 *           login email (best case). Any other Google address => their B result.
 *   Apple:  "Hide My Email" relay always => B. Shown as the B outcome.
 */
function predictPaths({ roster, chart, authUser, uidRows = 0, now = new Date() }) {
  if (!roster) return { google: 'C:NO_PORTAL_RECORD', apple: 'C:NO_PORTAL_RECORD', b: 'C:NO_PORTAL_RECORD' };
  const claimed = Boolean(roster.firebaseUid);
  const elig = eligibility({ roster, chart, authUser, now });
  if (!elig.ok) { const c = `C:${elig.reason}`; return { google: c, apple: c, b: c }; }

  // Path B outcome (applies to Apple relay and to Google at a non-login address).
  let b;
  if (!chart) b = 'C:CHART_UNREADABLE';
  else {
    const phone = chartPhoneStatus(chart);
    if (claimed) {
      if (!authUser || lower(authUser.uid) !== lower(roster.firebaseUid)) b = 'C:LOGIN_NOT_RESOLVABLE';
      else if (uidRows > 1) b = 'C:MULTI_BOUND';
    }
    if (!b) {
      const ch = chooseVerifyChannel({ phone, claimed, loginEmail: authUser && authUser.email });
      b = ch.channel ? `B:${claimed ? 'LINK' : 'NEW_CLAIM'}_${ch.channel.toUpperCase()}` : `C:${ch.reason}`;
    }
  }

  // Google at the login email.
  let google;
  if (!claimed) google = b; // no login account to match: same as path B
  else if (!authUser) google = 'C:LOGIN_NOT_RESOLVABLE';
  else if (!authUser.email) google = b;
  else if (uidRows > 1) google = 'C:MULTI_BOUND';
  else if (lower(authUser.uid) !== lower(roster.firebaseUid)) google = 'C:AUTHUID_CONFLICT';
  else google = 'A';
  return { google, apple: b, b };
}

module.exports = {
  SOCIAL_PROVIDERS,
  CHALLENGE_TTL_MS,
  CHALLENGE_MAX_CHECKS,
  CLAIM_LEASE_MS,
  FLAG_MASTER_PATH,
  flagPracticePath,
  practiceOf,
  isSocialProvider,
  isAppleRelay,
  readSocialFlag,
  ageFromDob,
  eligibility,
  resolveBinding,
  classifySocialIdentity,
  findPathBCandidate,
  normalizeUsPhone,
  chartPhoneStatus,
  chooseVerifyChannel,
  maskDestination,
  newChallenge,
  challengeGate,
  predictPaths,
};
