// functions/backfillInternalUids.js
// Release 2b · Part B step 1 — mint an `internalUid` on every patient record.
//
// Admin-only, idempotent, DRY RUN BY DEFAULT (`apply: true` to write). Records
// that already carry an internalUid are left untouched — regenerating would
// orphan objects. Resumable: re-run until `remaining` is 0.
//
// Add to lock-admin-invokers.yml so the public allUsers binding is stripped.

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { log, logError } = require('./middleware/logger');
const { requireAdminCaller, selfAudience } = require('./middleware/requireAdminCaller');
const { ensureInternalUid, FIELD } = require('./core/services/patient/internalUid');

const PAGE = 300;

function jsonError(res, status, code, reason, message) {
  return res.status(status).json({
    error: { code: status, status: code, message: message || reason, details: { reason } },
  });
}

async function run({ apply, limit }) {
  const db = admin.firestore();
  const report = { scanned: 0, alreadyPresent: 0, minted: 0, wouldMint: 0, failed: [], remaining: 0 };
  let cursor = null;

  for (;;) {
    let q = db.collection('patients').orderBy(admin.firestore.FieldPath.documentId()).limit(PAGE);
    if (cursor) q = q.startAfter(cursor);
    // eslint-disable-next-line no-await-in-loop
    const snap = await q.get();
    if (snap.empty) break;
    cursor = snap.docs[snap.docs.length - 1].id;

    for (const doc of snap.docs) {
      report.scanned += 1;
      if (doc.get(FIELD)) {
        report.alreadyPresent += 1;
        continue;
      }
      if (!apply) {
        report.wouldMint += 1;
        continue;
      }
      if (limit && report.minted >= limit) {
        report.remaining += 1;
        continue;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        const out = await ensureInternalUid(doc.id, db);
        if (out.minted) report.minted += 1;
        else if (out.internalUid) report.alreadyPresent += 1;
        else report.failed.push({ patientId: doc.id, reason: out.reason || 'UNKNOWN' });
      } catch (e) {
        report.failed.push({ patientId: doc.id, reason: e.message });
      }
    }

    if (snap.size < PAGE) break;
  }

  return report;
}

exports.backfillInternalUids = functions
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .https.onRequest(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
      res.set('Allow', 'POST');
      return jsonError(res, 405, 'FAILED_PRECONDITION', 'METHOD_NOT_ALLOWED');
    }

    const gate = await requireAdminCaller(req, selfAudience(req, 'backfillInternalUids'));
    if (!gate.ok) return jsonError(res, gate.status, 'PERMISSION_DENIED', gate.reason);

    let body;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    } catch (e) {
      return jsonError(res, 400, 'INVALID_ARGUMENT', 'MALFORMED_BODY');
    }

    const apply = body.apply === true;
    const limit = Number(body.limit) > 0 ? Math.floor(Number(body.limit)) : 0;

    try {
      const report = await run({ apply, limit });
      log('backfillInternalUids', apply ? 'applied' : 'dry-run', {
        scanned: report.scanned, minted: report.minted, failed: report.failed.length,
      });
      return res.status(200).json({ apply, ...report });
    } catch (e) {
      logError('backfillInternalUids', e);
      return jsonError(res, 500, 'INTERNAL', 'BACKFILL_FAILED', e.message);
    }
  });

exports._run = run;
