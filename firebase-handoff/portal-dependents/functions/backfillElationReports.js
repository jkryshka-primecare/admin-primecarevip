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
// keyless Admin SDK flow, Doppler-supplied Elation secrets) or by
// backfillElationReportsHttp.js (operator console). Not registered in index.js.
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
//     isIngestAllowed = FULL_SYNC short-circuit → inList(ELATION_READ_ALLOWLIST) ||
//     inList(ELATION_INGEST_EXTRA). See reportIngest.js / PR #454.
//   D-080 soft-D-077: the active-member check is SOFT here. An explicitly non-active
//     patients doc is skipped; a MISSING doc or absent field PROCEEDS (+log), because
//     MK's supplied list is the authority for "active" and the backfill may run before
//     onboarding creates the patients docs. The poller keeps the HARD check (no vetted
//     input list). Asymmetry is intentional; logged in D-080.
//   Audit: phi_access_log per re-fetch, actor uid 'system:backfillElationReports',
//     role 'system', source 'backfill', NO feedId (no feed event), action
//     'report_ingested'. Fail-fast PER RECORD.
//   Idempotent: store-once by reportId, merge:false overwrite — re-runs are safe.
//   Resilience: a per-report or per-patient error logs + counts + CONTINUES.
//
// ADULT BACKFILL AMENDMENTS (2026-08-26, "go-ahead" review items 2–4):
//   * `options.skipExisting` — read labs/{reportId} first and skip the store +
//     artifact when the stored copy is current. Unset => byte-identical legacy
//     (minor-track) behaviour.
//   * Streamed artifact upload with its OWN abort budget, and a RANGED first-8-byte
//     read for the `%PDF-` invariant instead of a full download-back.
//   * `medical_records` participate in artifact upload when MR storing is enabled
//     (otherwise every MR doc lands hasArtifact:true with no object).
//   * `options.dryRun` — no writes at all; returns eligibility + a `reportTypeCensus`.
//   * `options.concurrency` + `options.onPatientComplete` — bounded parallelism and
//     per-id checkpointing so a 540s timeout resumes at the next id.

const admin = require('firebase-admin');
const elationClient = require('./core/services/elation/client');
const { elationGet, ELATION_BASE, getBinary } = elationClient;
const { log, logError } = require('./middleware/logger');
const {
  mapCategory,
  isIngestAllowed,
  buildStoredPayload,
  computeHasArtifact,
} = require('./core/services/elation/ingest/reportIngest');
const { ensureInternalUid, objectPathFor } = require('./core/services/patient/internalUid');
const {
  ingestEligibility,
  adultBackfillEligibility,
  isMinorRecord,
} = require('./core/services/patient/ingestEligibility');

// --- error observability (Part B) ---------------------------------------
// The per-patient counters told us THAT a patient failed but never WHY, so a
// live failure meant a Cloud Logging dig. Capture a short, PHI-safe brief of
// each caught error onto the per-patient summary. Message is truncated and the
// Elation response body is NEVER echoed (only status + reason code).
function errBrief(stage, err) {
  const e = err || {};
  const message = String(e.message || e).slice(0, 300);
  return {
    stage,
    message,
    reason: e.reason ? String(e.reason) : null,
    status: Number.isFinite(e.status) ? e.status : (Number.isFinite(e.statusCode) ? e.statusCode : null),
    code: e.code ? String(e.code) : null,
  };
}

function noteError(pc, stage, err, extra) {
  const brief = errBrief(stage, err);
  if (extra) Object.assign(brief, extra);
  if (!Array.isArray(pc.errorDetails)) pc.errorDetails = [];
  if (pc.errorDetails.length < 5) pc.errorDetails.push(brief);
  pc.lastError = brief;
  return brief;
}

const REPORTS_PAGE_CAP = 200; // safety cap; loud failure > silent partial pull.

// A /printable fetch is a multi-MB PDF over a slow upstream and must NOT share the
// JSON call's short budget — the 5.6MB / 16.4MB reports are exactly what timed the
// repair sweep out. Deliberately a SEPARATE constant (go-ahead item 3).
const ARTIFACT_FETCH_TIMEOUT_MS = Number(process.env.ELATION_ARTIFACT_TIMEOUT_MS || 120000);

// HANG FIX (2026-08-28, run L0iCYecF1obm5bWklnAK stuck at 1/2 with Failed: 0).
// `timeoutMs` handed to the Elation client only guards CONNECT + RESPONSE HEADERS.
// Once bytes start (or fail to start) flowing, the body pipe below was awaited with
// NO timer at all: a stalled TCP body emits neither 'error' nor 'finish', so the
// promise never settles, the worker never returns, the run doc never checkpoints,
// and the 540s instance kill leaves `status:'running'` forever. Every await that can
// touch the network now runs under a HARD deadline that rejects.
const JSON_CALL_TIMEOUT_MS = Number(process.env.ELATION_JSON_TIMEOUT_MS || 90000);
const ARTIFACT_STALL_MS = Number(process.env.ELATION_ARTIFACT_STALL_MS || 45000);
const GCS_READ_TIMEOUT_MS = Number(process.env.GCS_READ_TIMEOUT_MS || 30000);
const FIRESTORE_CALL_TIMEOUT_MS = Number(process.env.BACKFILL_FIRESTORE_TIMEOUT_MS || 30000);
const GCS_METADATA_TIMEOUT_MS = Number(process.env.GCS_METADATA_TIMEOUT_MS || 30000);
const PATIENT_BUDGET_MS = Number(process.env.BACKFILL_PATIENT_BUDGET_MS || 420000);

