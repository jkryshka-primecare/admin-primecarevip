// functions/ingestElationReports.js
// #233 — Scheduled poller: drains Elation `published_events`, re-fetches each
// changed report, resolves its patient, and stores a category-tagged doc at
// patients/{elationPatientId}/labs/{reportId}. First scheduled (GEN_2) function
// in this repo. See D-077 (mechanism + active filter), D-078 (subscription 121290),
// D-079 (this PR: feed-record-vs-webhook-body schema correction + A–E locks).
//
// LOCKED DECISIONS (do not re-decide here):
//   A  Watermark = feed record `id` (monotonic int). Client-side filter id > checkpoint.
//      NO PATCH to Elation. `processed_date` is Elation's delivery timestamp, NEVER our
//      watermark. 30-day feed retention makes a missed run replay-safe.
//   B  Re-fetch /reports/{resource_id}/ to learn the patient — the feed record carries
//      no patient id (confirmed live, session2). Same object getLabs reads.
//   C  Ingest ALL report types, category-aware (not Lab-only).
//   D-1 event_type 'deleted' (or a re-fetch showing deleted_date) -> HARD-DELETE the
//      cached doc (docRef.delete()). Store is a CACHE, Elation = system of record
//      (D-107, supersedes the tombstone posture of D-079). A 404 re-fetch also
//      hard-deletes, resolving the owner via the write-once reportIndex.
//   E  Category map (below). Unknown/new type -> medical_records/misc + unmappedType:true.
//   Active-member filter (D-077): store only if patients/{id}.membershipStatus === 'active';
//      otherwise skip + log and STILL advance the watermark (replay-safe).
//   D-068 containment: pre-go-live, ingest ONLY allowlisted ids (ELATION_READ_ALLOWLIST,
//      currently test patient 816). Same list the reads use; self-retires at go-live
//      (ELATION_FULL_SYNC_ENABLED). Keeps real-patient PHI out of the build env.
//   Confidential filtering: enforced ELATION-SIDE (D-077, MK clinical authority).
//      No confidential-drop step in this poller.
//   phi_access_log (D-077): one entry PER ingest read, written AFTER the re-fetch
//      (patient known) and BEFORE the Firestore write. Fail-fast — a failed audit
//      write blocks that record's store and stops the run without advancing past it.
//      System actor: uid 'system:ingestElationReports', role 'system'.
//
// Checkpoint doc: sync_state/elationReportPoller { lastFeedId, lastRunAt, lastRunStats }.
// Schedule: 07:00, 13:00, 19:00 America/New_York.
// Secrets: ELATION_CLIENT_ID, ELATION_CLIENT_SECRET (v2 defineSecret; injected into
//   process.env at runtime, which the shared Elation client reads).
//
// The feed drain now lives in ./core/services/elation/ingest/feed.js
// (drainPublishedEvents), shared with the letters poller (#321, B3). This poller
// drains all resources then filters resource === 'reports' at the call site.

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { elationGet } = require('./core/services/elation/client');
const { log, logError } = require('./middleware/logger');
const {
  mapCategory,
  isIngestAllowed,
  buildStoredPayload,
} = require('./core/services/elation/ingest/reportIngest');
const { drainPublishedEvents } = require('./core/services/elation/ingest/feed');
const { deleteCachedRecordByIndex } = require('./core/services/elation/ingest/cacheDelete');

const ELATION_CLIENT_ID = defineSecret('ELATION_CLIENT_ID');
const ELATION_CLIENT_SECRET = defineSecret('ELATION_CLIENT_SECRET');

const CHECKPOINT_PATH = 'sync_state/elationReportPoller';

