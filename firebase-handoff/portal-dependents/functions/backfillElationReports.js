// functions/backfillElationReports.js
// #239 — One-time, re-runnable BACKFILL of existing/historical Elation reports.
// The delta poller (#233) only ingests events that land in `published_events`
// AFTER subscription 121290 went live (2026-07-04); it never sees pre-existing
// reports. This job establishes the BASELINE: for each supplied Elation patient id
// it pulls that patient's existing reports and stores them with the SAME logic the
// poller uses (shared reportIngest helpers). Together: poller keeps data current,
// backfill loads history. See D-079 (ingest locks) and D-080 (backfill soft-D-077).
//
// NOT a Firebase trigger. A plain exported function, invoked by a thin runner (D-072
// keyless Admin SDK flow, Doppler-supplied Elation secrets) — matches how one-off
// jobs already run. Not registered in index.js.
//
// LOCKED DECISIONS (see chat + DECISION-LOG):
//   Driver: caller supplies an array of Elation patient ids (allowlist now, MK's
//     ~960 roster at go-live). The function is pure re: input — it processes the
//     ids it's given; the runner decides where they come from.
//   Loop: GET /reports?patient=<id> returns STUBS (grids EMPTY — verified live
//     2026-07-06), so each surviving stub is RE-FETCHED at /reports/{id}/ for the
//     full body before mapping. Two-step, mirrors the poller's per-report fetch.
//   Decision A: skip DELETED stubs (no tombstone in backfill) and UNSIGNED stubs
//     BEFORE re-fetch — only signed, non-deleted reports are stored.
//   D-068 containment: HARD. isIngestAllowed(id) gates every patient. Unchanged.
//   D-080 soft-D-077: the active-member check is SOFT here. An explicitly non-active
//     patients doc is skipped; a MISSING doc or absent field PROCEEDS (+log), because
//     MK's supplied list is the authority for "active" and the backfill may run before
//     onboarding creates the patients docs. The poller keeps the HARD check (no vetted
//     input list). Asymmetry is intentional; logged in D-080.
//   Audit: phi_access_log per re-fetch, actor uid 'system:backfillElationReports',
//     role 'system', source 'backfill', NO feedId (no feed event), action
//     'report_ingested' (backfill never tombstones). Fail-fast PER RECORD: a failed
//     audit write blocks THAT report's store but does not abort the batch.
//   Idempotent: store-once by reportId, merge:false overwrite — re-runs are safe.
//   Resilience: a per-report or per-patient error logs + counts + CONTINUES (batch
//     job, no watermark). Re-run picks up any straggler.

const admin = require('firebase-admin');
const { elationGet, ELATION_BASE, getBinary } = require('./core/services/elation/client');
const { log, logError } = require('./middleware/logger');
const {
  mapCategory,
  isIngestAllowed,
  buildStoredPayload,
  computeHasArtifact,
} = require('./core/services/elation/ingest/reportIngest');
const { ensureInternalUid, objectPathFor } = require('./core/services/patient/internalUid');
const { ingestEligibility, isMinorRecord } = require('./core/services/patient/ingestEligibility');

const REPORTS_PAGE_CAP = 200; // safety cap; loud failure > silent partial pull.

// Pull ALL reports for one patient, following cursors to exhaustion. Mirrors the
// poller's drainFeed cursor discipline. Returns the raw stub list (grids empty).
async function listPatientReports(elationPatientId) {
  const out = [];
  let json = await elationGet('/reports/?patient=' + encodeURIComponent(elationPatientId));
  let pages = 0;
  while (true) {
    const results = Array.isArray(json)
      ? json
      : (json && Array.isArray(json.results) ? json.results : null);
    if (results === null) throw new Error('ELATION_BAD_REPORTS_RESPONSE');
    results.forEach((r) => out.push(r));
    pages += 1;
    const next = (!Array.isArray(json) && json.next) ? json.next : null;
    if (!next) break;
    if (pages >= REPORTS_PAGE_CAP) throw new Error('ELATION_REPORTS_PAGE_CAP_EXCEEDED');
    if (!String(next).startsWith(ELATION_BASE)) throw new Error('ELATION_BAD_CURSOR');
    json = await elationGet(String(next).slice(ELATION_BASE.length));
  }
  return out;
}