// ---------------------------------------------------------------------------
// ELATION THROTTLE + RETRY (2026-08-29, run 1K2OIzSY39v5rPpLnQLv: ~44% of the
// retry cohort failed with ELATION_JSON_TIMEOUT/ELATION_TIMEOUT at list-reports,
// status 0, WORSENING as the run progressed => upstream throttling under
// sustained load, not transient network noise).
//
// Every Elation HTTP call in this module now passes through ONE process-wide
// gate that bounds in-flight calls AND paces call STARTS. Patient-level
// concurrency (opts.concurrency) no longer multiplies into Elation request
// pressure: N workers share these limits.
// ---------------------------------------------------------------------------
const ELATION_MAX_INFLIGHT = Math.max(1, Number(process.env.ELATION_MAX_INFLIGHT || 3));
const ELATION_MIN_INTERVAL_MS = Math.max(0, Number(process.env.ELATION_MIN_INTERVAL_MS || 250));
const ELATION_MAX_ATTEMPTS = Math.max(1, Number(process.env.ELATION_MAX_ATTEMPTS || 4));
const ELATION_BACKOFF_BASE_MS = Math.max(100, Number(process.env.ELATION_BACKOFF_BASE_MS || 2000));
const ELATION_BACKOFF_CAP_MS = Math.max(1000, Number(process.env.ELATION_BACKOFF_CAP_MS || 30000));
// A server-supplied Retry-After is authoritative and may legitimately exceed the
// exponential cap; it is bounded only by this sane ceiling (review item 3).
const ELATION_RETRY_AFTER_MAX_MS = Math.max(
  ELATION_BACKOFF_CAP_MS,
  Number(process.env.ELATION_RETRY_AFTER_MAX_MS || 120000),
);
// Head-room subtracted from the remaining patient budget before we agree to
// spend it on another attempt (checkpoint/finalisation still has to happen).
const ELATION_RETRY_MARGIN_MS = Math.max(0, Number(process.env.ELATION_RETRY_MARGIN_MS || 15000));

// --- per-patient deadline context -----------------------------------------
// The worker wraps each patient in `withPatientDeadline`; every Elation call
// made underneath it (however deep) can then read how much of the 420s budget
// is left and refuse to start an attempt it cannot finish. Ambient context
// avoids threading a deadline argument through every call site.
const { AsyncLocalStorage } = require('node:async_hooks');
const patientDeadlineStore = new AsyncLocalStorage();

function withPatientDeadline(deadlineAt, fn) {
  return patientDeadlineStore.run({ deadlineAt }, fn);
}

/** Milliseconds left in the current patient budget, or Infinity outside one. */
function remainingPatientMs() {
  const ctx = patientDeadlineStore.getStore();
  if (!ctx || !Number.isFinite(ctx.deadlineAt)) return Infinity;
  return ctx.deadlineAt - Date.now();
}

// --- abortable backoff -----------------------------------------------------
// Pending backoff sleeps are tracked so the run can break them all at the
// soft-budget / pause boundary instead of burning the instance's last seconds
// inside a 30s setTimeout that nothing can cancel.
const pendingBackoffs = new Set();

/** Resolves false on normal expiry, true when aborted by abortElationBackoff(). */
function sleep(ms) {
  return new Promise((resolve) => {
    const entry = {};
    const timer = setTimeout(() => { pendingBackoffs.delete(entry); resolve(false); }, ms);
    if (timer && typeof timer.unref === 'function') timer.unref();
    entry.cancel = () => { clearTimeout(timer); pendingBackoffs.delete(entry); resolve(true); };
    pendingBackoffs.add(entry);
  });

}

/** Wake every in-flight backoff immediately; they surface as aborted retries. */
function abortElationBackoff() {
  const entries = Array.from(pendingBackoffs);
  pendingBackoffs.clear();
  entries.forEach((e) => { try { e.cancel(); } catch (_) { /* best effort */ } });
  return entries.length;
}

const elationGate = { inflight: 0, lastStart: 0, queue: [], timer: null };

function releaseElationSlot() {
  elationGate.inflight -= 1;
  pumpElationGate();
}

function pumpElationGate() {
  if (!elationGate.queue.length) return;
  if (elationGate.inflight >= ELATION_MAX_INFLIGHT) return;
  const wait = Math.max(0, elationGate.lastStart + ELATION_MIN_INTERVAL_MS - Date.now());
  if (wait > 0) {
    if (!elationGate.timer) {
      elationGate.timer = setTimeout(() => { elationGate.timer = null; pumpElationGate(); }, wait);
      if (elationGate.timer.unref) elationGate.timer.unref();
    }
    return;
  }
  const next = elationGate.queue.shift();
  elationGate.inflight += 1;
  elationGate.lastStart = Date.now();
  next();
  pumpElationGate();
}

