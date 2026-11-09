// functions/core/services/email/sendgridEvents.js
// #362 / D-408 — pure decision + verification layer for the SendGrid Event
// Webhook receiver. No Firestore, no network, no secrets: everything here is
// deterministic and unit-testable. The driver (sendgridEventWebhook.js) owns
// I/O only.
//
// Signature scheme verified against live SendGrid docs at build time (D-079):
//   https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/getting-started-event-webhook-security-features
//   - signature header:  X-Twilio-Email-Event-Webhook-Signature   (base64 ASN.1/DER ECDSA)
//   - timestamp header:  X-Twilio-Email-Event-Webhook-Timestamp
//   - digest:            SHA-256 over the RAW request bytes, prefixed by the
//                        timestamp string: sha256(timestamp || rawBody)
//   - key:               the webhook's public verification key, base64 DER
//                        SubjectPublicKeyInfo (ECDSA, prime256v1)
// The docs warn the payload MUST be used in raw-byte form — re-serializing
// parsed JSON changes bytes and breaks verification. We never touch req.body.
//
// Event payload shape verified against:
//   https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/event
// A POST body is a JSON ARRAY of event objects; the fields we persist are
// email, event, timestamp, sg_event_id, sg_message_id, reason, status, type,
// bounce_classification. Nothing else is stored — no PHI, no categories.

const crypto = require('crypto');

/** Reject signed requests older/newer than this. Replay fence. */
const MAX_TIMESTAMP_SKEW_MS = 10 * 60 * 1000;

const SIGNATURE_HEADER = 'x-twilio-email-event-webhook-signature';
const TIMESTAMP_HEADER = 'x-twilio-email-event-webhook-timestamp';

/** Events that must stop us ever emailing that address again. */
const SUPPRESSION_EVENTS = new Set(['bounce', 'dropped', 'spamreport', 'unsubscribe', 'group_unsubscribe']);

/** Events that feed the invited -> opened onboarding funnel (D-116). Never suppression. */
const FUNNEL_EVENTS = new Set(['processed', 'delivered', 'open', 'click', 'deferred', 'group_resubscribe']);

