// functions/core/services/patient/guardians.js
// Guardian proxy model for minors (Release 2b).
//
// A minor never signs in. A guardian signs in to their own portal account and
// switches into the child's record. Guardian entries live on the CHILD's roster
// doc so every read-path check is a single document lookup on the record being
// read.
//
// Shape written to patients/<childElationId>:
//
//   dependent: { isMinor: bool, dob: 'YYYY-MM-DD', convertsAt: Timestamp }
//   guardians: [{
//     guardianElationId : string | null   // null for email-identified proxies
//     guardianEmail     : string          // always present; invite target
//     guardianUid       : string | null   // resolved at claim / first proxy use
//     source            : 'hint_household' | 'inferred_email_name'
//                       | 'manual' | 'email_on_file'
//     status            : 'active' | 'pending_adult_consent' | 'revoked'
//     confirmedBy       : string          // admin email
//     confirmedAt       : Timestamp
//     revokedBy         : string | null
//     revokedAt         : Timestamp | null
//     reason            : string
//   }]

const admin = require('firebase-admin');

const SOURCES = ['hint_household', 'inferred_email_name', 'manual', 'email_on_file'];
// The admin CSV export writes 'manual_search'; the loader remaps it, but accept
// the alias here too so a direct API caller can never wedge on vocabulary drift.
const SOURCE_ALIASES = { manual_search: 'manual' };
const STATUSES = ['active', 'pending_adult_consent', 'revoked'];

function normalizeSource(source) {
  const s = String(source || '').trim();
  return SOURCE_ALIASES[s] || s;
}


/** Identity of a guardian entry: elation id when we have a chart, else email. */
function guardianKey(entry) {
  const id = String(entry.guardianElationId || '').trim();
  if (id) return `id:${id}`;
  return `email:${String(entry.guardianEmail || '').trim().toLowerCase()}`;
}

function parseDob(dob) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dob || '').trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

function eighteenthBirthday(dob) {
  const d = parseDob(dob);
  if (!d) return null;
  return new Date(Date.UTC(d.getUTCFullYear() + 18, d.getUTCMonth(), d.getUTCDate()));
}

function isMinorOn(dob, now = new Date()) {
  const converts = eighteenthBirthday(dob);
  if (!converts) return null; // unknown DOB -> caller must reject
  return now.getTime() < converts.getTime();
}

function sanitizeEntry(entry) {
  return {
    guardianElationId: entry.guardianElationId ? String(entry.guardianElationId) : null,
    guardianHintId: entry.guardianHintId ? String(entry.guardianHintId) : null,
    guardianEmail: String(entry.guardianEmail || '').trim().toLowerCase(),
    guardianName: entry.guardianName ? String(entry.guardianName).slice(0, 200) : null,
    guardianUid: entry.guardianUid ? String(entry.guardianUid) : null,
    source: entry.source,
    status: entry.status,
    confirmedBy: entry.confirmedBy,
    confirmedAt: entry.confirmedAt,
    revokedBy: entry.revokedBy || null,
    revokedAt: entry.revokedAt || null,
    reason: String(entry.reason || '').slice(0, 500),
  };
}

/**
 * Idempotently add (or re-activate) one guardian on a minor's record.
 * Called once per guardian; a child may carry several.
 *
 * Throws Error with .reason set to a stable code for the HTTP layer.
 */
async function linkGuardian(childElationId, rawEntry, actor, reason) {
  const db = admin.firestore();
  const ref = db.collection('patients').doc(String(childElationId));
  const entry = { ...rawEntry, source: normalizeSource(rawEntry.source) };

  if (!SOURCES.includes(entry.source)) {
    const e = new Error('unknown source');
    e.reason = 'UNKNOWN_SOURCE';
    throw e;
  }
  if (!entry.guardianElationId && !entry.guardianEmail) {
    const e = new Error('no guardian identity');
    e.reason = 'GUARDIAN_IDENTITY_REQUIRED';
    throw e;
  }


  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      const e = new Error('no child record');
      e.reason = 'CHILD_NOT_FOUND';
      throw e;
    }
    const data = snap.data() || {};
    const dob = String(data.dob || data.dateOfBirth || entry.childDob || '').trim();
    const minor = isMinorOn(dob);
    if (minor === null) {
      const e = new Error('unknown dob');
      e.reason = 'CHILD_DOB_UNKNOWN';
      throw e;
    }
    if (!minor) {
      // A guardian proxy is only ever created for a minor. Adults consent for
      // themselves via memberSetGuardianConsent.
      const e = new Error('child is 18+');
      e.reason = 'CHILD_IS_ADULT';
      throw e;
    }
    const childEmail = String(data.email || data.contactEmail || '').trim().toLowerCase();
    const guardianEmail = String(entry.guardianEmail || '').trim().toLowerCase();
    const selfById =
      entry.guardianElationId && String(childElationId) === String(entry.guardianElationId);
    const selfByEmail = guardianEmail && childEmail && guardianEmail === childEmail;
    if (selfById || selfByEmail) {
      const e = new Error('self link');
      e.reason = 'SELF_LINK_REJECTED';
      throw e;
    }


    const now = admin.firestore.Timestamp.now();
    const existing = Array.isArray(data.guardians) ? data.guardians.slice() : [];
    const key = guardianKey(entry);
    const idx = existing.findIndex((g) => guardianKey(g) === key);

    const next = sanitizeEntry({
      ...entry,
      status: 'active',
      confirmedBy: actor,
      confirmedAt: idx >= 0 && existing[idx].confirmedAt ? existing[idx].confirmedAt : now,
      revokedBy: null,
      revokedAt: null,
      reason,
    });

    const before = idx >= 0 ? existing[idx] : null;
    if (idx >= 0) existing[idx] = { ...existing[idx], ...next };
    else existing.push(next);

    const converts = eighteenthBirthday(dob);
    tx.set(
      ref,
      {
        guardians: existing,
        dependent: {
          isMinor: true,
          dob,
          convertsAt: admin.firestore.Timestamp.fromDate(converts),
        },
        guardiansUpdatedAt: now,
        guardiansUpdatedBy: actor,
      },
      { merge: true },
    );

    return { created: idx < 0, before, after: next };
  });
}

