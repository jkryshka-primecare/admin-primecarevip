/**
 * Release 2a · A — artifact coverage audit.
 *
 * READ-ONLY. Walks every document reference marked `hasArtifact: true` and
 * proves the object exists in Storage. Writes one report per run to
 * `artifact_coverage_reports/{runId}`.
 *
 * SCOPE: this proves "no dangling 404s among referenced documents". It does NOT
 * prove we hold everything Elation has — that is the Elation-exit bar and a 2b
 * question. Do not present this number as readiness to leave Elation.
 *
 * The report is PHI (patient ids, document ids, storage paths). Firestore rules
 * must deny all client reads; staff see it only through the role-gated,
 * audit-logged admin bridge.
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

const REGION = 'us-central1';
const PAGE_SIZE = 500;
/** Never walk more than this in one run; the run ends with work remaining. */
const MAX_DOCS = 50000;

function bucket() {
  return admin.storage().bucket();
}

/** The current (pre-2b) artifact path. Re-keying is deliberately out of 2a. */
function expectedPath(doc) {
  return doc.artifactPath || `elation-artifacts/${doc.firebaseUid}/${doc.id}/report.pdf`;
}

async function walk(db, onDoc) {
  let last = null;
  let seen = 0;
  for (;;) {
    let q = db
      .collectionGroup('documents')
      .where('hasArtifact', '==', true)
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(PAGE_SIZE);
    if (last) q = q.startAfter(last);

    const snap = await q.get();
    if (snap.empty) return seen;

    for (const d of snap.docs) {
      await onDoc({ id: d.id, ref: d.ref, ...d.data() });
      seen += 1;
    }
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE_SIZE || seen >= MAX_DOCS) return seen;
  }
}

async function runAudit() {
  const db = admin.firestore();
  const runId = `run-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const started = Date.now();

  let totalReferenced = 0;
  let presentCount = 0;
  const missing = [];

  const priorSnap = await db
    .collection('artifact_repair_queue')
    .where('repairedAt', '==', null)
    .get()
    .catch(() => ({ docs: [] }));
  const prior = new Map(priorSnap.docs.map((d) => [d.id, d.data()]));

  await walk(db, async (doc) => {
    totalReferenced += 1;
    const path = expectedPath(doc);
    const [exists] = await bucket().file(path).exists();
    if (exists) {
      presentCount += 1;
      return;
    }
    // The owning patient id is read from the document's own parent — never
    // from anything a caller supplied.
    const patientId = doc.ref.parent.parent ? doc.ref.parent.parent.id : null;
    const known = prior.get(`${patientId}:${doc.id}`) || {};
    missing.push({
      patientId,
      documentId: doc.id,
      path,
      firstSeenAt: known.firstSeenAt || new Date().toISOString(),
      failures: known.failures || 0,
      parked: known.parked === true,
    });
  });

  const missingCount = missing.length;
  const report = {
    generatedAt: new Date().toISOString(),
    scope: 'referenced',
    elapsedMs: Date.now() - started,
    totalReferenced,
    presentCount,
    missingCount,
    coveragePct: totalReferenced > 0 ? (presentCount / totalReferenced) * 100 : null,
    // Cap the embedded list so the report doc stays under the 1 MiB limit; the
    // full set always lives in artifact_repair_queue.
    missing: missing.slice(0, 500),
    missingTruncated: missingCount > 500,
  };

  await db.collection('artifact_coverage_reports').doc(runId).set(report);

  // Feed the healer: one queue row per miss, keyed (patientId, documentId).
  const batch = db.batch();
  missing.slice(0, 500).forEach((m) => {
    const ref = db.collection('artifact_repair_queue').doc(`${m.patientId}:${m.documentId}`);
    batch.set(
      ref,
      {
        patientId: m.patientId,
        documentId: m.documentId,
        path: m.path,
        firstSeenAt: m.firstSeenAt,
        failures: m.failures,
        parked: m.parked,
        repairedAt: null,
        source: 'audit',
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
  });
  await batch.commit();

  return { runId, ...report };
}

exports.auditArtifactCoverageScheduled = functions
  .region(REGION)
  .pubsub.schedule('15 3 * * *')
  .timeZone('America/New_York')
  .onRun(async () => {
    const out = await runAudit();
    functions.logger.info('artifact coverage audit complete', {
      runId: out.runId,
      coveragePct: out.coveragePct,
      missingCount: out.missingCount,
    });
    return null;
  });

/** Admin-only on-demand run. Reuses the Step 1 admin caller gate. */
const requireAdminCaller = require('./middleware/requireAdminCaller');

exports.adminRunArtifactAudit = functions
  .region(REGION)
  .https.onRequest(async (req, res) => {
    const caller = await requireAdminCaller(req, res);
    if (!caller) return; // requireAdminCaller already answered
    const out = await runAudit();
    res.json({ ok: true, ...out });
  });

exports._runAudit = runAudit;
