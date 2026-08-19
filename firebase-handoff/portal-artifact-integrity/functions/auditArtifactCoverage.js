/**
 * Release 2a · A — artifact coverage audit.
 *
 * READ-ONLY. Walks every artifact-bearing reference in the patients' `labs`
 * subcollection group (`hasArtifact: true`) — the SAME collection the shared
 * read handler and the poller (`ingestElationReports`) use; `documents` does not
 * exist in production — and
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
 *
 * DEPLOY NOTE (review item 1): `adminRunArtifactAudit` is an HTTP admin
 * function. It MUST be listed in `lock-admin-invokers.yml`'s ADMIN_FUNCTIONS,
 * excluded from both health-gate FUNCTIONS arrays in deploy-production.yml
 * (IAM-restricted, so an anonymous probe gets 403), and exported INSIDE
 * `module.exports` in index.js. The two scheduled functions are pub/sub and
 * need none of that.
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

const REGION = 'us-central1';
const PAGE_SIZE = 500;
/** Storage existence checks run in bounded parallel chunks, not one-by-one. */
const EXISTS_CONCURRENCY = 50;
/** Never walk more than this in one run; the run ends with work remaining. */
const MAX_DOCS = 50000;

function bucket() {
  return admin.storage().bucket();
}

/**
 * The current (pre-2b) artifact path. Re-keying is deliberately out of 2a.
 *
 * Review item 4: a doc with neither `artifactPath` nor `firebaseUid` used to
 * resolve to a literal `elation-artifacts/null/...` path — a false miss that
 * the sweep would then "heal" by writing junk at `null/`. Such docs are now
 * classified `unpathed` instead: reported separately, never queued for repair.
 */
function expectedPath(doc) {
  if (doc.artifactPath) return doc.artifactPath;
  if (!doc.firebaseUid) return null;
  return `elation-artifacts/${doc.firebaseUid}/${doc.id}/report.pdf`;
}

async function walk(db, onPage) {
  let last = null;
  let seen = 0;
  for (;;) {
    let q = db
      .collectionGroup('labs')
      .where('hasArtifact', '==', true)
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(PAGE_SIZE);
    if (last) q = q.startAfter(last);

    const snap = await q.get();
    if (snap.empty) return { seen, truncated: false };

    await onPage(snap.docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() })));
    seen += snap.size;
    last = snap.docs[snap.docs.length - 1];

    if (seen >= MAX_DOCS) return { seen, truncated: true };
    if (snap.size < PAGE_SIZE) return { seen, truncated: false };
  }
}

async function chunkedExists(paths) {
  const out = [];
  for (let i = 0; i < paths.length; i += EXISTS_CONCURRENCY) {
    const slice = paths.slice(i, i + EXISTS_CONCURRENCY);
    // eslint-disable-next-line no-await-in-loop
    const results = await Promise.all(
      slice.map((p) => bucket().file(p).exists().then(([e]) => e).catch(() => false)),
    );
    out.push(...results);
  }
  return out;
}

