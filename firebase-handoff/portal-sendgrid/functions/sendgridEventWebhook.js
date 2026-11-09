// functions/sendgridEventWebhook.js
// #362 / D-408 — SendGrid Event Webhook receiver.
//
// Public HTTPS endpoint (SendGrid must be able to reach it, so the invoker
// binding is allUsers, same as twilioWebhook). Open invocation is NOT open
// access: the gate is in-function ECDSA signature verification against the
// webhook's verification key, held in Secret Manager. Unverified request ->
// 403 and NOTHING is written.
//
// What it maintains:
//   emailEvents/{sg_event_id}    every event, idempotent by sg_event_id
//   emailSuppression/{email}     the suppression source the Phase 2
//                                autosender (#558 / D-407) fail-closes without
//
// Review only: no merge/deploy authorized. Portal default Firestore only;
// never import CRM handlers or select the named `crm` database.

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const { log, logError } = require('./middleware/logger');

const {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  verifyEventSignature,
  parseEventBatch,
  classifyEvent,
  buildEventRecord,
} = require('./core/services/email/sendgridEvents');
// The suppression collection, row shape and upsert live in the SHARED module
// that the D-407 autosender reads from — see core/services/email/suppression.js.
const {
  SUPPRESSION_COLLECTION,
  writeSuppressionInTransaction,
} = require('./core/services/email/suppression');

const PROJECT_ID = process.env.GCLOUD_PROJECT || 'prive-care-vip';
const SECRET_NAME = 'SENDGRID_WEBHOOK_SIGNING_KEY';
const EVENTS_COLLECTION = 'emailEvents';
/** SendGrid batches; anything larger than this is not a real batch. */
const MAX_EVENTS_PER_REQUEST = 5000;

let cachedKey = null;
let cachedKeyAtMs = 0;
const KEY_TTL_MS = 10 * 60 * 1000;

/** The verification key lives in Secret Manager — never in code, never in env. */
async function getVerificationKey(nowMs = Date.now()) {
  if (cachedKey && nowMs - cachedKeyAtMs < KEY_TTL_MS) return cachedKey;
  const client = new SecretManagerServiceClient();
  const [version] = await client.accessSecretVersion({
    name: `projects/${PROJECT_ID}/secrets/${SECRET_NAME}/versions/latest`,
  });
  cachedKey = version.payload.data.toString('utf8').trim();
  cachedKeyAtMs = nowMs;
  return cachedKey;
}

/** Test seam — lets the unit suite inject a key without Secret Manager. */
function _setCachedKeyForTest(key, nowMs = Date.now()) {
  cachedKey = key;
  cachedKeyAtMs = nowMs;
}

/**
 * Atomically commit the event and suppression row. A failed suppression
 * write must not leave an event that makes its retry look already processed.
 */
async function storeEvent(db, classified, record, nowMs) {
  const ref = db.collection(EVENTS_COLLECTION).doc(classified.sgEventId);
  return db.runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists) return { stored: false, duplicate: true };
    if (classified.suppression) {
      await writeSuppressionInTransaction(db, tx, classified, record, nowMs);
    }
    tx.create(ref, record);
    return { stored: true, duplicate: false };
  });
}

/**
 * Core handler, exported so tests can drive it with a fake db/req/res.
 */
async function handleEventWebhook({ db, req, res, publicKey, nowMs = Date.now() }) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return { rejected: 'METHOD' };
  }

  const signature = req.headers[SIGNATURE_HEADER] || req.headers[SIGNATURE_HEADER.toUpperCase()];
  const timestamp = req.headers[TIMESTAMP_HEADER] || req.headers[TIMESTAMP_HEADER.toUpperCase()];

  const verified = verifyEventSignature({
    publicKey,
    signature,
    timestamp,
    rawBody: req.rawBody,
    nowMs,
  });
  if (!verified.ok) {
    // Nothing is parsed, nothing is stored. The reason is logged, never the body.
    logError('sendgridEventWebhook', 'signature_rejected', new Error(verified.reason), {
      reason: verified.reason,
    });
    res.status(403).json({ error: 'forbidden' });
    return { rejected: verified.reason };
  }

  const batch = parseEventBatch(req.rawBody);
  if (!batch.ok) {
    res.status(400).json({ error: batch.reason.toLowerCase() });
    return { rejected: batch.reason };
  }
  if (batch.events.length > MAX_EVENTS_PER_REQUEST) {
    res.status(413).json({ error: 'batch_too_large' });
    return { rejected: 'BATCH_TOO_LARGE' };
  }

  const stats = {
    received: batch.events.length,
    stored: 0,
    duplicates: 0,
    suppressed: 0,
    funnel: 0,
    invalid: 0,
    failed: 0,
  };

  for (const evt of batch.events) {
    const classified = classifyEvent(evt);
    if (!classified.valid) {
      stats.invalid += 1;
      continue;
    }
    const record = buildEventRecord(evt, classified, nowMs);
    try {
      const outcome = await storeEvent(db, classified, record, nowMs);
      if (outcome.duplicate) {
        stats.duplicates += 1;
        continue; // a re-delivery re-applies nothing
      }
      stats.stored += 1;
      if (classified.suppression) {
        stats.suppressed += 1;
      } else if (classified.funnel) {
        stats.funnel += 1;
      }
    } catch (e) {
      stats.failed += 1;
      logError('sendgridEventWebhook', 'event_write_failed', e, { event: classified.eventType });
    }
  }

  log('sendgridEventWebhook', 'batch_processed', stats);

  if (stats.failed > 0) {
    // Non-2xx makes SendGrid retry the batch; stores are idempotent.
    res.status(500).json({ ok: false, ...stats });
    return stats;
  }
  res.status(200).json({ ok: true, ...stats });
  return stats;
}

const sendgridEventWebhook = functions
  .region('us-central1')
  .runWith({ memory: '256MB', timeoutSeconds: 120 })
  .https.onRequest(async (req, res) => {
    let publicKey = null;
    try {
      publicKey = await getVerificationKey();
    } catch (e) {
      logError('sendgridEventWebhook', 'verification_key_unavailable', e, {});
      // Fail CLOSED: no key means we cannot prove the caller is SendGrid.
      res.status(503).json({ error: 'verification_unavailable' });
      return;
    }
    try {
      await handleEventWebhook({ db: admin.firestore(), req, res, publicKey });
    } catch (e) {
      logError('sendgridEventWebhook', 'unhandled', e, {});
      if (!res.headersSent) res.status(500).json({ error: 'internal' });
    }
  });

module.exports = {
  sendgridEventWebhook,
  handleEventWebhook,
  getVerificationKey,
  _setCachedKeyForTest,
  EVENTS_COLLECTION,
  SUPPRESSION_COLLECTION,
  SECRET_NAME,
};
