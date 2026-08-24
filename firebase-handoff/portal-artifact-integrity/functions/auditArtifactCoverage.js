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
 * `module.exports` in index.js. The scheduled and topic functions
 * (`auditArtifactCoverageScheduled`, `auditArtifactCoverageOnDemand`) are
 * pub/sub and need none of that, but both must be exported in index.js.

 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { artifactBucketName } = require('./core/config/artifactBucket');
const {
  makeInternalUidResolver,
  objectPathFor: internalPathFor,
  legacyObjectPathFor: legacyPathFor,
  legacyFallbackEnabled,
} = require('./core/services/patient/internalUid');

const REGION = 'us-central1';
const PAGE_SIZE = 500;
/** Storage existence checks run in bounded parallel chunks, not one-by-one. */
const EXISTS_CONCURRENCY = 50;
/** Never walk more than this in one run; the run ends with work remaining. */
const MAX_DOCS = 50000;

/**
 * The live read-path smoke (`adminRunReadPathSmoke`) depends on a reference
 * that deliberately has NO object behind it — `SMOKE-LAB-2` — to prove case 2
 * ("missing object answers a calm `preparing` state"). It must therefore keep
 * existing with `hasArtifact: true`, and it can never be "repaired".
 *
 * Left in the denominator it is a permanent miss: it burns its repair budget,
 * parks, and then alerts forever, putting a floor under coverage and making the
 * alerting count meaningless. Fixture references are excluded from the
 * percentage, never queued, and reported on their own line instead.
 */
const FIXTURE_DOC_ID_PREFIX = 'SMOKE-';

function isFixtureReference(documentId) {
  return String(documentId || '').startsWith(FIXTURE_DOC_ID_PREFIX);
}

function bucket() {
  // Never bare: the default bucket is not where artifacts live (see config).
  return admin.storage().bucket(artifactBucketName());
}

/**
 * The artifact path, Release 2b Part B: keyed on the RECORD's `internalUid`,
 * never on a Firebase Auth uid. Minors have no auth uid at all, so the old
 * uid-keyed scheme could not express a dependent's artifact.
 *
 * During the dual-read window a record with no `internalUid` yet falls back to
 * the legacy `firebaseUid`; a record with neither stays `unpathed` — reported
 * separately, never queued, so the sweep can never "heal" junk at
 * `elation-artifacts/null/...`. Coverage must reach 100% with the fallback
 * DISABLED (`ARTIFACT_LEGACY_UID_FALLBACK=false`) before the legacy branch is
 * deleted from the read path.
 */
function expectedPath(doc, keys) {
  if (doc.artifactPath) return doc.artifactPath;
  const k = keys || {};
  if (k.internalUid) return internalPathFor(k.internalUid, doc.id);
  if (legacyFallbackEnabled() && k.legacyUid) return legacyPathFor(k.legacyUid, doc.id);
  return null;
}

