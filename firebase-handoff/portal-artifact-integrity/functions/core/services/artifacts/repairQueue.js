/**
 * Release 2a · C — on-miss repair backstop.
 *
 * A patient read that hits a missing object enqueues a repair and immediately
 * returns a "preparing your document" state. The member is never blocked on an
 * Elation round-trip, so a slow or down Elation degrades to a calm message
 * rather than a hang. The nightly sweep remains the primary healer.
 *
 * SECURITY — the one rule that makes this safe:
 * the owning patient id is taken from the SERVER-SIDE AUTHENTICATED READ
 * CONTEXT (`ctx.patientId`, already resolved by verifyPatientToken + the
 * ownership resolver). This function accepts no caller-supplied patient id, so
 * a caller cannot enqueue "repair document X for patient Y" and have the queue
 * fetch someone else's PHI. Dedup is on (patientId, documentId), never on
 * documentId alone.
 */

const admin = require('firebase-admin');

const PREPARING = { state: 'preparing', message: 'We are preparing your document. Check back shortly.' };

/**
 * @param {{ patientId: string }} ctx  server-resolved read context — NOT client input
 * @param {{ documentId: string, path: string }} doc  the reference that 404'd
 */
async function enqueueRepair(ctx, doc) {
  const patientId = ctx && ctx.patientId;
  if (!patientId) throw new Error('enqueueRepair requires a server-resolved patient context');
  if (!doc || !doc.documentId) throw new Error('enqueueRepair requires a documentId');

  const key = `${patientId}:${doc.documentId}`;
  const ref = admin.firestore().collection('artifact_repair_queue').doc(key);

  // create-if-absent: a refresh-happy member cannot queue the same repair twice,
  // and a queued row for another patient can never be reached from here because
  // the key is derived, not supplied.
  await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists && !snap.data().repairedAt) return;
    tx.set(
      ref,
      {
        patientId,
        documentId: doc.documentId,
        path: doc.path,
        firstSeenAt: (snap.exists && snap.data().firstSeenAt) || new Date().toISOString(),
        failures: 0,
        parked: false,
        repairedAt: null,
        source: 'on-miss',
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
  });

  return PREPARING;
}

module.exports = { enqueueRepair, PREPARING };
