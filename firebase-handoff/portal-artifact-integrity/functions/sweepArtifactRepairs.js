/**
 * Release 2a · B — self-heal, nightly sweep (the primary healer).
 *
 * Reads the audit's missing set, re-fetches each document from Elation through
 * the shared client, stores it at the current path, and writes an audit row.
 *
 * Guarantees (background-job rules):
 *   - bounded: BATCH_LIMIT items per run, ends with work remaining
 *   - single-flight: lease row with expiry; a concurrent run exits
 *   - idempotent: `repairedAt` marked in the same step that heals
 *   - circuit breaker: 402/403 pause the whole job; repeated 429/5xx park it
 *   - paused-state guard at every entry point, with a single probe item
 *
 * Healing is STORAGE-ONLY. It never touches portalAccess: a healed artifact for
 * a hidden item or a suspended patient stays unreadable. The read path is the
 * only place suppression is decided, and the red-team suite asserts it.
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const elation = require('./core/services/elation/client');

const REGION = 'us-central1';
const BATCH_LIMIT = 100;
const MAX_FAILURES = 5;
const LEASE_MS = 10 * 60 * 1000;

const stateRef = () => admin.firestore().collection('artifact_repair_state');

async function acquireLease() {
  const ref = stateRef().doc('lock');
  const now = Date.now();
  try {
    return await admin.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const held = snap.exists ? snap.data().expiresAt || 0 : 0;
      if (held > now) return false;
      tx.set(ref, { expiresAt: now + LEASE_MS, acquiredAt: new Date().toISOString() });
      return true;
    });
  } catch (err) {
    functions.logger.error('artifact sweep: lease failed', err);
    return false;
  }
}

async function releaseLease() {
  await stateRef().doc('lock').set({ expiresAt: 0 }, { merge: true });
}

async function readStatus() {
  const snap = await stateRef().doc('status').get();
  return snap.exists ? snap.data() : { paused: false };
}

async function pause(reason, requires) {
  await stateRef().doc('status').set(
    { paused: true, reason, requires: requires || null, pausedAt: new Date().toISOString() },
    { merge: true },
  );
  functions.logger.error('artifact sweep paused', { reason, requires });
}

async function resume() {
  await stateRef().doc('status').set(
    { paused: false, reason: null, requires: null, resumedAt: new Date().toISOString() },
    { merge: true },
  );
}

function bucket() {
  return admin.storage().bucket();
}

/** Repair one queue row. Returns 'healed' | 'failed' | 'blocked'. */
async function repairOne(row, ref) {
  try {
    const pdf = await elation.fetchDocumentPdf(row.documentId);
    await bucket().file(row.path).save(pdf, {
      contentType: 'application/pdf',
      resumable: false,
      // Bucket is private and uniform-access; no ACLs are set here, ever.
    });
    await ref.set(
      { repairedAt: new Date().toISOString(), failures: row.failures || 0, parked: false },
      { merge: true },
    );
    await admin.firestore().collection('artifact_repair_audit').add({
      at: new Date().toISOString(),
      action: 'healed',
      patientId: row.patientId,
      documentId: row.documentId,
      path: row.path,
      source: row.source || 'sweep',
    });
    return 'healed';
  } catch (err) {
    const status = err && err.status;
    if (status === 402 || status === 403) {
      await pause(`Elation/upstream returned ${status}: ${err.message}`, status === 402 ? 'top_up' : 'admin_action');
      return 'blocked';
    }
    const failures = (row.failures || 0) + 1;
    const parked = failures >= MAX_FAILURES;
    await ref.set(
      { failures, parked, lastError: String(err && err.message), updatedAt: new Date().toISOString() },
      { merge: true },
    );
    await admin.firestore().collection('artifact_repair_audit').add({
      at: new Date().toISOString(),
      action: parked ? 'parked' : 'failed',
      patientId: row.patientId,
      documentId: row.documentId,
      path: row.path,
      error: String(err && err.message),
    });
    if (parked) {
      functions.logger.error('artifact repair parked — health alert', {
        patientId: row.patientId,
        documentId: row.documentId,
        failures,
      });
    }
    return 'failed';
  }
}

async function sweep() {
  const status = await readStatus();
  // Paused-state guard: the scheduler keeps firing regardless of job state.
  const probeOnly = status.paused === true;

  if (!(await acquireLease())) {
    functions.logger.info('artifact sweep: another run holds the lease, exiting');
    return { skipped: true };
  }

  try {
    const limit = probeOnly ? 1 : BATCH_LIMIT;
    const snap = await admin
      .firestore()
      .collection('artifact_repair_queue')
      .where('repairedAt', '==', null)
      .where('parked', '==', false)
      .limit(limit)
      .get();

    let healed = 0;
    let failed = 0;

    for (const doc of snap.docs) {
      const outcome = await repairOne(doc.data(), doc.ref);
      if (outcome === 'blocked') break; // circuit breaker: stop the whole run
      if (outcome === 'healed') healed += 1;
      else failed += 1;
    }

    // A successful probe while paused clears the pause; a denied probe keeps it.
    if (probeOnly && healed > 0) await resume();

    return { probeOnly, considered: snap.size, healed, failed };
  } finally {
    await releaseLease();
  }
}

exports.sweepArtifactRepairs = functions
  .region(REGION)
  .runWith({ timeoutSeconds: 540, memory: '512MB', secrets: ['ELATION_CLIENT_ID', 'ELATION_CLIENT_SECRET'] })
  .pubsub.schedule('45 3 * * *')
  .timeZone('America/New_York')
  .onRun(async () => {
    const out = await sweep();
    functions.logger.info('artifact sweep complete', out);
    return null;
  });

exports._sweep = sweep;
