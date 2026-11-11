// REVIEW ONLY. A durable Firestore trigger, not work started after an HTTP response.
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { runPostClaimSteps } = require('./core/services/patient/postClaim');
const { markDeferred } = require('./core/services/patient/hydrationStatus');
exports.claimHydrationWorker = functions.region('us-central1')
  .runWith({ timeoutSeconds: 180, memory: '512MB', failurePolicy: true, secrets: ['ELATION_CLIENT_ID', 'ELATION_CLIENT_SECRET'] })
  .firestore.document('claim_hydration_jobs/{patientId}').onCreate(async (snap, context) => {
    const db = admin.firestore();
    const id = String(context.params.patientId);
    const job = snap.data() || {};
    const acquired = await db.runTransaction(async (tx) => {
      const [current, patient] = await Promise.all([tx.get(snap.ref), tx.get(db.collection('patients').doc(id))]);
      const j = current.data() || {}; const p = patient.exists ? patient.data() : null;
      if (!p || p.authUid !== job.rawUid || p.firebaseUid !== String(job.rawUid).toLowerCase()) throw new Error('BINDING_MISMATCH');
      if (['complete', 'failed'].includes(p.hydrationStatus) || j.state === 'done') return false;
      if (j.state === 'running' && Number(j.leaseUntilMs) > Date.now()) throw new Error('WORKER_LEASE_LIVE');
      tx.set(snap.ref, { state: 'running', leaseUntilMs: Date.now() + 180000 }, { merge: true });
      return true;
    });
    if (!acquired) return;
    try {
      await runPostClaimSteps({ elationPatientId: id, uid: job.rawUid.toLowerCase(), actor: 'claimHydrationWorker', ownsPending: true });
      const patient = await db.collection('patients').doc(id).get();
      if (patient.get('hydrationStatus') === 'pending') {
        await markDeferred(db, admin.firestore.FieldValue, id, { reason: 'CLAIM_WORKER_INCOMPLETE' });
      }
      await snap.ref.set({ state: 'done', leaseUntilMs: 0, finishedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    } catch (err) {
      // Retry has a durable checkpoint; Recovery independently retains the patient ID.
      await snap.ref.set({ state: 'queued', leaseUntilMs: 0 }, { merge: true });
      throw err;
    }
  });