// Backfill one patient. Never throws — accumulates into counters and returns a
// per-patient summary. A patient-level failure (e.g. list call) is logged + counted.
async function backfillPatient(db, FieldValue, bucket, elationPatientId, counters) {
  const pid = String(elationPatientId);
  const pc = {
    elationPatientId: pid, listed: 0, stored: 0,
    skippedDeleted: 0, skippedUnsigned: 0, notFound: 0, mismatched: 0, unresolved: 0, errors: 0,
    skippedNotAllowlisted: false, skippedNonActive: false, noPatientDoc: false,
    skippedRecordsDeferred: 0,
    artifactsStored: 0, artifactErrors: 0, artifactSkippedUnclaimed: 0,
  };

  // D-068 HARD containment gate.
  if (!isIngestAllowed(pid)) {
    counters.patientsSkippedNotAllowlisted += 1;
    pc.skippedNotAllowlisted = true;
    log('backfillElationReports', 'skip-not-allowlisted', { elationPatientId: pid });
    return pc;
  }

  // D-080 SOFT active-member check. Skip only an EXPLICITLY non-active doc; a missing
  // doc or absent field proceeds (+log) — MK's list is the "active" authority.
  // Guarded like every other I/O in this function: a transient Firestore error here
  // must not throw out of backfillPatient and abort the whole batch (D-080 resilience:
  // per-patient error logs + counts + CONTINUES; backfillPatient never throws).
  let pSnap;
  try {
    pSnap = await db.collection('patients').doc(pid).get();
  } catch (err) {
    counters.patientsErrored += 1;
    pc.errors += 1;
    logError('backfillElationReports', 'patient-doc-lookup-failed', err, { elationPatientId: pid });
    return pc;
  }
  if (pSnap.exists) {
    const data = pSnap.data() || {};
    const gate = ingestEligibility(data);
    // D-080 stays SOFT for ADULTS: an existing doc with no `status` field proceeds,
    // exactly as before. MINORS are ALWAYS subject to the guardian check, whatever
    // their `status` — so a guardian revoked between batch load and run is honoured
    // by the code, not by the input list.
    if (!gate.eligible && (data.status !== undefined || isMinorRecord(data))) {
      counters.patientsSkippedNonActive += 1;
      pc.skippedNonActive = true;
      log('backfillElationReports', gate.reason, {
        elationPatientId: pid, status: data.status, cohort: gate.cohort,
      });
      return pc;
    }
  } else {
    pc.noPatientDoc = true;
    log('backfillElationReports', 'no-patient-doc-proceeding', { elationPatientId: pid });
  }

  // Pull existing reports (stubs).
  let stubs;
  try {
    stubs = await listPatientReports(pid);
  } catch (err) {
    counters.patientsErrored += 1;
    pc.errors += 1;
    logError('backfillElationReports', 'list-failed', err, { elationPatientId: pid });
    return pc;
  }
  pc.listed = stubs.length;

  for (const stub of stubs) {
    const reportId = String(stub.id);

    // Decision A — skip deleted BEFORE re-fetch (no tombstone in backfill).
    if (stub.deleted_date) {
      pc.skippedDeleted += 1; counters.skippedDeleted += 1;
      log('backfillElationReports', 'skip-deleted', { elationPatientId: pid, reportId });
      continue;
    }
    // Decision A — skip unsigned BEFORE re-fetch.
    if (!stub.signed_date) {
      pc.skippedUnsigned += 1; counters.skippedUnsigned += 1;
      log('backfillElationReports', 'skip-unsigned', { elationPatientId: pid, reportId });
      continue;
    }

    // Re-fetch full body (stub grids are empty; verified live 2026-07-06).
    let report;
    try {
      report = await elationGet('/reports/' + reportId + '/');
    } catch (err) {
      if (err && err.reason === 'ELATION_NOT_FOUND') {
        pc.notFound += 1; counters.notFound += 1;
        log('backfillElationReports', 'report-not-found', { elationPatientId: pid, reportId });
        continue;
      }
      pc.errors += 1; counters.errors += 1;
      logError('backfillElationReports', 'refetch-failed', err, { elationPatientId: pid, reportId });
      continue; // re-runnable; straggler picked up next run
    }

    // Ownership guard — never store under an unconfirmed or wrong patient. A missing
    // patient on the re-fetched report is UNRESOLVED (matches the poller's skip-on-no-
    // patient), logged distinctly from a real cross-patient mismatch. Both skip before
    // any store, so no report is persisted unless report.patient === pid.
    const owner = report && report.patient != null ? String(report.patient) : null;
    if (owner === null) {
      pc.unresolved += 1; counters.unresolved += 1;
      logError('backfillElationReports', 'patient-unresolved', new Error('NO_OWNER_ON_REPORT'), {
        queried: pid, reportId,
      });
      continue;
    }
    if (owner !== pid) {
      pc.mismatched += 1; counters.mismatched += 1;
      logError('backfillElationReports', 'patient-mismatch', new Error('OWNER_MISMATCH'), {
        queried: pid, reportOwner: owner, reportId,
      });
      continue;
    }

    // Deleted could surface on the full body even if the stub lagged — still skip.
    if (report.deleted_date) {
      pc.skippedDeleted += 1; counters.skippedDeleted += 1;
      log('backfillElationReports', 'skip-deleted-refetch', { elationPatientId: pid, reportId });
      continue;
    }

    const { category, subCategory, unmappedType } = mapCategory(report.report_type);

    // phi_access_log FAIL-FAST (per record). A failed audit write blocks THIS store
    // but does not abort the batch — re-run re-attempts idempotently.
    try {
      await db.collection('phi_access_log').add({
        uid: 'system:backfillElationReports',
        role: 'system',
        source: 'backfill',
        action: 'report_ingested',
        elationPatientId: pid,
        reportId,
        reportType: report.report_type ?? null,
        timestamp: FieldValue.serverTimestamp(),
      });
    } catch (err) {
      pc.errors += 1; counters.errors += 1;
      logError('backfillElationReports', 'audit-write-failed', err, { elationPatientId: pid, reportId });
      continue; // no store without audit
    }

    // #317 Records deferral (MVP): same guard as the poller. The PHI read (re-fetch)
    // already happened and is audited above; we skip only the STORE for medical_records
    // unless re-enabled. Placed after the audit so deferred reads keep an audit trail.
    if (category === 'medical_records' && process.env.ELATION_STORE_MEDICAL_RECORDS !== 'true') {
      pc.skippedRecordsDeferred += 1; counters.skippedRecordsDeferred += 1;
      log('backfillElationReports', 'skip-records-deferred', { elationPatientId: pid, reportId });
      continue;
    }

    // Store-once (idempotent) at patients/{id}/labs/{reportId}.
    try {
      // Write-once reverse index (reportId -> patient) so a later poller 404 can
      // resolve the owner after the object is gone from Elation (D-107, #324). Zero
      // PHI; idempotent set. Backfill has no delete branch of its own (it skips
      // deleted stubs pre-fetch, D-080) — it only maintains the index for the poller.
      await db.collection('reportIndex').doc(reportId).set({ patient: pid });

      const payload = buildStoredPayload(report, category);
      await db.collection('patients').doc(pid).collection('labs').doc(reportId).set({
        ...payload,
        reportId,
        category,
        subCategory,
        reportType: report.report_type ?? null,
        unmappedType,
        deleted: false,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: false });
      pc.stored += 1; counters.stored += 1;

      // #372 (D-119): upload the report PDF artifact to Storage so getLabs/getImaging
      // artifact mode can serve it. Metadata alone (above) leaves hasArtifact:true with
      // no object -> the read CF 404s ARTIFACT_NOT_SYNCED and the chip dead-ends.
      // Only lab/imaging carry a servable printable; medical_records are store-deferred
      // above (D-102) and never reach here. Never store the Bearer-gated URL — fetch the
      // bytes server-side and store only the bytes (D-102).
      if ((category === 'lab' || category === 'imaging') && computeHasArtifact(report)) {
        // Owner uid comes from the SAME patient doc already fetched for the D-080 check
        // (pSnap). A missing doc / absent firebaseUid = unclaimed patient: no upload
        // target yet. Not an error — the idempotent re-run uploads once claimed.
        const fbUid = (pSnap && pSnap.exists) ? pSnap.data().firebaseUid : null;
        if (!fbUid) {
          // Unclaimed patient: no upload target yet. The metadata store above may have
          // stamped hasArtifact:true (buildStoredPayload); force it false so the doc is
          // Storage-truth (D-119) — no doc claims an artifact that isn't in Storage.
          // The idempotent re-run after the patient claims uploads and flips it true.
          try {
            await db.collection('patients').doc(pid).collection('labs').doc(reportId)
              .set({ hasArtifact: false }, { merge: true });
          } catch (flipErr) {
            logError('backfillElationReports', 'artifact-unclaimed-flip-failed', flipErr, { elationPatientId: pid, reportId });
          }
          pc.artifactSkippedUnclaimed += 1; counters.artifactSkippedUnclaimed += 1;
          log('backfillElationReports', 'artifact-skip-unclaimed', { elationPatientId: pid, reportId });
        } else {
          const uidLc = String(fbUid).toLowerCase();
          // Write path MUST match the read side byte-for-byte (getLabs.js):
          // elation-artifacts/<firebaseUid-lc>/<reportId>/report.pdf
          const objectPath = 'elation-artifacts/' + uidLc + '/' + reportId + '/report.pdf';
          try {
            const { buffer } = await getBinary('/reports/' + reportId + '/printable');
            await bucket.file(objectPath).save(buffer, { contentType: 'application/pdf', resumable: false });
            // Self-check: a successful save does NOT prove valid bytes (a prior seed
            // shipped a corrupt PDF that only surfaced on download-back). GCS is
            // read-after-write consistent, so an immediate download is safe.
            const [back] = await bucket.file(objectPath).download();
            if (back.subarray(0, 5).toString() !== '%PDF-') {
              throw new Error('ARTIFACT_NOT_PDF');
            }
            pc.artifactsStored += 1; counters.artifactsStored += 1;
            log('backfillElationReports', 'artifact-stored', { elationPatientId: pid, reportId, bytes: buffer.byteLength });
          } catch (artErr) {
            // Classified failure (Elation fetch threw, or the bytes are not a PDF):
            // flip hasArtifact:false so the UI shows no chip and never dead-ends.
            // Idempotent re-run re-fetches and flips it back to true on success.
            pc.artifactErrors += 1; counters.artifactErrors += 1;
            logError('backfillElationReports', 'artifact-failed', artErr, { elationPatientId: pid, reportId });
            try {
              await db.collection('patients').doc(pid).collection('labs').doc(reportId)
                .set({ hasArtifact: false }, { merge: true });
            } catch (flipErr) {
              // Murky failure (couldn't even flip the flag): leave the doc untouched,
              // log loud, let the re-run reconcile. Do NOT guess the doc's state.
              logError('backfillElationReports', 'artifact-flip-failed', flipErr, { elationPatientId: pid, reportId });
            }
          }
        }
      }
    } catch (err) {
      pc.errors += 1; counters.errors += 1;
      logError('backfillElationReports', 'store-failed', err, { elationPatientId: pid, reportId });
      continue;
    }
  }

  counters.patientsProcessed += 1;
  log('backfillElationReports', 'patient-complete', pc);
  return pc;
}

