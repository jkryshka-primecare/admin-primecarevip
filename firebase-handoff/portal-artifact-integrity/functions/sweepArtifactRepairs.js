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
// Shared repo client. Its verified exports are elationGet, elationGetAll,
// getBinary, elationPost, ELATION_BASE — there is NO `fetchDocumentPdf`, so the
// sweep uses `getBinary` against `/reports/<id>/printable` — the exact endpoint
// `backfillElationReports.js` uses to fetch report PDFs (verified in repo).
const elation = require('./core/services/elation/client');
const { artifactBucketName } = require('./core/config/artifactBucket');

const REGION = 'us-central1';
const BATCH_LIMIT = 100;
const MAX_FAILURES = 5;
const LEASE_MS = 10 * 60 * 1000;
/** Transient upstream statuses: back off the run, never park the document. */
const TRANSIENT = new Set([429, 500, 502, 503, 504]);

/**
 * Binary fetch for a document's PDF via the shared client.
 *
 * `getBinary` resolves to a WRAPPER — `{ buffer, contentType, ... }` — not raw
 * bytes (this is exactly how `backfillElationReports.js` consumes it). Passing
 * the wrapper straight into `file.save()` makes Node throw
 * `The "body" argument must be of type ... Received an instance of Object`,
 * which healed 0 / failed 100 on the first sweep run. Always unwrap here so the
 * caller can only ever see a Buffer.
 */
async function fetchDocumentPdf(documentId) {
  const res = await elation.getBinary(`/reports/${documentId}/printable`);
  const bytes = Buffer.isBuffer(res) ? res : res && (res.buffer || res.body || res.data);
  if (!bytes) {
    throw new Error(`elation getBinary returned no bytes for report ${documentId}`);
  }
  return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
}



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
  // Never bare: heals must land in the bucket the read path serves from.
  return admin.storage().bucket(artifactBucketName());
}

/** Repair one queue row. Returns 'healed' | 'failed' | 'deferred' | 'blocked'. */
async function repairOne(row, ref) {
  try {
    const pdf = await fetchDocumentPdf(row.documentId);
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
    // Review item 5: a throttling or flapping upstream must back the whole run
    // off, not fire the rest of the batch at it and permanently park documents
    // that were only transiently unavailable. No failure count is incremented.
    if (TRANSIENT.has(status)) {
      await ref.set(
        { lastError: `transient ${status}: ${err && err.message}`, updatedAt: new Date().toISOString() },
        { merge: true },
      );
      functions.logger.warn('artifact sweep: transient upstream, deferring run', {
        status,
        documentId: row.documentId,
      });
      return 'deferred';
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
    let deferred = 0;

    for (const doc of snap.docs) {
      const outcome = await repairOne(doc.data(), doc.ref);
      if (outcome === 'blocked') break; // circuit breaker: stop the whole run
      if (outcome === 'deferred') {
        // Transient upstream: end the run here and retry on the next schedule
        // rather than hammering a throttling Elation with the rest of the batch.
        deferred += 1;
        break;
      }
      if (outcome === 'healed') healed += 1;
      else failed += 1;
    }

    // A successful probe while paused clears the pause; a denied probe keeps it.
    if (probeOnly && healed > 0) await resume();

    return { probeOnly, considered: snap.size, healed, failed, deferred };

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
