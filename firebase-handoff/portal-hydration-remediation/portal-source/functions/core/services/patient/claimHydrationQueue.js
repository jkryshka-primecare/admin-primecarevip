// REVIEW ONLY: patient-ID keyed durable invitation hydration, committed pre-response.
const { DEFAULT_RECOVERY_RUN_ID } = require('./hydrationStatus');
async function queueClaimHydration({ db, FieldValue, patientId, rawUid }) {
  const id = String(patientId);
  if (!/^\d{6,25}$/.test(id) || typeof rawUid !== 'string' || !rawUid) throw new Error('INVALID_BINDING');
  const patient = db.collection('patients').doc(id);
  const job = db.collection('claim_hydration_jobs').doc(id);
  const recovery = db.collection('hydration_runs').doc(DEFAULT_RECOVERY_RUN_ID);
  return db.runTransaction(async (tx) => {
    const [p, j] = await Promise.all([tx.get(patient), tx.get(job)]);
    const d = p.exists ? p.data() : null;
    if (!d || d.authUid !== rawUid || d.firebaseUid !== rawUid.toLowerCase()) throw new Error('BINDING_MISMATCH');
    if (d.hydrationStatus === 'complete' || d.hydrationStatus === 'failed' || j.exists) return false;
    tx.set(patient, { status: 'active', hydrationStatus: 'pending', hydrationPendingAt: FieldValue.serverTimestamp(), hydrationRunId: DEFAULT_RECOVERY_RUN_ID }, { merge: true });
    tx.set(job, { patientId: id, rawUid, state: 'queued', createdAt: FieldValue.serverTimestamp() });
    // Atomic safety net: if the worker never arrives, stale-pending Recovery owns it.
    tx.set(recovery, { runId: DEFAULT_RECOVERY_RUN_ID, standing: true, queued: FieldValue.arrayUnion(id), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return true;
  });
}
module.exports = { queueClaimHydration };