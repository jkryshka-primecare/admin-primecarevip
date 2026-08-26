# Adult report backfill — build steps 1–2 (2026-08-26)

Status: **built, not run.** Steps 3–8 of the agreed sequence are unchanged and
start with the dry run.

## 1. Wrapper + runner changes (in this folder)

### `functions/backfillElationReportsHttp.js`

| Field | Default | Effect |
| --- | --- | --- |
| `cohort` | `'minors'` | `'adults'` swaps the partition (see below). Minor card behaviour is byte-identical when absent. |
| `apply` | `false` | Dry run unless explicitly `true`. `super_admin` + non-empty `reason` still enforced upstream; the wrapper now also hard-rejects an apply with an empty `reason`. |
| `skipExisting` | `false` | Passed to the runner. |
| `storeMedicalRecords` | unset (env decides) | `true` for this job. |
| `excludeReportTypes` | `[]` | Post-census type exclusions; dropped before the audit row and the store. |
| `concurrency` / `chunkSize` | `5` / `40` | Per the review. |
| `runId` | minted | Re-POST the same id to **resume**. |
| `action: 'status'` | — | Polls `backfill_runs/{runId}`. |

**Adults partition:** doc must exist → `!isMinorRecord` → soft-adult rule
(`status` absent proceeds; explicit non-active rejects). Rejection reasons:
`NO_PATIENT_DOC`, `IS_A_MINOR`, `NOT_ACTIVE`.
**Minors partition:** unchanged (`NO_PATIENT_DOC`, `NOT_A_MINOR`, plus the
`ingestEligibility` reason).

**Async protocol:** apply claims `backfill_runs/{runId}` (pending = eligible ids),
returns **202** with the runId, then works server-side. Every completed id is
removed from `pending` and added to `completed` **before** the next id starts, so a
540s instance kill resumes exactly at the next id. A second apply while
`status === 'running'` returns **409 RUN_IN_PROGRESS**.

**Dry run is synchronous** and does no writes and no PHI re-fetch — it reads the
report *stub* list plus the existing `labs/{reportId}` docs. It returns
`eligible / wouldIngest / alreadyStored / skippedUnsigned / skippedDeleted /
skippedNotAllowlisted / skippedRecordsDeferred` and **`reportTypeCensus`**
(`reportType`, `count`, mapped `category`, `subCategory`, `unmappedType`),
descending by count.

### `functions/backfillElationReports.js`

* `options.skipExisting` — checks `labs/{reportId}` **before** the re-fetch (against
  the stub) and again against the full body: skip when the doc exists, is not
  deleted, and `updatedAt >= last_modified || signed_date || document_date`.
  Unknown timestamps count as stale (re-store) — never the reverse.
  Artifacts: `file.exists()` + ranged `%PDF-` check before any Elation fetch.
* **Streamed PDF** — uses `elationClient.getBinaryStream()` piped into
  `file.createWriteStream()` when the shared client exposes it, else falls back to
  the buffered `getBinary`. Either way the request carries its **own**
  `ARTIFACT_FETCH_TIMEOUT_MS` (default 120000, `ELATION_ARTIFACT_TIMEOUT_MS`),
  separate from the JSON budget.
  > If `getBinaryStream` does not exist on the shared client yet, add it there —
  > the fallback works but keeps the 16MB buffer in memory.
* **Ranged verify** — first 8 bytes via `createReadStream({start:0,end:7})`
  replaces the full `download()`. Failure path unchanged: delete the partial,
  leave `hasArtifact: true`.
* **MR artifacts** — the upload condition is now
  `lab | imaging | (medical_records && MR storing enabled)`. Required so MR docs
  do not land `hasArtifact:true` with no object.
* `options.concurrency` (bounded 1–10) + `options.onPatientComplete` checkpoint hook.
* `options.dryRun` and `options.excludeReportTypes`.
* Every new option is opt-in: with no `options` argument the runner behaves exactly
  as the minor track did.

New counters: `alreadyStored`, `wouldStore`, `artifactsAlreadyPresent`,
`skippedExcludedType`, `reportTypeCensus`.

## 2. Allowlist inversion — `ELATION_INGEST_ALLOWLIST`

`reportIngest.js` lives in the Firebase repo, not here. Apply this to
`functions/core/services/elation/ingest/reportIngest.js`:

```js
// D-068 containment. Ingest reads its OWN list so the backfill can cover patients
// the READ path is not yet widened to; falls back to the read list when unset, so
// existing deploys are unchanged.
function allowlistIds() {
  const raw = process.env.ELATION_INGEST_ALLOWLIST || process.env.ELATION_READ_ALLOWLIST || '';
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
}

function isIngestAllowed(elationPatientId) {
  if (process.env.ELATION_FULL_SYNC_ENABLED === 'true') return true;
  return allowlistIds().has(String(elationPatientId));
}
```

Keep `isReadAllowed` (or whatever the read path calls) reading
**`ELATION_READ_ALLOWLIST` only** — the inversion must not widen reads.

**Confirmed: the poller honours it.** `ingestElationReports.js` imports
`isIngestAllowed` from this same module and calls it per feed record
(`skip-not-allowlisted`). Changing the helper covers the backfill **and** ongoing
delta ingest — the newly-covered adults keep receiving new reports. No other gate
is involved on the ingest side.

Set for this job:

* `ELATION_INGEST_ALLOWLIST` = **960 active-adult ids ∪ 174 minor ids** (the minors
  must stay in, or the poller drops them).
* `ELATION_READ_ALLOWLIST` stays at 937 until coverage passes (step 7).
* `ELATION_STORE_MEDICAL_RECORDS = 'true'`.
* `ELATION_FULL_SYNC_ENABLED` stays **off** — note the helper above short-circuits
  on it, so flipping it would silently bypass both lists.

Bind on **both** `backfillElationReports` (HTTP) and `ingestElationReports`
(scheduler). Verify before the first apply:

```
gcloud functions describe backfillElationReports --region us-central1 \
  --format='value(serviceConfig.secretEnvironmentVariables,serviceConfig.environmentVariables)'
gcloud functions describe ingestElationReports --region us-central1 \
  --format='value(serviceConfig.secretEnvironmentVariables,serviceConfig.environmentVariables)'
```

## Next (not built here)

3. Dry run over all ~972 → validate totals + census.
4. Census review checkpoint (Michael) — exclusions go into `excludeReportTypes`.
5. Apply in chunks to completion.
6. Re-baseline coverage on the ingest denominator.
7. Widen `ELATION_READ_ALLOWLIST` by the A−B delta (~197), lockstep on both functions.
8. `ELATION_FULL_SYNC_ENABLED` stays off. Then DNS.
