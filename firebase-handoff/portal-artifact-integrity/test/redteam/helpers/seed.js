/**
 * Red-team helpers — seeding. Real Firestore + real Storage, test-scoped.
 *
 * Everything created here lives under the `redteam-` id prefix so a cleanup
 * pass can find it, and the helpers refuse to run against a project that is not
 * explicitly marked as a test target.
 */

const admin = require('firebase-admin');
const { bucket } = require('./storage');

const PREFIX = 'redteam-';

function db() {
  if (!process.env.REDTEAM_ALLOW_WRITES) {
    throw new Error('red-team seed: REDTEAM_ALLOW_WRITES not set — refusing to write');
  }
  if (!admin.apps.length) admin.initializeApp();
  return admin.firestore();
}

async function seedPatient({ id, suspended = false, firebaseUid = null } = {}) {
  const patientId = `${PREFIX}${id || Date.now()}`;
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
  return { patientId, firebaseUid };
}

async function seedDocument(patientId, { documentId, hidden = false, withObject = true } = {}) {
  const docId = `${PREFIX}${documentId || Date.now()}`;
  const path = `elation-artifacts/${patientId}/${docId}/report.pdf`;

  await db()
    .collection('patients')
    .doc(patientId)
    .collection('documents')
    .doc(docId)
    .set({ redteam: true, hasArtifact: true, artifactPath: path, updatedAt: new Date().toISOString() });

  if (hidden) {
    await db()
      .collection('patients')
      .doc(patientId)
      .set({ portalAccess: { hidden: { [docId]: true } } }, { merge: true });
  }

  if (withObject) {
    await bucket().file(path).save(Buffer.from('%PDF-1.4 redteam'), {
      contentType: 'application/pdf',
      resumable: false,
    });
  } else {
    // Deliberately seeded miss — this is what the sweep must heal.
    await bucket().file(path).delete({ ignoreNotFound: true });
  }

  return { documentId: docId, path };
}

/** Run the real sweep against a seeded miss (never a fake write). */
async function healArtifact({ patientId, documentId, path }) {
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

module.exports = { seedPatient, seedDocument, healArtifact, PREFIX };