/** Set one guardian entry to revoked. Idempotent. */
async function revokeGuardian(childElationId, selector, actor, reason) {
  const db = admin.firestore();
  const ref = db.collection('patients').doc(String(childElationId));

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      const e = new Error('no child record');
      e.reason = 'CHILD_NOT_FOUND';
      throw e;
    }
    const data = snap.data() || {};
    const existing = Array.isArray(data.guardians) ? data.guardians.slice() : [];
    const key = guardianKey(selector);
    const idx = existing.findIndex((g) => guardianKey(g) === key);
    if (idx < 0) {
      const e = new Error('no such guardian');
      e.reason = 'GUARDIAN_NOT_FOUND';
      throw e;
    }

    const now = admin.firestore.Timestamp.now();
    const before = existing[idx];
    existing[idx] = {
      ...before,
      status: 'revoked',
      revokedBy: actor,
      revokedAt: now,
      reason: String(reason || '').slice(0, 500),
    };

    tx.set(
      ref,
      { guardians: existing, guardiansUpdatedAt: now, guardiansUpdatedBy: actor },
      { merge: true },
    );

    return { before, after: existing[idx] };
  });
}

/**
 * Read-path helper. True when `uid` may read the record identified by
 * `childElationId` as an active guardian proxy.
 *
 * Fails CLOSED: any error, missing doc, or non-active status denies.
 */
async function isActiveGuardian(childElationId, uid) {
  if (!uid) return false;
  try {
    const snap = await admin.firestore().collection('patients').doc(String(childElationId)).get();
    if (!snap.exists) return false;
    const guardians = snap.data().guardians;
    if (!Array.isArray(guardians)) return false;
    return guardians.some((g) => g && g.status === 'active' && g.guardianUid === uid);
  } catch (_e) {
    return false;
  }
}

/**
 * Bind a uid to exactly ONE guardian entry, the first time that guardian
 * claims/proxies.
 *
 * `selector` must identify a single entry — pass the `guardianKey` the invite
 * token was issued for (preferred), or `{ guardianElationId }` / `{ guardianEmail }`
 * which are reduced to the same key. Binding by email alone is NOT safe: two
 * distinct guardians (both parents) can share one email, and binding both
 * entries to the first claimer fuses the proxies and breaks per-parent
 * revocation.
 *
 * Only 'active' or 'pending_adult_consent' entries are bindable; a revoked
 * entry never gains a uid.
 */
async function bindGuardianUid(childElationId, selector, uid) {
  const db = admin.firestore();
  const ref = db.collection('patients').doc(String(childElationId));
  const key = typeof selector === 'string' ? selector : guardianKey(selector || {});
  if (!key || key === 'email:' || !uid) return { bound: false, reason: 'SELECTOR_REQUIRED' };

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { bound: false, reason: 'CHILD_NOT_FOUND' };
    const guardians = Array.isArray(snap.data().guardians) ? snap.data().guardians.slice() : [];

    const matches = guardians
      .map((g, i) => ({ g, i }))
      .filter(({ g }) => g && guardianKey(g) === key);
    if (matches.length === 0) return { bound: false, reason: 'GUARDIAN_NOT_FOUND' };
    if (matches.length > 1) return { bound: false, reason: 'AMBIGUOUS_SELECTOR' };

    const { g, i } = matches[0];
    if (g.status !== 'active' && g.status !== 'pending_adult_consent') {
      return { bound: false, reason: 'GUARDIAN_NOT_BINDABLE' };
    }
    if (g.guardianUid) {
      return { bound: g.guardianUid === uid, reason: g.guardianUid === uid ? null : 'ALREADY_BOUND' };
    }

    guardians[i] = { ...g, guardianUid: String(uid) };
    tx.set(ref, { guardians }, { merge: true });
    return { bound: true, guardianKey: key };
  });
}


module.exports = {
  SOURCES,
  SOURCE_ALIASES,
  normalizeSource,
  STATUSES,
  guardianKey,

  eighteenthBirthday,
  isMinorOn,
  linkGuardian,
  revokeGuardian,
  isActiveGuardian,
  bindGuardianUid,
};