function normalizeEmail(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

/**
 * Firestore doc IDs cannot contain '/'. sg_event_id is standard base64, which
 * can. base64url-ify it — still collision-free, still 1:1 with the event.
 */
function eventDocId(sgEventId) {
  const raw = typeof sgEventId === 'string' ? sgEventId.trim() : '';
  if (!raw) return '';
  return raw.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Verify a SendGrid signed Event Webhook request.
 * Fails CLOSED on every missing input — no key, no signature, no timestamp,
 * no body all mean "not verified", never "skip verification".
 *
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
function verifyEventSignature({ publicKey, signature, timestamp, rawBody, nowMs = Date.now(), maxSkewMs = MAX_TIMESTAMP_SKEW_MS }) {
  if (!publicKey || typeof publicKey !== 'string') return { ok: false, reason: 'NO_VERIFICATION_KEY' };
  if (!signature || typeof signature !== 'string') return { ok: false, reason: 'MISSING_SIGNATURE' };
  if (!timestamp || typeof timestamp !== 'string') return { ok: false, reason: 'MISSING_TIMESTAMP' };
  if (!Buffer.isBuffer(rawBody)) return { ok: false, reason: 'MISSING_RAW_BODY' };

  const tsSeconds = Number(timestamp);
  if (!Number.isFinite(tsSeconds)) return { ok: false, reason: 'BAD_TIMESTAMP' };
  if (Math.abs(nowMs - tsSeconds * 1000) > maxSkewMs) return { ok: false, reason: 'TIMESTAMP_OUT_OF_WINDOW' };

  let key;
  try {
    key = crypto.createPublicKey({
      key: Buffer.from(publicKey.replace(/\s+/g, ''), 'base64'),
      format: 'der',
      type: 'spki',
    });
  } catch (e) {
    return { ok: false, reason: 'BAD_VERIFICATION_KEY' };
  }

  let valid = false;
  try {
    const verifier = crypto.createVerify('sha256');
    verifier.update(Buffer.from(timestamp, 'utf8'));
    verifier.update(rawBody);
    verifier.end();
    // SendGrid emits ASN.1/DER-encoded ECDSA signatures — Node's default
    // dsaEncoding is 'der', which matches.
    valid = verifier.verify(key, Buffer.from(signature, 'base64'));
  } catch (e) {
    valid = false;
  }
  return valid ? { ok: true } : { ok: false, reason: 'BAD_SIGNATURE' };
}

/** Parse the POST body. SendGrid always posts a JSON array of events. */
function parseEventBatch(rawBody) {
  let text;
  try {
    text = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
  } catch (e) {
    return { ok: false, reason: 'UNREADABLE_BODY', events: [] };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, reason: 'INVALID_JSON', events: [] };
  }
  if (!Array.isArray(parsed)) return { ok: false, reason: 'NOT_AN_ARRAY', events: [] };
  return { ok: true, events: parsed };
}

/**
 * Classify one event: is it suppression, funnel, or neither?
 *
 * Mapping (verified against the Event Webhook Reference):
 *   bounce + type 'bounce'   -> hard bounce, permanent denial  -> SUPPRESS
 *   bounce + type 'blocked'  -> temporary denial               -> SUPPRESS (soft)
 *   dropped                  -> SendGrid refused to send it    -> SUPPRESS
 *   spamreport               -> complaint                      -> SUPPRESS
 *   unsubscribe / group_unsubscribe                            -> SUPPRESS
 *   processed/delivered/open/click/deferred/group_resubscribe  -> FUNNEL only
 */
function classifyEvent(evt) {
  if (!evt || typeof evt !== 'object') return { valid: false, reason: 'NOT_AN_OBJECT' };

  const email = normalizeEmail(evt.email);
  const eventType = typeof evt.event === 'string' ? evt.event.trim().toLowerCase() : '';
  const sgEventId = eventDocId(evt.sg_event_id);

  if (!email) return { valid: false, reason: 'NO_EMAIL' };
  if (!eventType) return { valid: false, reason: 'NO_EVENT_TYPE' };
  if (!sgEventId) return { valid: false, reason: 'NO_SG_EVENT_ID' };

  const bounceType = typeof evt.type === 'string' ? evt.type.trim().toLowerCase() : '';
  let suppression = null;

  if (SUPPRESSION_EVENTS.has(eventType)) {
    let reason = eventType;
    let severity = 'hard';
    if (eventType === 'bounce') {
      if (bounceType === 'blocked') { reason = 'blocked'; severity = 'soft'; }
      else { reason = 'hard_bounce'; }
    } else if (eventType === 'spamreport') {
      reason = 'spam_complaint';
    } else if (eventType === 'group_unsubscribe') {
      reason = 'unsubscribe';
    }
    suppression = {
      reason,
      severity,
      detail: typeof evt.reason === 'string' ? evt.reason.slice(0, 500) : null,
      classification: typeof evt.bounce_classification === 'string' ? evt.bounce_classification : null,
    };
  }

  return {
    valid: true,
    email,
    eventType,
    sgEventId,
    suppression,
    funnel: !suppression && FUNNEL_EVENTS.has(eventType),
  };
}

/**
 * The stored event record. PII discipline: email + event metadata only.
 * No categories, no unique args, no message body, no PHI.
 */
function buildEventRecord(evt, classified, receivedAtMs) {
  const tsSeconds = Number(evt.timestamp);
  return {
    email: classified.email,
    event: classified.eventType,
    sgEventId: classified.sgEventId,
    sgMessageId: typeof evt.sg_message_id === 'string' ? evt.sg_message_id : null,
    eventAtMs: Number.isFinite(tsSeconds) ? tsSeconds * 1000 : null,
    reason: typeof evt.reason === 'string' ? evt.reason.slice(0, 500) : null,
    status: typeof evt.status === 'string' ? evt.status : null,
    type: typeof evt.type === 'string' ? evt.type : null,
    bounceClassification: typeof evt.bounce_classification === 'string' ? evt.bounce_classification : null,
    suppressing: !!classified.suppression,
    funnel: !!classified.funnel,
    source: 'sendgrid_event_webhook',
    receivedAtMs,
  };
}

// The suppression row shape lives in the SHARED module so the D-407 reader and
// this writer cannot drift apart. Re-exported here for the receiver's callers.
const { buildSuppressionRow } = require('./suppression');

module.exports = {
  MAX_TIMESTAMP_SKEW_MS,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  SUPPRESSION_EVENTS,
  FUNNEL_EVENTS,
  normalizeEmail,
  eventDocId,
  verifyEventSignature,
  parseEventBatch,
  classifyEvent,
  buildEventRecord,
  buildSuppressionRow,
};