// Process one feed record. Returns normally when the watermark should ADVANCE
// (success OR benign skip). THROWS when the run must STOP without advancing past
// this record (transient re-fetch error, audit-write failure, store failure).
async function processRecord(db, rec, counters) {
  if (rec.resource !== 'reports') { counters.skippedOther += 1; return; }

  const reportId = String(rec.resource_id);
  const eventType = rec.event_type;

  // B — re-fetch to learn the patient (this is the PHI read).
  let report;
  try {
    report = await elationGet('/reports/' + reportId + '/');
  } catch (err) {
    if (err && err.reason === 'ELATION_NOT_FOUND') {
      // Hard-deleted in Elation. Our store is a CACHE (Elation = system of record,
      // D-107) — resolve the owner via the write-once reportIndex and HARD-delete our
      // cached copy. Index miss = never stored = log-and-advance. An audit-write
      // failure inside the helper THROWS and blocks the watermark (retry next run).
      counters.notFound += 1;
      log('ingestElationReports', 'report-not-found', { reportId, feedId: Number(rec.id) });
      await deleteCachedRecordByIndex(db, {
        indexCollection: 'reportIndex',
        subcollection: 'labs',
        id: reportId,
        idField: 'reportId',
        auditAction: 'report_ingest_deleted',
        actorUid: 'system:ingestElationReports',
        feedId: Number(rec.id),
        log,
        source: 'ingestElationReports',
      });
      return; // advance
    }
    throw err; // transient (timeout/5xx/network) -> blocking, retry next run
  }

  const patient = report && report.patient != null ? String(report.patient) : null;
  if (!patient) {
    counters.skippedNoPatient += 1;
    log('ingestElationReports', 'no-patient-on-report', { reportId, feedId: Number(rec.id) });
    return; // advance
  }

  // D-068 pre-go-live containment gate — mirrors the read side. Placed before the
  // patients lookup and before the audit write: a non-allowlisted event never
  // touches Firestore or the audit log. The report body was transiently re-fetched
  // (unavoidable — the feed carries no patient id, so the patient is only knowable
  // after the fetch), but it is dropped here and never stored.
  if (!isIngestAllowed(patient)) {
    counters.skippedNotAllowlisted += 1;
    log('ingestElationReports', 'skip-not-allowlisted', { reportId, elationPatientId: patient, feedId: Number(rec.id) });
    return; // advance (replay-safe; resurfaced post-go-live if a later event fires)
  }

  // D-111 active-member gate: store only for a claimed patient (status === 'active',
  // the claim-lifecycle field). membershipStatus is billing-only, NOT this gate.
  const pSnap = await db.collection('patients').doc(patient).get();
  if (!pSnap.exists || (pSnap.data() || {}).status !== 'active') {
    counters.skippedNonActive += 1;
    log('ingestElationReports', 'skip-non-active', { reportId, elationPatientId: patient, feedId: Number(rec.id) });
    return; // advance (replay-safe; resurfaced if they activate + a later event fires)
  }

  const isDeleted = eventType === 'deleted' || !!report.deleted_date;

  // phi_access_log FAIL-FAST — after re-fetch (patient known), before the store.
  // A throw here is blocking: no store, no advance.
  await db.collection('phi_access_log').add({
    uid: 'system:ingestElationReports',
    role: 'system',
    action: isDeleted ? 'report_ingest_deleted' : 'report_ingested',
    elationPatientId: patient,
    reportId,
    reportType: report.report_type ?? null,
    feedId: Number(rec.id),
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });

  const { category, subCategory, unmappedType } = mapCategory(report.report_type);

  // #317 Records deferral (MVP): store only lab + imaging. medical_records is pulled
  // (unavoidable — patient id is only knowable after the re-fetch, decision B) and
  // audit-logged above, but NOT stored unless explicitly re-enabled. Flip
  // ELATION_STORE_MEDICAL_RECORDS='true' + run backfillElationReports to populate history.
  if (category === 'medical_records' && process.env.ELATION_STORE_MEDICAL_RECORDS !== 'true') {
    counters.skippedRecordsDeferred += 1;
    log('ingestElationReports', 'skip-records-deferred', { reportId, elationPatientId: patient, feedId: Number(rec.id) });
    return; // advance (replay-safe; resurfaced on backfill when re-enabled)
  }

  const docRef = db.collection('patients').doc(patient).collection('labs').doc(reportId);

  if (isDeleted) {
    // HARD-delete (D-107) — cache carries no retention role. No-op if already gone.
    await docRef.delete();
    counters.deleted += 1;
  } else {
    // Write-once reverse index (id -> patient) so a later 404 can resolve the owner
    // after the object is gone from Elation. Zero PHI; idempotent set.
    await db.collection('reportIndex').doc(reportId).set({ patient });

    const payload = buildStoredPayload(report, category);
    await docRef.set({
      ...payload,
      reportId,
      category,
      subCategory,
      reportType: report.report_type ?? null,
      unmappedType,
      deleted: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: false }); // overwrite with current Elation truth (handles corrections + un-delete)
    counters.stored += 1;
  }
}

exports.ingestElationReports = onSchedule(
  {
    schedule: '0 7,13,19 * * *',
    timeZone: 'America/New_York',
    secrets: [ELATION_CLIENT_ID, ELATION_CLIENT_SECRET],
    region: 'us-central1',
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    const db = admin.firestore();
    const cpRef = db.doc(CHECKPOINT_PATH);

    const cpSnap = await cpRef.get();
    const lastFeedId = cpSnap.exists ? Number((cpSnap.data() || {}).lastFeedId || 0) : 0;

    const counters = {
      scanned: 0, stored: 0, deleted: 0,
      skippedNonActive: 0, skippedNotAllowlisted: 0, skippedNoPatient: 0, skippedOther: 0, notFound: 0,
      skippedRecordsDeferred: 0,
    };

    let feed;
    try {
      const all = await drainPublishedEvents(lastFeedId);
      feed = all.filter((r) => r && r.resource === 'reports'); // reports poller handles only reports
    } catch (err) {
      logError('ingestElationReports', 'feed-drain-failed', err, { lastFeedId });
      throw err; // no advance; next run retries from the same checkpoint
    }

    let highWater = lastFeedId;
    let blockingError = null;

    for (const rec of feed) {
      counters.scanned += 1;
      try {
        await processRecord(db, rec, counters);
        highWater = Number(rec.id); // advance only after a success or benign skip
      } catch (err) {
        blockingError = err; // stop; do NOT advance past this record
        logError('ingestElationReports', 'record-failed', err, {
          reportId: String(rec.resource_id), feedId: Number(rec.id),
        });
        break;
      }
    }

    // Persist checkpoint over successfully-processed records even if we stopped early.
    await cpRef.set({
      lastFeedId: highWater,
      lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
      lastRunStats: counters,
    }, { merge: true });

    log('ingestElationReports', blockingError ? 'run-stopped-early' : 'run-complete', {
      lastFeedId, highWater, ...counters,
    });

    // Surface a blocking failure so the run is marked failed (watermark still advanced
    // over the successes above; the failed record retries next scheduled run).
    if (blockingError) throw blockingError;
  },
);
