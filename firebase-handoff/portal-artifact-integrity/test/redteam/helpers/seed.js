/**
 * Red-team helpers — seeding. Real Firestore + real Storage, TEST-SCOPED ONLY.
 *
 * Every write goes through `assertStatefulTargetAllowed()`, so this file cannot
 * touch the production project or the production serving bucket: the emulator
 * or a dedicated test project is required (review round 2, item 3).
 *
 * `seedPatient()` returns a *handle with methods* — `suspend()`, `hideItem()`,
 * `repairQueueRows()` — because that is exactly how the suite uses it.
 */

const admin = require('firebase-admin');
const crypto = require('crypto');
const { writableBucket, initOnce } = require('./storage');
const { assertStatefulTargetAllowed } = require('./env');

const PREFIX = 'redteam-';

function db() {
  assertStatefulTargetAllowed();
  return initOnce().firestore();
}

let counter = 0;
function uniqueId(kind) {
  counter += 1;
  return `${PREFIX}${kind}-${Date.now()}-${counter}`;
}

/**
 * Mint a real patient token the production read handler will accept.
 * Uses a custom token exchanged by the emulator/test-project auth instance;
 * no credentials are ever logged.
 */
async function mintPatientToken(firebaseUid) {
  const customToken = await initOnce().auth().createCustomToken(firebaseUid, { portal: true });
  const apiKey = process.env.REDTEAM_WEB_API_KEY;
  if (!apiKey) throw new Error('red-team: REDTEAM_WEB_API_KEY required to exchange patient tokens');
  const base = process.env.FIREBASE_AUTH_EMULATOR_HOST
    ? `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1`
    : 'https://identitytoolkit.googleapis.com/v1';
  const res = await fetch(`${base}/accounts:signInWithCustomToken?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  if (!res.ok) throw new Error(`red-team: token exchange failed (${res.status})`);
  const json = await res.json();
  return json.idToken;
}

/**
 * Create a test patient and return a handle the suite can act through.
 * @returns {Promise<{patientId, firebaseUid, token, suspend, hideItem, repairQueueRows}>}
 */
/**
 * Access state lives in the TOP-LEVEL `portalAccess/{patientId}` collection —
 * the same one `core/services/patient/portalAccess.js` and `adminSetPortalAccess`
 * read/write (`status`, `hiddenItems: { module: [ids] }`). A `portalAccess`
 * FIELD on the patient doc is invisible to production and must never be used.
 */
function accessRef(patientId) {
  return db().collection('portalAccess').doc(patientId);
}

async function seedPatient({ id, suspended = false, bound = true, minor = false } = {}) {
  const patientId = id ? `${PREFIX}${id}` : uniqueId('patient');
  // A MINOR never logs in: no Firebase Auth uid at all. That is exactly why
  // storage is keyed on `internalUid` (Release 2b Part B) and not on the uid.
  const firebaseUid = minor ? null : `${patientId}-uid`.toLowerCase();
  const internalUid = crypto.randomUUID();

  await db()
    .collection('patients')
    .doc(patientId)
    .set(
      {
        redteam: true,
        // `bound: false` mirrors a record with NO storage key at all, so the
        // audit must classify its artifacts `unpathed`.
        ...(bound ? { internalUid } : {}),
        ...(bound && firebaseUid ? { firebaseUid } : {}),
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );

  if (suspended) {
    await accessRef(patientId).set({ redteam: true, status: 'suspended' }, { merge: true });
  }

  // Minors get no token — a guardian acts for them.
  const token = firebaseUid ? await mintPatientToken(firebaseUid) : null;

  return {
    patientId,
    firebaseUid,
    internalUid: bound ? internalUid : null,
    minor,
    token,
    /** Attach `guardian` (a seedPatient handle) as a proxy on THIS record. */
    async linkGuardian(guardian, { status = 'active' } = {}) {
      await db().collection('patients').doc(patientId).set(
        {
          guardians: admin.firestore.FieldValue.arrayUnion({
            guardianElationId: guardian.patientId,
            guardianEmail: `${guardian.patientId}@example.test`,
            guardianUid: guardian.firebaseUid,
            source: 'manual',
            status,
            confirmedBy: 'redteam',
            reason: 'redteam',
          }),
        },
        { merge: true },
      );
    },
    /** Flip one guardian entry's status (revoked / pending_adult_consent). */
    async setGuardianStatus(guardian, status) {
      const snap = await db().collection('patients').doc(patientId).get();
      const guardians = (snap.get('guardians') || []).map((g) =>
        g.guardianElationId === guardian.patientId ? { ...g, status } : g);
      await db().collection('patients').doc(patientId).set({ guardians }, { merge: true });
    },
    async suspend() {
      await accessRef(patientId).set({ redteam: true, status: 'suspended' }, { merge: true });
    },
    async hideItem({ module: moduleKey, id: itemId }) {
      await accessRef(patientId).set(
        {
          redteam: true,
          hiddenItems: { [moduleKey]: admin.firestore.FieldValue.arrayUnion(String(itemId)) },
        },
        { merge: true },
      );
    },
    /** Toggle a portalAccess module on the CHILD's record. */
    async setModule(moduleKey, visible) {
      await accessRef(patientId).set(
        { redteam: true, modules: { [moduleKey]: !!visible } },
        { merge: true },
      );
    },
    /** Simulate an invite claim: records the AUTH uid, never the storage key. */
    async claimLogin(uid) {
      await db().collection('patients').doc(patientId).set(
        { firebaseUid: String(uid).toLowerCase() },
        { merge: true },
      );
    },
    async readInternalUid() {
      const snap = await db().collection('patients').doc(patientId).get();
      return snap.get('internalUid') || null;
    },
    async repairQueueRows() {
      const snap = await db()
        .collection('artifact_repair_queue')
        .where('patientId', '==', patientId)
        .get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },
  };
}

/**
 * Seed a document reference for a patient handle.
 * `missingObject: true` seeds a DELIBERATE MISS — the reference exists, the
 * object does not. That is what the on-miss and heal cases require.
 *
 * `module` mirrors the production wrapper that would serve this artifact
 * (`labs` -> getLabs, `imaging` -> getImaging, `records` -> getMedicalRecords).
 * All artifact-bearing docs live in the patient's `labs` subcollection and are
 * discriminated by `category`; the OBJECT lives under the caller's uid prefix,
 * which is how production proves ownership.
 */
async function seedDocument(
  patient,
  { documentId, hidden = false, missingObject = false, module: moduleKey = 'labs' } = {},
) {
  if (typeof patient === 'string') throw new Error('seedDocument requires a seedPatient() handle (uid-keyed paths)');
  const { patientId, firebaseUid, internalUid } = patient;
  const docId = documentId ? `${PREFIX}${documentId}` : uniqueId('doc');
  // Release 2b Part B: the OBJECT is keyed on the record's internalUid.
  const path = `elation-artifacts/${internalUid}/${docId}/report.pdf`;
  const CATEGORY = { labs: 'lab', imaging: 'imaging', records: 'medical_records' };
  const b = writableBucket();

  await db()
    .collection('patients')
    .doc(patientId)
    .collection('labs')
    .doc(docId)
    .set({
      redteam: true,
      hasArtifact: true,
      reportId: docId,
      category: CATEGORY[moduleKey],
      deleted: false,
      // Production lab docs carry NO artifactPath — the uid lives on the parent
      // patient doc and the path is derived. Seeding artifactPath here hid the
      // audit's uid-resolution bug, so the seed now matches production shape.
      updatedAt: new Date().toISOString(),
    });

  if (hidden) {
    await accessRef(patientId).set(
      {
        redteam: true,
        hiddenItems: { [moduleKey]: admin.firestore.FieldValue.arrayUnion(String(docId)) },
      },
      { merge: true },
    );
  }

  if (missingObject) {
    await b.file(path).delete({ ignoreNotFound: true });
  } else {
    await b.file(path).save(Buffer.from('%PDF-1.4 redteam'), {
      contentType: 'application/pdf',
      resumable: false,
    });
  }

  return { patientId, firebaseUid, internalUid, documentId: docId, path, bucket: b.name, module: moduleKey };
}

/** PHI access-log rows this suite produced, for the both-uid assertions. */
async function accessLogRows({ reportId } = {}) {
  let q = db().collection('phi_access_log');
  if (reportId) q = q.where('reportId', '==', reportId);
  const snap = await q.get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Run the REAL sweep against a seeded miss (never a fake write). */
async function healArtifact({ patientId, documentId, path }) {
  if (!patientId) throw new Error('healArtifact requires patientId — pass the seedDocument result');
  await db()
    .collection('artifact_repair_queue')
    .doc(`${patientId}:${documentId}`)
    .set(
      {
        patientId,
        documentId,
        path,
        failures: 0,
        parked: false,
        repairedAt: null,
        source: 'redteam',
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
  // eslint-disable-next-line import/no-unresolved, global-require
  const { _sweep } = require('../../../functions/sweepArtifactRepairs');
  return _sweep();
}

/** Artifact-bearing docs all live in `labs`; the rest are cleaned for safety. */
const SEEDED_COLLECTIONS = ['labs', 'imaging', 'medications', 'letters', 'documents', 'appointments', 'problems', 'allergies'];

/** Remove everything this suite created. Safe to call repeatedly. */
async function cleanup() {
  const firestore = db();
  const snap = await firestore.collection('patients').where('redteam', '==', true).get();
  for (const doc of snap.docs) {
    for (const col of SEEDED_COLLECTIONS) {
      const docs = await doc.ref.collection(col).get();
      await Promise.all(docs.docs.map((d) => d.ref.delete()));
    }
    // Access state lives in the top-level collection, keyed by patient id.
    await firestore.collection('portalAccess').doc(doc.id).delete().catch(() => {});
    await doc.ref.delete();
  }
  const queue = await firestore.collection('artifact_repair_queue').where('source', '==', 'redteam').get();
  await Promise.all(queue.docs.map((d) => d.ref.delete()));
  const logs = await firestore
    .collection('phi_access_log')
    .where('reportId', '>=', PREFIX)
    .where('reportId', '<', `${PREFIX}\uf8ff`)
    .get()
    .catch(() => ({ docs: [] }));
  await Promise.all(logs.docs.map((d) => d.ref.delete()));
  await writableBucket().deleteFiles({ prefix: 'elation-artifacts/redteam-', force: true });
}

module.exports = {
  seedPatient,
  seedDocument,
  healArtifact,
  accessLogRows,
  cleanup,
  PREFIX,
  SEEDED_COLLECTIONS,
};
