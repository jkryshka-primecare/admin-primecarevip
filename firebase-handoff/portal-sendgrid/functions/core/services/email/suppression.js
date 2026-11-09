// functions/core/services/email/suppression.js
// SHARED SUPPRESSION SOURCE — the single definition of the `emailSuppression`
// collection, owned by neither side of the pair that uses it:
//
//   WRITER  #362 / D-408  sendgridEventWebhook  -> buildSuppressionRow/applySuppression
//   READER  #496 Phase 2 / D-407  autoInviteTick -> loadSuppressedEmails
//
// Both import this module, so the shape cannot drift: one collection name, one
// normalization rule, one doc-id rule. That is also what lets the receiver
// (#362) ship and deploy on its own while the autosender (#558) stays parked —
// the reader has no dependency on the writer, only on this contract.
//
// Keyed by ADDRESS, never per-practice: a hard bounce is a hard bounce
// everywhere. PII discipline: email + event metadata only, never PHI.

const SUPPRESSION_COLLECTION = 'emailSuppression';

function normalizeEmail(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

/**
 * The suppression row. Doc id = normalized email, and the `email` field is
 * present and normalized too, so a reader can key off either.
 */
function buildSuppressionRow(classified, record, nowMs) {
  return {
    email: normalizeEmail(classified.email),
    reason: classified.suppression.reason,
    severity: classified.suppression.severity,
    detail: classified.suppression.detail,
    classification: classified.suppression.classification,
    lastEvent: classified.eventType,
    lastSgEventId: classified.sgEventId,
    lastSgMessageId: record.sgMessageId,
    source: 'sendgrid_event_webhook',
    suppressedAtMs: nowMs,
  };
}

/**
 * WRITE PATH. Upsert one suppression row transactionally.
 * `firstSuppressedAtMs` is set once and never moves — it is the audit anchor;
 * the latest event detail wins on every other field.
 */
async function applySuppression(db, classified, record, nowMs) {
  return db.runTransaction((tx) => writeSuppressionInTransaction(db, tx, classified, record, nowMs));
}

/** Shared writer for the receiver's atomic event + suppression transaction. */
async function writeSuppressionInTransaction(db, tx, classified, record, nowMs) {
  const email = normalizeEmail(classified.email);
  if (!email) return false;
  const ref = db.collection(SUPPRESSION_COLLECTION).doc(email);
  const row = buildSuppressionRow(classified, record, nowMs);
  const snap = await tx.get(ref);
  const existing = (snap && snap.exists && snap.data()) || {};
  const firstSuppressedAtMs = Number.isFinite(existing.firstSuppressedAtMs)
    ? existing.firstSuppressedAtMs
    : nowMs;
  tx.set(ref, { ...row, firstSuppressedAtMs }, { merge: true });
  return true;
}

/**
 * READ PATH. Every suppressed address, normalized.
 * FAILS CLOSED FOR THE CALLER: `ok:false` means the source could not be read,
 * and a sender must treat unknown as unsafe and abort rather than send.
 *
 * @returns {Promise<{emails: Set<string>, ok: boolean}>}
 */
async function loadSuppressedEmails(db, onError) {
  try {
    const snap = await db.collection(SUPPRESSION_COLLECTION).get();
    const set = new Set();
    snap.forEach((d) => {
      const row = d.data() || {};
      const email = normalizeEmail(row.email || d.id);
      if (email) set.add(email);
    });
    return { emails: set, ok: true };
  } catch (e) {
    if (typeof onError === 'function') onError(e);
    return { emails: new Set(), ok: false };
  }
}

module.exports = {
  SUPPRESSION_COLLECTION,
  normalizeEmail,
  buildSuppressionRow,
  applySuppression,
  writeSuppressionInTransaction,
  loadSuppressedEmails,
};
