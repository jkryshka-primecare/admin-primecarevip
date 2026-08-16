// functions/core/services/patient/portalAccess.js
// Per-member portal visibility + access state, controlled from Prime Care OS.
//
// Doc: portalAccess/{elationPatientId}
//   status      : 'active' | 'suspended'
//   modules     : { labs, imaging, medications, records, appointments,
//                   conditions, allergies } -> bool
//   hiddenItems : { labs: [id], imaging: [id], records: [id], ... }
//   updatedAt   : Timestamp
//   updatedBy   : string   staff email that made the change
//   reason      : string   free text, surfaced in the admin audit trail
//
// Rules of the road:
//   - ABSENT DOC = everything visible. Visibility fails OPEN so a Firestore
//     hiccup never silently blanks a member's chart.
//   - SUSPENSION fails CLOSED: a read error while resolving access must not
//     grant a suspended member access, so callers treat a throw as deny.
//   - Client rules deny all access to this collection; Admin SDK only.

const admin = require('firebase-admin');

const COLLECTION = 'portalAccess';

const MODULES = [
  'labs',
  'imaging',
  'medications',
  'records',
  'appointments',
  'conditions',
  'allergies',
];

const DEFAULT_ACCESS = Object.freeze({
  status: 'active',
  modules: Object.freeze(MODULES.reduce((acc, m) => ({ ...acc, [m]: true }), {})),
  hiddenItems: Object.freeze({}),
});

function normalize(data) {
  const d = data || {};
  const modules = {};
  for (const m of MODULES) {
    modules[m] = d.modules && d.modules[m] === false ? false : true;
  }
  const hiddenItems = {};
  for (const m of MODULES) {
    const list = d.hiddenItems && Array.isArray(d.hiddenItems[m]) ? d.hiddenItems[m] : [];
    hiddenItems[m] = list.map(String);
  }
  return {
    status: d.status === 'suspended' ? 'suspended' : 'active',
    modules,
    hiddenItems,
    updatedAt: d.updatedAt || null,
    updatedBy: d.updatedBy || null,
    reason: d.reason || null,
  };
}

/** Read the access doc. Never throws — absent/broken => full visibility. */
async function getPortalAccess(elationPatientId) {
  const pid = String(elationPatientId || '').trim();
  if (!pid) return normalize(null);
  try {
    const snap = await admin.firestore().collection(COLLECTION).doc(pid).get();
    return normalize(snap.exists ? snap.data() : null);
  } catch (e) {
    return normalize(null);
  }
}

/**
 * Suspension check for read endpoints. Throws on read failure so the caller
 * fails CLOSED — the opposite policy from module visibility.
 */
async function assertNotSuspended(elationPatientId) {
  const pid = String(elationPatientId || '').trim();
  if (!pid) {
    const err = new Error('Portal access check needs a patient id');
    err.portalReason = 'ACCESS_CHECK_FAILED';
    throw err;
  }
  const snap = await admin.firestore().collection(COLLECTION).doc(pid).get();
  const data = snap.exists ? snap.data() : null;
  if (data && data.status === 'suspended') {
    const err = new Error('Portal access suspended');
    err.portalReason = 'ACCESS_SUSPENDED';
    throw err;
  }
}

/** True when this module is visible to the member. */
function isModuleVisible(access, moduleName) {
  return !access || !access.modules ? true : access.modules[moduleName] !== false;
}

/** Drop any item whose id is on the hidden list for this module. */
function filterHidden(access, moduleName, items, idOf) {
  if (!Array.isArray(items)) return items;
  const hidden = new Set(((access && access.hiddenItems && access.hiddenItems[moduleName]) || []).map(String));
  if (hidden.size === 0) return items;
  const getId = typeof idOf === 'function' ? idOf : (it) => (it && (it.id || it.docId)) || '';
  return items.filter((it) => !hidden.has(String(getId(it))));
}

/**
 * Merge a patch into the access doc. Admin plane only — never called from a
 * patient-facing endpoint.
 *
 * patch: { status?, modules?: {m: bool}, hiddenItems?: {m: [id]},
 *          hideItem?: {collection, id}, unhideItem?: {collection, id} }
 * hideItem/unhideItem are applied atomically inside the transaction.
 */
async function setPortalAccess(elationPatientId, patch, actorEmail, reason) {
  const pid = String(elationPatientId || '').trim();
  if (!pid) throw new Error('setPortalAccess: elationPatientId required');

  const ref = admin.firestore().collection(COLLECTION).doc(pid);

  const result = await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const before = normalize(snap.exists ? snap.data() : null);

    const next = {
      status: before.status,
      modules: { ...before.modules },
      hiddenItems: { ...before.hiddenItems },
    };

    if (patch && (patch.status === 'active' || patch.status === 'suspended')) {
      next.status = patch.status;
    }
    if (patch && patch.modules && typeof patch.modules === 'object') {
      for (const [m, v] of Object.entries(patch.modules)) {
        if (MODULES.includes(m) && typeof v === 'boolean') next.modules[m] = v;
      }
    }
    if (patch && patch.hiddenItems && typeof patch.hiddenItems === 'object') {
      for (const [m, list] of Object.entries(patch.hiddenItems)) {
        if (MODULES.includes(m) && Array.isArray(list)) {
          next.hiddenItems[m] = Array.from(new Set(list.map(String))).slice(0, 500);
        }
      }
    }

    // Atomic single-item hide/unhide. Doing it inside the transaction removes
    // the client read-modify-write race: concurrent hides can no longer clobber
    // each other's list.
    const applyItemOp = (op, hide) => {
      if (!op || typeof op !== 'object') return;
      const m = String(op.collection || '');
      const id = String(op.id || '').trim();
      if (!MODULES.includes(m) || !id) return;
      const list = Array.isArray(next.hiddenItems[m]) ? next.hiddenItems[m].map(String) : [];
      next.hiddenItems[m] = hide
        ? Array.from(new Set([...list, id])).slice(0, 500)
        : list.filter((x) => x !== id);
    };
    if (patch) {
      applyItemOp(patch.hideItem, true);
      applyItemOp(patch.unhideItem, false);
    }

    tx.set(
      ref,
      {
        ...next,
        updatedAt: admin.firestore.Timestamp.now(),
        updatedBy: String(actorEmail || 'unknown'),
        reason: String(reason || '').slice(0, 500),
      },
      { merge: true },
    );

    return { before, after: next };
  });

  return result;
}

module.exports = {
  COLLECTION,
  MODULES,
  DEFAULT_ACCESS,
  getPortalAccess,
  assertNotSuspended,
  isModuleVisible,
  filterHidden,
  setPortalAccess,
  normalize,
};