/** Acquire a paced Elation slot; resolves with a release fn (idempotent). */
function acquireElationSlot() {
  return new Promise((resolve) => {
    elationGate.queue.push(() => {
      let released = false;
      resolve(() => { if (!released) { released = true; releaseElationSlot(); } });
    });
    pumpElationGate();
  });
}

/**
 * Normalise whatever the Elation client throws into { status, headers,
 * retryAfterMs }. The client is not guaranteed to attach an HTTP status; without
 * this, `Number(undefined)` is NaN, both status branches fall through, and the
 * unknown-error fallback would retry a hard 401/403/404 four times and burn the
 * patient budget (review item 3).
 */
function elationErrorFacts(err) {
  const e = err || {};
  const res = e.response || e.res || {};
  let status = Number(e.status || e.statusCode || res.status || res.statusCode || 0);
  if (!status) {
    const m = String(e.reason || e.code || e.message || '').match(/\b([45]\d{2})\b/);
    if (m) status = Number(m[1]);
  }
  const headers = e.headers || res.headers || null;
  const rawRetryAfter = headers
    ? (headers['retry-after'] || headers['Retry-After']
      || (typeof headers.get === 'function' ? headers.get('retry-after') : null))
    : null;
  let retryAfterMs = Number(e.retryAfterMs || 0);
  if (!retryAfterMs && rawRetryAfter != null) {
    const asSeconds = Number(rawRetryAfter);
    if (Number.isFinite(asSeconds) && asSeconds >= 0) {
      retryAfterMs = asSeconds * 1000;
    } else {
      const asDate = Date.parse(String(rawRetryAfter));
      if (Number.isFinite(asDate)) retryAfterMs = Math.max(0, asDate - Date.now());
    }
  }
  return { status: status || 0, retryAfterMs: retryAfterMs || 0 };
}

/** Non-retryable: a definitive upstream answer. Everything else self-heals. */
function isRetryableElationError(err) {
  const reason = err && err.reason;
  if (reason === 'ELATION_NOT_FOUND') return false;
  if (reason === 'ELATION_JSON_TIMEOUT' || reason === 'ELATION_TIMEOUT') return true;
  if (reason === 'ARTIFACT_OPEN_TIMEOUT' || reason === 'ARTIFACT_FETCH_TIMEOUT'
    || reason === 'ARTIFACT_STREAM_TIMEOUT' || reason === 'ARTIFACT_STREAM_STALLED') return true;
  const { status } = elationErrorFacts(err);
  if (status === 429 || (status >= 500 && status <= 599)) return true;
  if (status >= 400 && status < 500) return false;
  return true; // status 0 / network / unknown -> retry
}

function backoffDelayMs(attempt, err) {
  const { retryAfterMs } = elationErrorFacts(err);
  if (retryAfterMs > 0) return Math.min(retryAfterMs, ELATION_RETRY_AFTER_MAX_MS);
  const exp = Math.min(ELATION_BACKOFF_BASE_MS * Math.pow(2, attempt - 1), ELATION_BACKOFF_CAP_MS);
  return Math.round(exp * (0.5 + Math.random() * 0.5)); // full-ish jitter
}

/**
 * Run one Elation call under the shared gate, with retry + exponential backoff.
 *
 * Two properties the reviewer asked for, both load-bearing:
 *  - The gate slot is acquired PER ATTEMPT and released BEFORE the backoff
 *    sleep. A retrying call must never occupy one of the 3 slots while doing
 *    nothing, or three simultaneous retries would freeze all Elation traffic
 *    for the whole backoff window — exactly when load is heaviest.
 *  - Retries are budget-aware. `callTimeoutMs` is what one attempt can cost; we
 *    only spend another attempt when the remaining patient budget covers
 *    delay + timeout + margin, so retrying can never itself manufacture
 *    PATIENT_BUDGET_EXCEEDED. Backoff also breaks on pause/abort.
 *
 * `fn()` must START the request (it is called inside the slot) and is re-invoked
 * fresh on each attempt so no half-consumed stream is reused.
 */
async function callElation(label, fn, opts) {
  const { attempts = ELATION_MAX_ATTEMPTS, callTimeoutMs = JSON_CALL_TIMEOUT_MS } = opts || {};
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const release = await acquireElationSlot();
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= attempts || !isRetryableElationError(err)) throw err;
      const delay = backoffDelayMs(attempt, err);
      const remaining = remainingPatientMs();
      if (remaining < delay + callTimeoutMs + ELATION_RETRY_MARGIN_MS) {
        log('backfillElationReports', 'elation-retry-skipped', {
          label, attempt, attempts, delayMs: delay, remainingMs: Math.round(remaining),
          needMs: delay + callTimeoutMs + ELATION_RETRY_MARGIN_MS,
          reason: (err && err.reason) || null,
        });
        if (err && !err.reason) err.reason = 'ELATION_RETRY_BUDGET_EXHAUSTED';
        throw err;
      }
      log('backfillElationReports', 'elation-retry', {
        label, attempt, attempts, delayMs: delay, reason: (err && err.reason) || null,
        status: elationErrorFacts(err).status,
      });
      release();                       // free the slot BEFORE sleeping
      const aborted = await sleep(delay);
      if (aborted) {
        if (err && !err.reason) err.reason = 'ELATION_BACKOFF_ABORTED';
        throw err;
      }
      continue;
    } finally {
      release();                       // idempotent; no-op if already released
    }
  }
  throw lastErr;
}