async function runAudit() {
  const db = admin.firestore();
  const runId = `run-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const started = Date.now();

  let totalReferenced = 0;
  let presentCount = 0;
  const missing = [];
  const unpathed = [];

  const priorSnap = await db
    .collection('artifact_repair_queue')
    .where('repairedAt', '==', null)
    .get()
    .catch(() => ({ docs: [] }));
  const prior = new Map(priorSnap.docs.map((d) => [d.id, d.data()]));

  const { seen, truncated } = await walk(db, async (docs) => {
    totalReferenced += docs.length;

    const pathed = [];
    for (const doc of docs) {
      // The owning patient id is read from the document's own parent — never
      // from anything a caller supplied.
      const patientId = doc.ref.parent.parent ? doc.ref.parent.parent.id : null;
      const path = expectedPath(doc);
      if (!path) {
        unpathed.push({ patientId, documentId: doc.id, reason: 'no artifactPath and no firebaseUid' });
        continue;
      }
      pathed.push({ patientId, documentId: doc.id, path });
    }

    const exists = await chunkedExists(pathed.map((p) => p.path));
    pathed.forEach((p, i) => {
      if (exists[i]) {
        presentCount += 1;
        return;
      }
      const known = prior.get(`${p.patientId}:${p.documentId}`) || {};
      missing.push({
        ...p,
        firstSeenAt: known.firstSeenAt || new Date().toISOString(),
        failures: known.failures || 0,
        parked: known.parked === true,
      });
    });
  });

  const missingCount = missing.length;
  const checked = presentCount + missingCount;
  const report = {
    generatedAt: new Date().toISOString(),
    scope: 'referenced',
    elapsedMs: Date.now() - started,
    walked: seen,
    // A partial walk can never be read as complete coverage.
    truncatedWalk: truncated,
    totalReferenced,
    presentCount,
    missingCount,
    // Referenced docs we cannot even key yet — excluded from the percentage and
    // never queued. They are a data-quality item, not a storage miss.
    unpathedCount: unpathed.length,
    unpathed: unpathed.slice(0, 500),
    coveragePct: checked > 0 ? (presentCount / checked) * 100 : null,
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
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .pubsub.schedule('15 3 * * *')
  .timeZone('America/New_York')
  .onRun(async () => {
    const out = await runAudit();
    functions.logger.info('artifact coverage audit complete', {
      runId: out.runId,
      coveragePct: out.coveragePct,
      missingCount: out.missingCount,
      truncatedWalk: out.truncatedWalk,
    });
    return null;
  });

/**
 * On-demand walk, executed in a DURABLE context.
 *
 * An HTTP (1st-gen) function's instance is CPU-throttled/reclaimed the moment
 * the response is sent, so a fire-and-forget `runAudit()` after `res.json()`
 * never finishes and never writes the report (it does not even reach `.catch`).
 * Pub/Sub functions, by contrast, stay alive until the returned promise
 * settles — so the on-demand path publishes to this topic and the walk runs
 * here, on exactly the same code path as the schedule.
 */
const AUDIT_TOPIC = 'artifact-coverage-audit';

exports.auditArtifactCoverageOnDemand = functions
  .region(REGION)
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .pubsub.topic(AUDIT_TOPIC)
  .onPublish(async (message) => {
    const attrs = (message && message.attributes) || {};
    const out = await runAudit();
    functions.logger.info('on-demand artifact coverage audit complete', {
      requestedBy: attrs.requestedBy || null,
      runId: out.runId,
      coveragePct: out.coveragePct,
      missingCount: out.missingCount,
      truncatedWalk: out.truncatedWalk,
    });
    return null;
  });

/**
 * Admin-only on-demand trigger. Reuses the Step 1 admin caller gate.
 *
 * Publishes to `AUDIT_TOPIC` and answers 202; the caller polls
 * `artifact_coverage_reports` (latest by generatedAt). No work is performed
 * after the response is sent.
 *
 * DEPLOY NOTE: requires `@google-cloud/pubsub` in functions/package.json and
 * the runtime SA to hold `roles/pubsub.publisher` on the topic (the default
 * App Engine / compute SA does within its own project). The topic is created
 * automatically by the `auditArtifactCoverageOnDemand` deploy.
 */
const { PubSub } = require('@google-cloud/pubsub');
const { requireAdminCaller, selfAudience } = require('./middleware/requireAdminCaller');

let pubsubClient = null;
function topic() {
  if (!pubsubClient) pubsubClient = new PubSub();
  return pubsubClient.topic(AUDIT_TOPIC);
}

exports.adminRunArtifactAudit = functions
  .region(REGION)
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .https.onRequest(async (req, res) => {
    // Same pattern as the five Step 1 admin functions: the gate returns a
    // result object and never writes the response — inspect `.ok` yourself.
    const gate = await requireAdminCaller(req, selfAudience(req, 'adminRunArtifactAudit'));
    if (!gate.ok) {
      functions.logger.warn('adminRunArtifactAudit caller-rejected', { reason: gate.reason });
      return res.status(gate.status).json({ ok: false, error: gate.reason });
    }

    try {
      const messageId = await topic().publishMessage({
        json: { trigger: 'on-demand', requestedAt: new Date().toISOString() },
        attributes: { requestedBy: String(gate.email || gate.uid || 'admin') },
      });
      functions.logger.info('artifact coverage audit requested', { messageId });
      return res.status(202).json({
        ok: true,
        started: true,
        messageId,
        poll: 'artifact_coverage_reports (latest by generatedAt)',
      });
    } catch (err) {
      functions.logger.error('failed to enqueue artifact coverage audit', err);
      return res.status(500).json({ ok: false, error: 'enqueue_failed' });
    }
  });

exports._runAudit = runAudit;
exports._AUDIT_TOPIC = AUDIT_TOPIC;