// Orchestrator. db = Firestore instance (caller-initialized Admin SDK).
// FieldValue must come from the SAME firebase-admin require as db (cross-instance
// sentinels are rejected by Firestore — #345, mirrors bindMember/D-083).
// elationPatientIds = array of Elation patient ids to backfill.
async function backfillElationReports(db, FieldValue, elationPatientIds) {
  if (!Array.isArray(elationPatientIds) || elationPatientIds.length === 0) {
    throw new Error('BACKFILL_NO_IDS');
  }
  if (!FieldValue || typeof FieldValue.serverTimestamp !== 'function') {
    throw new Error('BACKFILL_NO_FIELDVALUE');
  }
  const ids = [...new Set(elationPatientIds.map(String))]; // de-dupe

  const counters = {
    patientsRequested: ids.length,
    patientsProcessed: 0,
    patientsSkippedNotAllowlisted: 0,
    patientsSkippedNonActive: 0,
    patientsErrored: 0,
    stored: 0, skippedDeleted: 0, skippedUnsigned: 0, notFound: 0, mismatched: 0, unresolved: 0, errors: 0,
    skippedRecordsDeferred: 0,
    artifactsStored: 0, artifactErrors: 0, artifactSkippedUnclaimed: 0,
  };

  // Explicit bucket MUST match the read side (getLabs.js/getImaging.js:
  // 'prive-care-vip.firebasestorage.app'). A bare admin.storage().bucket() resolves
  // to the runtime default, which is NOT this bucket — artifacts would upload to the
  // wrong bucket and the read CFs would 404 ARTIFACT_NOT_SYNCED (root cause, #372 v2).
  const bucket = admin.storage().bucket('prive-care-vip.firebasestorage.app');

  const perPatient = [];
  for (const id of ids) {
    const pc = await backfillPatient(db, FieldValue, bucket, id, counters);
    perPatient.push(pc);
  }

  log('backfillElationReports', 'backfill-complete', counters);
  return { counters, perPatient };
}

module.exports = { backfillElationReports, listPatientReports };