/** Paced + retried JSON GET under the JSON deadline. */
function elationJson(path, label) {
  // Never let one attempt outlive the patient budget it is spending.
  const budget = remainingPatientMs();
  const timeoutMs = Math.max(
    1000,
    Math.min(JSON_CALL_TIMEOUT_MS, Number.isFinite(budget) ? budget - ELATION_RETRY_MARGIN_MS : JSON_CALL_TIMEOUT_MS),
  );
  return callElation(label || path, () => withDeadline(
    elationGet(path),
    timeoutMs,
    'ELATION_JSON_TIMEOUT',
  ), { callTimeoutMs: timeoutMs });
}


/** Reject with a coded error when `promise` has not settled within `ms`. */
function withDeadline(promise, ms, code, onTimeout) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(code + ' after ' + ms + 'ms');
      err.reason = code;
      try { if (typeof onTimeout === 'function') onTimeout(); } catch (_) { /* best effort */ }
      reject(err);
    }, ms);
    if (timer && typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}




/** True when MR docs may be stored at all (poller uses the same env flag). */
function storeMedicalRecordsEnabled(options) {
  if (options && typeof options.storeMedicalRecords === 'boolean') return options.storeMedicalRecords;
  return process.env.ELATION_STORE_MEDICAL_RECORDS === 'true';
}

/** Categories that carry a servable /printable PDF. MR included per MK's decision. */
function categoryHasArtifact(category, options) {
  if (category === 'lab' || category === 'imaging') return true;
  if (category === 'medical_records') return storeMedicalRecordsEnabled(options);
  return false;
}

