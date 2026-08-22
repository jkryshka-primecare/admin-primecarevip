// functions/core/services/patient/internalUid.js
// Release 2b · Part B — the internal patient UID (the STORAGE spine).
//
// Why this exists
// ---------------
// Artifacts used to be addressed as `elation-artifacts/<firebaseUid>/...`,
// where the uid came from the CALLER's token. Minors never log in, so they have
// no `firebaseUid`; a guardian read on that scheme resolves to the GUARDIAN's
// prefix -> object missing -> perpetual "preparing", and the repair backstop
// would then write the CHILD's PDF under the GUARDIAN's prefix. That is a PHI
// mislocation, so storage is re-keyed onto an id that belongs to the RECORD.
//
// Rules
//   - `internalUid` is a v4 UUID on `patients/<elationPatientId>`.
//   - Minted once for EVERY patient, adult or minor, login or not.
//   - IMMUTABLE. Regenerating orphans objects; minting is idempotent.
//   - NOT an Elation id, NOT a Firebase Auth uid. Claiming a login records
//     `firebaseUid` as the AUTH mapping only — storage never moves.
//   - Never accepted from client input; always resolved server-side from the
//     authorized record.

const crypto = require('crypto');
const admin = require('firebase-admin');

const FIELD = 'internalUid';

/** v4 UUID; `crypto.randomUUID` on Node 16+, explicit fallback otherwise. */
function newInternalUid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Legacy (pre-re-key) auth uid on a patient doc, lowercased, or null. */
function legacyUidOf(snapOrData) {
  const get = (k) =>
    typeof snapOrData.get === 'function' ? snapOrData.get(k) : (snapOrData || {})[k];
  const raw = get('firebaseUid') || get('authUid');
  return raw ? String(raw).toLowerCase() : null;
}

/**
 * Read the record's internalUid. Read-only: it does NOT mint.
 * Returns `{ internalUid, legacyUid }`; either may be null.
 */
async function getInternalUid(elationPatientId, db = admin.firestore()) {
  if (!elationPatientId) return { internalUid: null, legacyUid: null };
  const snap = await db.collection('patients').doc(String(elationPatientId)).get();
  if (!snap.exists) return { internalUid: null, legacyUid: null };
  const value = snap.get(FIELD);
  return {
    internalUid: value ? String(value) : null,
    legacyUid: legacyUidOf(snap),
  };
}

/**
 * Idempotently mint. A record that already has one is left UNTOUCHED — the
 * transaction re-reads inside the txn so two concurrent minters cannot
 * disagree, which would orphan objects.
 */
async function ensureInternalUid(elationPatientId, db = admin.firestore()) {
  const ref = db.collection('patients').doc(String(elationPatientId));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { internalUid: null, minted: false, reason: 'PATIENT_NOT_FOUND' };
    const existing = snap.get(FIELD);
    if (existing) return { internalUid: String(existing), minted: false };
    const internalUid = newInternalUid();
    tx.set(ref, { [FIELD]: internalUid, internalUidMintedAt: new Date().toISOString() }, { merge: true });
    return { internalUid, minted: true };
  });
}

/** THE object path. Callers pass the RECORD's internalUid, never a token uid. */
function objectPathFor(internalUid, reportId) {
  if (!internalUid) return null;
  return `elation-artifacts/${internalUid}/${reportId}/report.pdf`;
}

/** Legacy path, served read-only during the dual-read window. */
function legacyObjectPathFor(legacyUid, reportId) {
  if (!legacyUid) return null;
  return `elation-artifacts/${legacyUid}/${reportId}/report.pdf`;
}

/**
 * Dual-read window switch. While ON, a read that misses the internalUid path
 * may fall back to the legacy firebaseUid path. Removed once
 * `auditArtifactCoverage` reports 100% coverage under the new key.
 */
function legacyFallbackEnabled() {
  return process.env.ARTIFACT_LEGACY_UID_FALLBACK !== 'false';
}

/** Per-request memo so one read never fetches the same patient doc twice. */
function makeInternalUidResolver(db = admin.firestore()) {
  const cache = new Map();
  return async function resolve(elationPatientId) {
    if (!elationPatientId) return { internalUid: null, legacyUid: null };
    const key = String(elationPatientId);
    if (cache.has(key)) return cache.get(key);
    let value;
    try {
      value = await getInternalUid(key, db);
    } catch (_e) {
      value = { internalUid: null, legacyUid: null };
    }
    cache.set(key, value);
    return value;
  };
}

module.exports = {
  FIELD,
  newInternalUid,
  legacyUidOf,
  getInternalUid,
  ensureInternalUid,
  objectPathFor,
  legacyObjectPathFor,
  legacyFallbackEnabled,
  makeInternalUidResolver,
};