/** patientId -> { internalUid, legacyUid }. One patient doc read per patient. */
function makeUidResolver(db) {
  return makeInternalUidResolver(db);
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

/**
 * Existence probe that NEVER conflates "couldn't check" with "absent".
 *
 * A swallowed error here is how a project-wide `storage.objects.get` denial
 * (403) was reported to us as a tidy, false "0% coverage" with a clean log.
 * Each path now resolves to 'present' | 'absent' | { error }, and a systemic
 * error rate fails the run loudly instead of queueing 1,341 bogus repairs.
 */
async function chunkedExists(paths) {
  const out = [];
  for (let i = 0; i < paths.length; i += EXISTS_CONCURRENCY) {
    const slice = paths.slice(i, i + EXISTS_CONCURRENCY);
    // eslint-disable-next-line no-await-in-loop
    const results = await Promise.all(
      slice.map((p) => bucket().file(p).exists()
        .then(([e]) => (e ? { state: 'present' } : { state: 'absent' }))
        .catch((err) => ({
          state: 'error',
          status: err && (err.code || err.status) ? Number(err.code || err.status) : null,
          message: err && err.message ? String(err.message).slice(0, 300) : 'unknown storage error',
        }))),
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
  const errored = [];
  const errorStatusCounts = {};
  // Release 2b Part B: adult and minor are reported SEPARATELY. A single
  // rounded "100%" must never be able to hide a cohort the minor-ingest track
  // never populated.
  const splits = {
    adult: { referenced: 0, present: 0, missing: 0, unpathed: 0, errored: 0 },
    minor: { referenced: 0, present: 0, missing: 0, unpathed: 0, errored: 0 },
  };
  // Minor sub-split on readability, not on age: `chartBacked` = >= 1 ACTIVE
  // guardian with a guardianElationId (phase-1 readable); `emailOnFile` = the
  // rest (guardians cannot read until phase 2). Reported so the 40 email-only
  // children are a visible line, never a hidden gap inside a rounded 100%.
  const minorLinkage = {
    chartBacked: { referenced: 0, present: 0, missing: 0, unpathed: 0, errored: 0 },
    emailOnFile: { referenced: 0, present: 0, missing: 0, unpathed: 0, errored: 0 },
  };
  const bump = (cohort, field, chartBacked) => {
    const minor = cohort === 'minor';
    splits[minor ? 'minor' : 'adult'][field] += 1;
    if (minor) minorLinkage[chartBacked ? 'chartBacked' : 'emailOnFile'][field] += 1;
  };


  const priorSnap = await db
    .collection('artifact_repair_queue')
    .where('repairedAt', '==', null)
    .get()
    .catch(() => ({ docs: [] }));
  const prior = new Map(priorSnap.docs.map((d) => [d.id, d.data()]));
  const uidFor = makeUidResolver(db);

  const { seen, truncated } = await walk(db, async (docs) => {
    totalReferenced += docs.length;

    const pathed = [];
    for (const doc of docs) {
      // The owning patient id is read from the document's own parent — never
      // from anything a caller supplied.
      const patientId = doc.ref.parent.parent ? doc.ref.parent.parent.id : null;
      // eslint-disable-next-line no-await-in-loop
      const keys = await uidFor(patientId);
      const cohort = keys && keys.isMinor ? 'minor' : 'adult';
      const chartBacked = Boolean(keys && keys.chartBacked);
      bump(cohort, 'referenced', chartBacked);
      const path = expectedPath(doc, keys);
      if (!path) {
        bump(cohort, 'unpathed', chartBacked);
        unpathed.push({
          patientId,
          documentId: doc.id,
          cohort,
          chartBacked,
          reason: 'no artifactPath and patient has no internalUid (or legacy uid)',
        });
        continue;
      }
      pathed.push({ patientId, documentId: doc.id, path, cohort, chartBacked });
    }


    const probes = await chunkedExists(pathed.map((p) => p.path));
    pathed.forEach((p, i) => {
      const probe = probes[i] || { state: 'error', status: null, message: 'no probe result' };
      if (probe.state === 'present') {
        presentCount += 1;
        bump(p.cohort, 'present', p.chartBacked);
        return;
      }
      if (probe.state === 'error') {
        // "Couldn't check" is NOT "absent". Never queued for repair.
        const key = String(probe.status || 'unknown');
        errorStatusCounts[key] = (errorStatusCounts[key] || 0) + 1;
        bump(p.cohort, 'errored', p.chartBacked);
        errored.push({ ...p, status: probe.status, message: probe.message });
        return;
      }
      const known = prior.get(`${p.patientId}:${p.documentId}`) || {};
      bump(p.cohort, 'missing', p.chartBacked);
      missing.push({
        ...p,
        firstSeenAt: known.firstSeenAt || new Date().toISOString(),
        failures: known.failures || 0,
        parked: known.parked === true,
      });
    });
  });

  const missingCount = missing.length;
  const erroredCount = errored.length;
  const checked = presentCount + missingCount;
  const probed = checked + erroredCount;
  // A systemic storage failure (IAM denial, bucket gone) must fail the run, not
  // be laundered into a coverage number or a repair queue full of ghosts.
  const systemicStorageFailure = probed > 0 && erroredCount / probed >= 0.25;

  // Per-cohort coverage. `null` means "nothing referenced in this cohort" —
  // which for `minor` before the minor-ingest deploy is the EXPECTED value and
  // is NOT a pass. The Part B join gate requires both splits at 100 with a
  // non-zero denominator.
  const pct = (s) => {
    const c = s.present + s.missing;
    return systemicStorageFailure || c === 0 ? null : (s.present / c) * 100;
  };
  const bySegment = {
    adult: { ...splits.adult, coveragePct: pct(splits.adult) },
    minor: {
      ...splits.minor,
      coveragePct: pct(splits.minor),
      // Sub-split so "minor at 100%" can be read honestly: phase 1 ingests the
      // chart-backed set; `emailOnFile` is expected to be 0-denominator until
      // phase 2 and its `coveragePct: null` is not a pass, just not yet in scope.
      byLinkage: {
        chartBacked: { ...minorLinkage.chartBacked, coveragePct: pct(minorLinkage.chartBacked) },
        emailOnFile: { ...minorLinkage.emailOnFile, coveragePct: pct(minorLinkage.emailOnFile) },
      },
    },
  };

  const report = {
    generatedAt: new Date().toISOString(),
    scope: 'referenced',
    // Gate validity flag. With ARTIFACT_LEGACY_UID_FALLBACK ON, a legacy-path
    // object counts as present, so a routine nightly run can read 100% while
    // the uid-keyed path is still empty. Only a run with the fallback DISABLED
    // is a valid go/no-go input for GUARDIAN_READS_ENABLED.
    legacyFallbackDisabled: !legacyFallbackEnabled(),
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
    // Docs whose Storage probe FAILED (e.g. 403 storage.objects.get). Excluded
    // from the percentage and never queued.
    erroredCount,
    errorStatusCounts,
    errored: errored.slice(0, 200),
    systemicStorageFailure,
    status: systemicStorageFailure ? 'failed_storage_unreadable' : 'ok',
    coveragePct: systemicStorageFailure || checked === 0
      ? null
      : (presentCount / checked) * 100,
    // Cap the embedded list so the report doc stays under the 1 MiB limit; the
    // full set always lives in artifact_repair_queue.
    missing: missing.slice(0, 500),
    missingTruncated: missingCount > 500,
    bySegment,
  };

  await db.collection('artifact_coverage_reports').doc(runId).set(report);

  if (systemicStorageFailure) {
    functions.logger.error('artifact coverage audit: storage unreadable — refusing to queue repairs', {
      runId,
      erroredCount,
      errorStatusCounts,
      sample: errored.slice(0, 3).map((e) => ({ path: e.path, status: e.status, message: e.message })),
    });
    return { runId, ...report };
  }

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
      erroredCount: out.erroredCount,
      bySegment: out.bySegment,
      status: out.status,
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
      erroredCount: out.erroredCount,
      bySegment: out.bySegment,
      status: out.status,
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
 * DEPLOY NOTE: no new npm dependency. We publish over the Pub/Sub REST API with
 * `google-auth-library` (already installed transitively and used elsewhere),
 * so functions/package-lock.json is untouched. The runtime SA needs
 * `roles/pubsub.publisher` (the default App Engine SA has Editor in-project).
 * The topic is created automatically when `auditArtifactCoverageOnDemand`
 * deploys.
 */
const { GoogleAuth } = require('google-auth-library');
const { requireAdminCaller, selfAudience } = require('./middleware/requireAdminCaller');

let authClient = null;
async function publishAuditRequest(attributes, payload) {
  if (!authClient) {
    authClient = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  }
  const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || (await authClient.getProjectId());
  const client = await authClient.getClient();
  const url = `https://pubsub.googleapis.com/v1/projects/${projectId}/topics/${AUDIT_TOPIC}:publish`;
  const resp = await client.request({
    url,
    method: 'POST',
    data: {
      messages: [
        { data: Buffer.from(JSON.stringify(payload)).toString('base64'), attributes },
      ],
    },
  });
  return (resp.data.messageIds || [])[0] || null;
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
      const messageId = await publishAuditRequest(
        { requestedBy: String(gate.email || gate.uid || 'admin') },
        { trigger: 'on-demand', requestedAt: new Date().toISOString() },
      );
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