/** Elation's own "last touched" marker for a report body, as ms since epoch. */
function elationModifiedMs(report) {
  const raw = (report && (report.last_modified || report.signed_date || report.document_date)) || null;
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

/** Firestore Timestamp | Date | ISO -> ms, or null. */
function toMs(value) {
  if (!value) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  const t = Date.parse(String(value));
  return Number.isFinite(t) ? t : null;
}

/**
 * skipExisting predicate: the stored doc is CURRENT when it exists, is not
 * tombstoned, and was written after Elation last touched the report.
 * Unknown timestamps are treated as stale (we re-store) — never the reverse.
 */
function storedCopyIsCurrent(snap, report) {
  if (!snap || !snap.exists) return false;
  const data = snap.data() || {};
  if (data.deleted === true) return false;
  const storedAt = toMs(data.updatedAt);
  const elationAt = elationModifiedMs(report);
  if (storedAt === null || elationAt === null) return false;
  return storedAt >= elationAt;
}

/** Ranged first-8-bytes read. Replaces the full download-back verify (item 2). */
async function verifyPdfHeader(file) {
  const chunks = [];
  let stream = null;
  await withDeadline(
    new Promise((resolve, reject) => {
      stream = file.createReadStream({ start: 0, end: 7 });
      stream.on('data', (c) => chunks.push(c));
      stream.on('error', reject);
      stream.on('end', resolve);
    }),
    GCS_READ_TIMEOUT_MS,
    'ARTIFACT_VERIFY_TIMEOUT',
    () => { try { stream && stream.destroy(); } catch (_) { /* noop */ } },
  );
  const head = Buffer.concat(chunks).subarray(0, 5).toString();
  if (head !== '%PDF-') throw new Error('ARTIFACT_NOT_PDF');
}

/**
 * Fetch the printable and write it to Storage. Streams when the shared Elation
 * client exposes a stream helper; otherwise falls back to the buffered getBinary
 * (still with the dedicated artifact budget). Returns bytes written when known.
 *
 * Three independent guards, because the client's `timeoutMs` only covers headers:
 *   1. total budget on the header/connect await,
 *   2. a STALL watchdog on the pipe, reset on every chunk (a body that stops
 *      mid-download is the failure mode we actually hit),
 *   3. a total ceiling on the whole pipe so an infinitely-slow-but-dripping
 *      body cannot outlive the invocation.
 * Any of them destroys both streams and rejects, so the caller's catch runs.
 */
async function uploadArtifactOnce(file, reportId) {
  const path = '/reports/' + reportId + '/printable';
  const writeOpts = { contentType: 'application/pdf', resumable: false };

  if (typeof elationClient.getBinaryStream === 'function') {
    const source = await withDeadline(
      elationClient.getBinaryStream(path, { timeoutMs: ARTIFACT_FETCH_TIMEOUT_MS }),
      ARTIFACT_FETCH_TIMEOUT_MS,
      'ARTIFACT_OPEN_TIMEOUT',
    );
    const body = source && source.stream ? source.stream : source;
    let dest = null;
    let stallTimer = null;
    const abort = (err) => {
      try { body && body.destroy(err); } catch (_) { /* noop */ }
      try { dest && dest.destroy(err); } catch (_) { /* noop */ }
    };
    try {
      await withDeadline(
        new Promise((resolve, reject) => {
          dest = file.createWriteStream(writeOpts);
          const armStall = () => {
            clearTimeout(stallTimer);
            stallTimer = setTimeout(() => {
              const err = new Error('ARTIFACT_STREAM_STALLED after ' + ARTIFACT_STALL_MS + 'ms');
              err.reason = 'ARTIFACT_STREAM_STALLED';
              abort(err);
              reject(err);
            }, ARTIFACT_STALL_MS);
            if (stallTimer && typeof stallTimer.unref === 'function') stallTimer.unref();
          };
          body.on('data', armStall);
          body.on('error', reject);
          dest.on('error', reject);
          dest.on('finish', resolve);
          armStall();
          body.pipe(dest);
        }),
        ARTIFACT_FETCH_TIMEOUT_MS,
        'ARTIFACT_STREAM_TIMEOUT',
        () => abort(new Error('ARTIFACT_STREAM_TIMEOUT')),
      );
    } finally {
      clearTimeout(stallTimer);
    }
    return null; // size unknown on the streamed path; GCS metadata has it
  }

  const { buffer } = await withDeadline(
    getBinary(path, { timeoutMs: ARTIFACT_FETCH_TIMEOUT_MS }),
    ARTIFACT_FETCH_TIMEOUT_MS,
    'ARTIFACT_FETCH_TIMEOUT',
  );
  await withDeadline(file.save(buffer, writeOpts), GCS_READ_TIMEOUT_MS, 'ARTIFACT_SAVE_TIMEOUT');
  return buffer.byteLength;
}

/**
 * Artifact pulls go through the SAME paced gate as JSON (a /printable is by far
 * the heaviest call we make at Elation). Fewer attempts than JSON: each retry
 * re-downloads multiple MB.
 */
function uploadArtifact(file, reportId) {
  return callElation('printable:' + reportId, () => uploadArtifactOnce(file, reportId), {
    attempts: Math.max(1, Number(process.env.ELATION_ARTIFACT_ATTEMPTS || 2)),
    // One printable attempt costs at most the artifact fetch deadline; the
    // retry check charges that against the remaining patient budget.
    callTimeoutMs: ARTIFACT_FETCH_TIMEOUT_MS,
  });
}


/** Census accumulator: distinct report_type -> count + mapped category. */
function noteCensus(census, reportType) {
  const key = reportType == null ? '(null)' : String(reportType);
  if (!census[key]) {
    const { category, subCategory, unmappedType } = mapCategory(reportType);
    census[key] = { reportType: key, count: 0, category, subCategory, unmappedType };
  }
  census[key].count += 1;
}

// Backfill one patient. Never throws — accumulates into counters and returns a
// per-patient summary. A patient-level failure (e.g. list call) is logged + counted.
async function backfillPatient(db, FieldValue, bucket, elationPatientId, counters, options) {
  const opts = options || {};
  const dryRun = opts.dryRun === true;
  const skipExisting = opts.skipExisting === true;
  const cohort = opts.cohort === 'adults' ? 'adults' : 'minors';
  const pid = String(elationPatientId);
  const pc = {
    elationPatientId: pid, listed: 0, stored: 0,
    skippedDeleted: 0, skippedUnsigned: 0, notFound: 0, mismatched: 0, unresolved: 0, errors: 0,
    skippedNotAllowlisted: false, skippedNonActive: false, noPatientDoc: false,
    skippedRecordsDeferred: 0, alreadyStored: 0, wouldStore: 0,
    artifactsStored: 0, artifactErrors: 0, artifactSkippedUnclaimed: 0, artifactsAlreadyPresent: 0,
    errorDetails: [], lastError: null,
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
  let pSnap;
  try {
    pSnap = await withDeadline(
      db.collection('patients').doc(pid).get(),
      FIRESTORE_CALL_TIMEOUT_MS,
      'PATIENT_DOC_LOOKUP_TIMEOUT',
    );
  } catch (err) {
    counters.patientsErrored += 1;
    pc.errors += 1;
    noteError(pc, 'patient-doc-lookup', err);
    logError('backfillElationReports', 'patient-doc-lookup-failed', err, { elationPatientId: pid });
    return pc;
  }
  if (pSnap.exists) {
    const data = pSnap.data() || {};
    const minor = isMinorRecord(data);
    // The runner must enforce the SAME D-081 rule as the wrapper. Previously it
    // called ingestEligibility(), whose adult path requires status === 'active',
    // so wrapper-approved invited/not_invited adults returned here before their
    // reports were listed. Keep this re-check for status changes between the
    // wrapper partition and processing, but share its definition with the wrapper.
    const gate = cohort === 'adults'
      ? adultBackfillEligibility(data)
      : ingestEligibility(data);
    // D-080 remains soft only for a missing adult status. Minors are always
    // subject to the guardian check, whatever their status.
    if (!gate.eligible && (cohort === 'adults' || data.status !== undefined || minor)) {
      counters.patientsSkippedNonActive += 1;
      pc.skippedNonActive = true;
      log('backfillElationReports', gate.reason, {
        elationPatientId: pid, status: data.status, cohort: gate.cohort || cohort,
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
    noteError(pc, 'list-reports', err);
    logError('backfillElationReports', 'list-failed', err, { elationPatientId: pid });
    return pc;
  }
  pc.listed = stubs.length;

  for (const stub of stubs) {
    const reportId = String(stub.id);

    // Decision A — skip deleted BEFORE re-fetch (no tombstone in backfill).
    if (stub.deleted_date) {
      pc.skippedDeleted += 1; counters.skippedDeleted += 1;
      if (!dryRun) log('backfillElationReports', 'skip-deleted', { elationPatientId: pid, reportId });
      continue;
    }
    // Decision A — skip unsigned BEFORE re-fetch.
    if (!stub.signed_date) {
      pc.skippedUnsigned += 1; counters.skippedUnsigned += 1;
      if (!dryRun) log('backfillElationReports', 'skip-unsigned', { elationPatientId: pid, reportId });
      continue;
    }

    // ---- DRY RUN -------------------------------------------------------
    // No PHI re-fetch, no audit row, no write. The stub carries `report_type`,
    // which is all the census needs; eligibility is decided from the stub plus
    // the existing stored doc.
    if (dryRun) {
      noteCensus(counters.reportTypeCensus, stub.report_type);
      const { category } = mapCategory(stub.report_type);
      if (category === 'medical_records' && !storeMedicalRecordsEnabled(opts)) {
        pc.skippedRecordsDeferred += 1; counters.skippedRecordsDeferred += 1;
        continue;
      }
      let existing = null;
      try {
        existing = await withDeadline(
          db.collection('patients').doc(pid).collection('labs').doc(reportId).get(),
          FIRESTORE_CALL_TIMEOUT_MS,
          'EXISTING_DOC_LOOKUP_TIMEOUT',
        );
      } catch (err) {
        pc.errors += 1; counters.errors += 1;
        noteError(pc, 'dry-run-existing-lookup', err, { reportId });
        continue;
      }
      if (existing.exists && (existing.data() || {}).deleted !== true) {
        pc.alreadyStored += 1; counters.alreadyStored += 1;
      } else {
        pc.wouldStore += 1; counters.wouldStore += 1;
      }
      continue;
    }
    // --------------------------------------------------------------------

    // skipExisting fast path — avoid the re-fetch entirely when the stored doc is
    // already newer than the stub's own signed/modified marker.
    let existingSnap = null;
    if (skipExisting) {
      try {
        existingSnap = await withDeadline(
          db.collection('patients').doc(pid).collection('labs').doc(reportId).get(),
          FIRESTORE_CALL_TIMEOUT_MS,
          'EXISTING_DOC_LOOKUP_TIMEOUT',
        );
      } catch (err) {
        existingSnap = null; // treat a lookup failure as "unknown" -> re-store
      }
      if (storedCopyIsCurrent(existingSnap, stub)) {
        pc.alreadyStored += 1; counters.alreadyStored += 1;
        continue;
      }
    }

    // Re-fetch full body (stub grids are empty; verified live 2026-07-06).
    let report;
    try {
      report = await elationJson('/reports/' + reportId + '/', 'report:' + reportId);
    } catch (err) {
      if (err && err.reason === 'ELATION_NOT_FOUND') {
        pc.notFound += 1; counters.notFound += 1;
        log('backfillElationReports', 'report-not-found', { elationPatientId: pid, reportId });
        continue;
      }
      pc.errors += 1; counters.errors += 1;
      noteError(pc, 'refetch-report', err, { reportId });
      logError('backfillElationReports', 'refetch-failed', err, { elationPatientId: pid, reportId });
      continue; // re-runnable; straggler picked up next run
    }

    // Ownership guard — never store under an unconfirmed or wrong patient.
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
    noteCensus(counters.reportTypeCensus, report.report_type);

    // Type exclusions (census review outcome): drop before the audit + store.
    if (opts.excludeReportTypes && opts.excludeReportTypes.has(String(report.report_type ?? '(null)'))) {
      pc.skippedRecordsDeferred += 1; counters.skippedExcludedType += 1;
      log('backfillElationReports', 'skip-excluded-type', { elationPatientId: pid, reportId });
      continue;
    }

    // Second skipExisting check, now against the authoritative full body.
    if (skipExisting && storedCopyIsCurrent(existingSnap, report)) {
      pc.alreadyStored += 1; counters.alreadyStored += 1;
      continue;
    }

    // phi_access_log FAIL-FAST (per record). A failed audit write blocks THIS store
    // but does not abort the batch — re-run re-attempts idempotently.
    try {
      await withDeadline(
        db.collection('phi_access_log').add({
          uid: 'system:backfillElationReports',
          role: 'system',
          source: 'backfill',
          action: 'report_ingested',
          elationPatientId: pid,
          reportId,
          reportType: report.report_type ?? null,
          timestamp: FieldValue.serverTimestamp(),
        }),
        FIRESTORE_CALL_TIMEOUT_MS,
        'AUDIT_WRITE_TIMEOUT',
      );
    } catch (err) {
      pc.errors += 1; counters.errors += 1;
      noteError(pc, 'audit-write', err, { reportId });
      logError('backfillElationReports', 'audit-write-failed', err, { elationPatientId: pid, reportId });
      continue; // no store without audit
    }

    // #317 Records deferral: same guard as the poller. The PHI read (re-fetch) already
    // happened and is audited above; we skip only the STORE for medical_records unless
    // re-enabled (ELATION_STORE_MEDICAL_RECORDS / options.storeMedicalRecords).
    if (category === 'medical_records' && !storeMedicalRecordsEnabled(opts)) {
      pc.skippedRecordsDeferred += 1; counters.skippedRecordsDeferred += 1;
      log('backfillElationReports', 'skip-records-deferred', { elationPatientId: pid, reportId });
      continue;
    }

    // Store-once (idempotent) at patients/{id}/labs/{reportId}.
    try {
      // Write-once reverse index (reportId -> patient) so a later poller 404 can
      // resolve the owner after the object is gone from Elation (D-107, #324).
      await withDeadline(
        db.collection('reportIndex').doc(reportId).set({ patient: pid }),
        FIRESTORE_CALL_TIMEOUT_MS,
        'REPORT_INDEX_WRITE_TIMEOUT',
      );

      const payload = buildStoredPayload(report, category);
      await withDeadline(
        db.collection('patients').doc(pid).collection('labs').doc(reportId).set({
          ...payload,
          reportId,
          category,
          subCategory,
          reportType: report.report_type ?? null,
          unmappedType,
          deleted: false,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: false }),
        FIRESTORE_CALL_TIMEOUT_MS,
        'REPORT_DOC_WRITE_TIMEOUT',
      );
      pc.stored += 1; counters.stored += 1;

      // #372 (D-119): upload the report PDF artifact to Storage so the read path can
      // serve it. Metadata alone leaves hasArtifact:true with no object -> the read CF
      // 404s ARTIFACT_NOT_SYNCED and the chip dead-ends. medical_records are included
      // whenever MR storing is on (go-ahead: required, not optional). Never store the
      // Bearer-gated URL — fetch the bytes server-side and store only the bytes (D-102).
      if (categoryHasArtifact(category, opts) && computeHasArtifact(report)) {
        // 2b re-key: the RECORD's internalUid, never the caller's / claimant's auth uid.
        const { internalUid } = await withDeadline(
          ensureInternalUid(pid, db),
          FIRESTORE_CALL_TIMEOUT_MS,
          'INTERNAL_UID_TIMEOUT',
        );
        if (!internalUid) {
          // A mint gap, NOT "no artifact": do not flip hasArtifact:false.
          pc.artifactErrors += 1; counters.artifactErrors += 1;
          log('backfillElationReports', 'artifact-skip-no-internal-uid', { elationPatientId: pid, reportId });
        } else {
          const objectPath = objectPathFor(internalUid, reportId);
          const file = bucket.file(objectPath);
          try {
            // skipExisting: a present, valid object is not re-fetched from Elation.
            let present = false;
            if (skipExisting) {
              // `file.exists()` is a metadata RPC. PR #458 guarded the printable
              // open/body/verify paths but left this pre-fetch await uncovered, so a
              // zero-stored patient could wedge before any artifact timer started.
              const [exists] = await withDeadline(
                file.exists(),
                GCS_METADATA_TIMEOUT_MS,
                'ARTIFACT_EXISTS_TIMEOUT',
              );
              if (exists) {
                try {
                  await verifyPdfHeader(file);
                  present = true;
                } catch (_) {
                  present = false; // corrupt -> re-upload below
                }
              }
            }
            if (present) {
              pc.artifactsAlreadyPresent += 1; counters.artifactsAlreadyPresent += 1;
            } else {
              const bytes = await uploadArtifact(file, reportId);
              // Self-check: a successful save does NOT prove valid bytes. GCS is
              // read-after-write consistent, so an immediate RANGED read is safe and
              // does not pull a 16MB PDF back down.
              await verifyPdfHeader(file);
              pc.artifactsStored += 1; counters.artifactsStored += 1;
              log('backfillElationReports', 'artifact-stored', { elationPatientId: pid, reportId, bytes });
            }
          } catch (artErr) {
            // Coverage-gate era: do NOT flip hasArtifact:false. Delete any partial or
            // corrupt object and leave hasArtifact:true — the audit sees an honest MISS
            // and sweepArtifactRepairs heals it (or parks + alerts after MAX_FAILURES).
            try {
              await withDeadline(
                file.delete({ ignoreNotFound: true }),
                GCS_METADATA_TIMEOUT_MS,
                'ARTIFACT_CLEANUP_TIMEOUT',
              );
            } catch (delErr) {
              log('backfillElationReports', 'artifact-cleanup-failed', {
                elationPatientId: pid, reportId, error: delErr.message,
              });
            }
            pc.artifactErrors += 1; counters.artifactErrors += 1;
            logError('backfillElationReports', 'artifact-failed-left-open', artErr, {
              elationPatientId: pid, reportId,
            });
          }
        }
      }
    } catch (err) {
      pc.errors += 1; counters.errors += 1;
      noteError(pc, 'store-report', err, { reportId });
      logError('backfillElationReports', 'store-failed', err, { elationPatientId: pid, reportId });
      continue;
    }
  }

  counters.patientsProcessed += 1;
  // DURABLE COMPLETION BEFORE FINALIZATION (2026-08-28).
  // Every report for this id has been persisted by the time we get here. Record
  // the id as complete NOW, before any further hangable step (logging sinks,
  // the worker's own post-return checkpoint, the wrapper's chunk write). If a
  // later step wedges, the run doc already shows this id done, so a resume
  // advances to the next id instead of re-hanging on this one.
  if (typeof opts._checkpoint === 'function') await opts._checkpoint(pc);
  log('backfillElationReports', dryRun ? 'patient-dry-run-complete' : 'patient-complete', pc);
  return pc;
}

// Pull ALL reports for one patient, following cursors to exhaustion.
async function listPatientReports(elationPatientId) {
  const out = [];
  let json = await elationJson(
    '/reports/?patient=' + encodeURIComponent(elationPatientId),
    'list-reports:' + elationPatientId,
  );
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
    json = await elationJson(
      String(next).slice(ELATION_BASE.length),
      'list-reports-page:' + elationPatientId,
    );
  }
  return out;
}

// Orchestrator. db = Firestore instance (caller-initialized Admin SDK).
// FieldValue must come from the SAME firebase-admin require as db (cross-instance
// sentinels are rejected by Firestore — #345, mirrors bindMember/D-083).
// elationPatientIds = array of Elation patient ids to backfill.
// options (all optional; unset === legacy minor-track behaviour):
//   { cohort, dryRun, skipExisting, storeMedicalRecords, excludeReportTypes: Set,
//     concurrency, onPatientComplete(pc, counters) }
async function backfillElationReports(db, FieldValue, elationPatientIds, options) {
  const opts = options || {};
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
    skippedRecordsDeferred: 0, skippedExcludedType: 0, alreadyStored: 0, wouldStore: 0,
    artifactsStored: 0, artifactErrors: 0, artifactSkippedUnclaimed: 0, artifactsAlreadyPresent: 0,
    reportTypeCensus: {},
  };

  // Explicit bucket MUST match the read side (getLabs.js/getImaging.js:
  // 'prive-care-vip.firebasestorage.app'). A bare admin.storage().bucket() resolves
  // to the runtime default, which is NOT this bucket.
  const bucket = admin.storage().bucket('prive-care-vip.firebasestorage.app');

  const perPatient = [];
  const concurrency = Math.max(1, Math.min(10, Number(opts.concurrency) || 1));
  let cursor = 0;

  async function worker() {
    while (cursor < ids.length) {
      const id = ids[cursor++];

      // One checkpoint per id, whoever gets there first: the in-band call at the
      // end of backfillPatient (normal path) or the post-return call below
      // (skips, errors, budget timeouts). `fired` makes it idempotent so the run
      // doc is never written twice for the same id.
      let fired = false;
      const checkpoint = async (pc) => {
        if (fired || typeof opts.onPatientComplete !== 'function') return;
        fired = true;
        try {
          await withDeadline(
            opts.onPatientComplete(pc, counters),
            FIRESTORE_CALL_TIMEOUT_MS,
            'PATIENT_CHECKPOINT_TIMEOUT',
          );
        } catch (checkpointErr) {
          logError('backfillElationReports', 'patient-checkpoint-failed', checkpointErr, {
            elationPatientId: id,
          });
        }
      };

      // Mark the id in flight BEFORE any work, so a resume can see which id a
      // killed instance died on and abandon-and-advance instead of re-hanging.
      if (typeof opts.onPatientStart === 'function') {
        try {
          await withDeadline(
            opts.onPatientStart(id),
            FIRESTORE_CALL_TIMEOUT_MS,
            'PATIENT_START_TIMEOUT',
          );
        } catch (startErr) {
          logError('backfillElationReports', 'patient-start-checkpoint-failed', startErr, {
            elationPatientId: id,
          });
        }
      }

      // Last-resort ceiling: no single id may wedge a worker (and therefore the
      // whole run) past this budget. Anything that escapes the per-call deadlines
      // above surfaces here as a counted, logged patient failure — never a hang.
      let pc;
      try {
        pc = await withPatientDeadline(
          Date.now() + PATIENT_BUDGET_MS,
          () => withDeadline(
            backfillPatient(db, FieldValue, bucket, id, counters, { ...opts, _checkpoint: checkpoint }),
            PATIENT_BUDGET_MS,
            'PATIENT_BUDGET_EXCEEDED',
          ),
        );
      } catch (err) {
        counters.patientsErrored += 1;
        pc = { elationPatientId: id, errors: 1, timedOut: true, lastError: errBrief('patient-budget', err) };
        logError('backfillElationReports', 'patient-timed-out', err, { elationPatientId: id });
      }
      perPatient.push(pc);
      // No-op when backfillPatient already checkpointed in band.
      await checkpoint(pc);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));

  log('backfillElationReports', opts.dryRun ? 'dry-run-complete' : 'backfill-complete', {
    ...counters, reportTypeCensus: Object.keys(counters.reportTypeCensus).length,
  });
  return {
    counters,
    perPatient,
    reportTypeCensus: Object.values(counters.reportTypeCensus).sort((a, b) => b.count - a.count),
  };
}

module.exports = {
  backfillElationReports,
  listPatientReports,
  // Lets the HTTP wrapper break every pending Elation backoff at the
  // soft-budget / pause boundary instead of waiting out a 30s timer.
  abortElationBackoff,
  // exported for unit tests
  _isRetryableElationError: isRetryableElationError,
  _elationErrorFacts: elationErrorFacts,
  _withPatientDeadline: withPatientDeadline,
  _storedCopyIsCurrent: storedCopyIsCurrent,
  _categoryHasArtifact: categoryHasArtifact,
};
