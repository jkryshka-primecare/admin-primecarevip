// functions/backfillArtifactObjects.js
// Release 2b · Part B step 3 — COPY every artifact object from the legacy
// `<firebaseUid>/` prefix to the new `<internalUid>/` prefix.
//
// COPY, never move. Legacy objects are deleted only in a separate, explicitly
// approved cleanup, after `auditArtifactCoverage` reports 100% coverage under
// the new key AND the dual-read fallback has been removed.
//
// Admin-only, DRY RUN BY DEFAULT, bounded and resumable (`cursor` + `limit`).
// Storage-only: it never touches portalAccess, so a hidden item or a suspended
// patient stays unreadable. Bucket comes from the pinned config, never a caller.

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { log, logError } = require('./middleware/logger');
const { requireAdminCaller, selfAudience } = require('./middleware/requireAdminCaller');
const { artifactBucketName } = require('./core/config/artifactBucket');
const {
  makeInternalUidResolver,
  objectPathFor,
  legacyObjectPathFor,
} = require('./core/services/patient/internalUid');

const PAGE = 200;
const DEFAULT_LIMIT = 500;

function jsonError(res, status, code, reason, message) {
  return res.status(status).json({
    error: { code: status, status: code, message: message || reason, details: { reason } },
  });
}

async function run({ apply, limit, cursor }) {
  const db = admin.firestore();
  const bucket = admin.storage().bucket(artifactBucketName());
  const resolve = makeInternalUidResolver(db);

  const report = {
    scanned: 0, copied: 0, wouldCopy: 0, alreadyPresent: 0,
    noInternalUid: [], noLegacyObject: 0, failed: [], nextCursor: null, done: false,
  };

  // Cursors are full document paths (even segment count). Ignore any legacy
  // bare-id cursor rather than blowing up mid-run.
  let last =
    cursor && String(cursor).split('/').filter(Boolean).length % 2 === 0
      ? String(cursor)
      : null;

  let budget = limit || DEFAULT_LIMIT;

  while (budget > 0) {
    let q = db
      .collectionGroup('labs')
      .where('hasArtifact', '==', true)
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(PAGE);
    // Collection-group queries ordered by documentId() require a FULL document
    // path as the cursor — a bare doc id ("1040863151456296") has an odd number
    // of segments and Firestore rejects it. Track and pass ref.path.
    if (last) q = q.startAfter(db.doc(last));

    // eslint-disable-next-line no-await-in-loop
    const snap = await q.get();
    if (snap.empty) { report.done = true; break; }

    for (const doc of snap.docs) {
      if (budget <= 0) break;
      // Cursor tracks the last record ACTUALLY processed. Advancing it to the
      // end of the page up-front would skip every record after a mid-page
      // budget stop — those artifacts stay uncopied and only surface as 404s
      // once the legacy fallback is disabled.
      last = doc.ref.path;
      report.scanned += 1;
      const patientId = doc.ref.parent.parent ? doc.ref.parent.parent.id : null;
      // eslint-disable-next-line no-await-in-loop
      const { internalUid, legacyUid } = await resolve(patientId);
      if (!internalUid) {
        report.noInternalUid.push({ patientId, documentId: doc.id });
        continue;
      }
      const target = objectPathFor(internalUid, doc.id);
      const source = legacyObjectPathFor(legacyUid, doc.id);

      try {
        // eslint-disable-next-line no-await-in-loop
        const [targetExists] = await bucket.file(target).exists();
        if (targetExists) { report.alreadyPresent += 1; continue; }
        if (!source) { report.noLegacyObject += 1; continue; }
        // eslint-disable-next-line no-await-in-loop
        const [sourceExists] = await bucket.file(source).exists();
        if (!sourceExists) { report.noLegacyObject += 1; continue; }
        if (!apply) { report.wouldCopy += 1; budget -= 1; continue; }
        // eslint-disable-next-line no-await-in-loop
        await bucket.file(source).copy(bucket.file(target));
        report.copied += 1;
        budget -= 1;
      } catch (e) {
        report.failed.push({ patientId, documentId: doc.id, reason: e.message });
      }
    }

    if (snap.size < PAGE) { report.done = true; break; }
  }

  report.nextCursor = report.done ? null : last;
  return report;
}

exports.backfillArtifactObjects = functions
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .https.onRequest(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
      res.set('Allow', 'POST');
      return jsonError(res, 405, 'FAILED_PRECONDITION', 'METHOD_NOT_ALLOWED');
    }

    const gate = await requireAdminCaller(req, selfAudience(req, 'backfillArtifactObjects'));
    if (!gate.ok) return jsonError(res, gate.status, 'PERMISSION_DENIED', gate.reason);

    let body;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    } catch (e) {
      return jsonError(res, 400, 'INVALID_ARGUMENT', 'MALFORMED_BODY');
    }

    try {
      const report = await run({
        apply: body.apply === true,
        limit: Number(body.limit) > 0 ? Math.floor(Number(body.limit)) : DEFAULT_LIMIT,
        cursor: body.cursor ? String(body.cursor) : null,
      });
      log('backfillArtifactObjects', body.apply === true ? 'applied' : 'dry-run', {
        scanned: report.scanned, copied: report.copied, failed: report.failed.length,
      });
      return res.status(200).json({ apply: body.apply === true, ...report });
    } catch (e) {
      logError('backfillArtifactObjects', e);
      return jsonError(res, 500, 'INTERNAL', 'BACKFILL_FAILED', e.message);
    }
  });

exports._run = run;
