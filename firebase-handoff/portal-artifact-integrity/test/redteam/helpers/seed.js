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
async function seedPatient({ id, suspended = false } = {}) {
  const patientId = id ? `${PREFIX}${id}` : uniqueId('patient');
  const firebaseUid = `${patientId}-uid`.toLowerCase();

  await db()
    .collection('patients')
    .doc(patientId)
    .set(
      {
        redteam: true,
        firebaseUid,
        portalAccess: { suspended, hidden: {} },
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );

  const token = await mintPatientToken(firebaseUid);

  return {
    patientId,
    firebaseUid,
    token,
    async suspend() {
      await db()
        .collection('patients')
        .doc(patientId)
        .set({ portalAccess: { suspended: true } }, { merge: true });
    },
    async hideItem({ module: moduleKey, id: itemId }) {
      await db()
        .collection('patients')
        .doc(patientId)
        .set(
          { portalAccess: { hidden: { [moduleKey]: { [itemId]: true } } } },
          { merge: true },
        );
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
  const { patientId, firebaseUid } = patient;
  const docId = documentId ? `${PREFIX}${documentId}` : uniqueId('doc');
  const path = `elation-artifacts/${firebaseUid}/${docId}/report.pdf`;
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
    await db()
      .collection('patients')
      .doc(patientId)
      .set({ portalAccess: { hidden: { [moduleKey]: { [docId]: true } } } }, { merge: true });
  }

  if (missingObject) {
    await b.file(path).delete({ ignoreNotFound: true });
  } else {
    await b.file(path).save(Buffer.from('%PDF-1.4 redteam'), {
      contentType: 'application/pdf',
      resumable: false,
    });
  }

  return { patientId, firebaseUid, documentId: docId, path, bucket: b.name, module: moduleKey };
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
    await doc.ref.delete();
  }
  const queue = await firestore.collection('artifact_repair_queue').where('source', '==', 'redteam').get();
  await Promise.all(queue.docs.map((d) => d.ref.delete()));
  await writableBucket().deleteFiles({ prefix: 'elation-artifacts/redteam-', force: true });
}

module.exports = { seedPatient, seedDocument, healArtifact, cleanup, PREFIX, SEEDED_COLLECTIONS };
