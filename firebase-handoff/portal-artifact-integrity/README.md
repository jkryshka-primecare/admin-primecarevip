# Release 2a — artifact integrity handoff

Five pieces for the Firebase repo. Everything here is storage-and-audit only: no
`portalAccess` writes, no identity changes, no re-keying (that is 2b).

```text
functions/auditArtifactCoverage.js                 A — nightly coverage audit (read-only)
functions/sweepArtifactRepairs.js                  B — nightly bounded self-heal
functions/core/services/artifacts/repairQueue.js   C — server-derived on-miss enqueue
functions/core/services/artifacts/readArtifact.js  E — THE shared read path (Option A)
test/redteam/artifact-ownership.test.js            D — permanent CI gate
```

**Read-path decision (Option A).** The suite imports one shared
`handleArtifactRead`; it now exists in this bundle, and the nine patient read
functions must be refactored to call it. Scope, per-handler mapping, and the
mandatory mutation check are in `REFACTOR-READ-PATH.md` — read that first.


## A — `auditArtifactCoverage`

Scheduled nightly plus an admin-callable on-demand run. Walks every document
reference with `hasArtifact: true` and checks the object exists in Storage.

Writes one report per run to `artifact_coverage_reports/{runId}`:

```js
{
  generatedAt, scope: 'referenced',
  totalReferenced, presentCount, missingCount, coveragePct,
  missing: [{ patientId, documentId, path, firstSeenAt, failures, parked }]
}
```

**Deploy registration (review item 1).** `adminRunArtifactAudit` is an HTTP
admin function, so it must be wired into the guards we already built:

- add it to `ADMIN_FUNCTIONS` in `portal-iam-hardening/lock-admin-invokers.yml`
  (done in this handoff);
- exclude it from **both** health-gate `FUNCTIONS=( … )` arrays in
  `deploy-production.yml` — it is IAM-restricted, so an anonymous probe gets a
  403 and would fail the gate;
- export it **inside** `module.exports` in `index.js` (the Step-1 export trap).

The two scheduled functions are pub/sub, have no URL, and need none of this.

**Timeout and batching (review item 2).** Both entry points run with
`timeoutSeconds: 540`. Existence checks run in `Promise.all` chunks of 50 rather
than one awaited HEAD per document, and the report carries `truncatedWalk: true`
when the walk hits `MAX_DOCS`, so a partial walk can never read as complete
coverage. The on-demand path (review item 6) claims the run, returns `202`
immediately, and the admin UI polls the report instead of holding the request
open for a full corpus walk.

**Unpathed documents (review item 4).** A `hasArtifact: true` doc with neither
`artifactPath` nor `firebaseUid` used to resolve to a literal
`elation-artifacts/null/…` path — a false miss the sweep would "heal" by writing
junk under `null/`. Such docs are now classified `unpathed`: counted and listed
separately, excluded from the coverage denominator, and never queued for repair.

**Scope is deliberately narrow.** This proves "no dangling 404s among referenced
documents". It does NOT prove "we hold everything Elation has" — that is the
Elation-exit bar and a 2b question. The admin UI labels the number accordingly.

**The report is PHI.** It carries patient ids, document ids and paths. Firestore
rules must deny all client reads; it is exposed to staff only through the
Prime Care OS `firestore-bridge`, which is role-gated and writes `phi_access_log`
on every read, including the CSV export.

## B — `sweepArtifactRepairs`

Primary healer. Nightly, bounded, and the only path that normally repairs
anything.

- `BATCH_LIMIT` documents per run — the run ends with work remaining rather than
  running long.
- Single-flight lease in `artifact_repair_state/lock` with an expiry; a second
  concurrent run exits.
- Per-document idempotent marking (`repairedAt` on the queue row) so a re-run
  skips finished work.
- Circuit breaker: `402/403` from upstream pauses the whole job in
  `artifact_repair_state/status`; every entry point reads that row first and
  exits while paused, processing at most one probe item per run.
- Transient upstream (`429`, `5xx`) **ends the run immediately** and does not
  increment the failure count (review item 5), so a throttling Elation is backed
  off rather than hammered, and documents that were only temporarily
  unavailable are never permanently parked or alerted on.
- Binary fetch goes through the shared client's verified `getBinary` export
  (review item 3). The client exposes no `fetchDocumentPdf`; the sweep defines a
  thin local helper over `getBinary` so a method-name mismatch cannot park the
  whole queue.
- After `MAX_FAILURES`, a document is parked and raises an integration-health
  alert instead of retrying forever.

**Healing is storage-only.** It never touches `portalAccess`. A healed artifact
that belongs to a hidden item or a suspended patient stays unreadable — the read
path suppresses, and the red-team asserts it.

## C — `repairQueue` (on-miss backstop)

Rare backstop for a miss the sweep has not reached yet.

- The read path calls `enqueueRepair(ctx, documentId)` and immediately returns a
  `preparing` state to the member. No Elation round-trip on the hot path, so a
  slow Elation degrades to a calm message.
- **The owning patient id comes from `ctx` — the server-side authenticated read
  context — and never from client input.** The function signature accepts no
  caller-supplied patient id. This is the design rule that makes the "queue
  cannot fetch another patient's document" red-team case pass.
- Dedup key is `${patientId}:${documentId}`, not the document id alone.

## D — Red-team suite

Standing CI gate, run on every PR, not a one-off pass. **Split into two files by
blast radius** (review round 2, item 3):

```text
test/redteam/bucket-privacy.test.js        READ-ONLY  — may target the production bucket
test/redteam/artifact-ownership.test.js    STATEFUL   — emulator / test project ONLY
test/redteam/helpers/env.js                target guard, refuses production writes
test/redteam/helpers/storage.js            real bucket, flattened object ACL entries
test/redteam/helpers/seed.js               patient handles with suspend/hideItem/queue rows
test/redteam/helpers/portalRead.js         production read handler, real patient tokens
```

Cases:

1. **Bucket privacy is asserted, not assumed** — no `allUsers` binding, uniform
   bucket-level access on, no public object ACLs. If a guessed path is ever
   directly fetchable, ownership-at-read is moot.
2. Cross-patient path guessing returns 403 with no signed URL minted.
3. Stale and replayed signed URLs are rejected.
4. Suspended patient gets 403 and hidden items stay hidden **immediately after a
   heal** — healing is never a side channel that un-hides or un-suspends.
5. The repair queue cannot be pointed at another patient's document.
6. **Per-collection suppression matrix** — hiding under `labs`, `imaging` and
   `documents` each read as 404 through the wrapper that serves that
   collection, and hiding one collection does not suppress another. The gate is
   driven through the wrapper shape production uses, not a default `documents`
   call (review round 3).

Grant/guardian cases (revoked grant, guardian-expanded allowed-id sets) are
present as **`test.skip` forward scaffolding for 2b**. They must not report green
and must not gate 2a.

### Helper API — reconciled with the suite

Round 1 shipped helpers whose signatures did not match the test, so the suite
could not have run green. The API is now exactly what the tests call:

| Helper | Shape |
| --- | --- |
| `seedPatient()` | returns a handle: `{ patientId, firebaseUid, token, suspend(), hideItem({collection,id}), repairQueueRows() }` |
| `seedDocument(patient, { missingObject, hidden, collection })` | accepts the handle; `collection` defaults to `labs` and governs both the reference and the hidden flag; `missingObject: true` deletes the object so the miss is real; returns `{ patientId, documentId, path, bucket, collection }` |
| `readArtifact({ as, doc \| documentId, collection?, wrapper?, body })` | drives the matching production wrapper (collection pinned, 300s TTL); returns `{ status, wrapper, collection, body, signedUrl, elapsedMs }` |
| `mintSignedUrl({ as, documentId, ttlSeconds })` | mints through the production read path |
| `healArtifact(doc)` | takes the `seedDocument` result, which now carries `patientId` |
| `listObjectAcls({ sample })` | returns **flattened** `{ name, entity, role }` entries (or `{ aclDenied: true }` under UBLA) so the public-ACL filter is no longer vacuous |

### Running it

```bash
# read-only privacy gate — safe against the production bucket
REDTEAM_STORAGE_BUCKET=<serving-bucket> npm run test:redteam:readonly

# stateful gate — emulator (preferred) or a dedicated test project
FIRESTORE_EMULATOR_HOST=localhost:8080 \
FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 \
REDTEAM_ALLOW_WRITES=1 REDTEAM_PROJECT_ID=<test-project> \
REDTEAM_STORAGE_BUCKET=<test-bucket> REDTEAM_WEB_API_KEY=<test-web-key> \
npm run test:redteam
```

`helpers/env.js` hard-fails if the stateful target resolves to `prive-care-vip`
or to a bucket whose name starts with it, and if neither the emulator nor
`REDTEAM_TARGET=test-project` is declared. Nothing is inferred; a missing
declaration aborts rather than defaulting to prod.

**Mutation check before this counts as a gate.** Make the bucket public, or
short-circuit the ownership check in `readArtifact.js`, run the suite, and
confirm it goes **red**; then revert and confirm green. A gate nobody has
watched fail is not yet a gate.


## 2a exit criteria

- Coverage 100% on the **referenced** set.
- Sweep proven on a deliberately seeded miss.
- Red-team green, including the privacy assertion and the post-heal suppression
  case.
- Zero active **adult** Hint members without a portal record, with minors,
  `NO_MATCH` and `AMBIGUOUS_MATCH` published as tracked, intentional exceptions —
  not counted as failures.

## Sweep self-check (companion to minor-ingest §2c)

`sweepArtifactRepairs.repairOne` now downloads back what it just saved and
requires a `%PDF-` magic prefix before writing `repairedAt`. On mismatch the
object is deleted (`ignoreNotFound`) and `ARTIFACT_NOT_PDF` is thrown with no
`.status`, so it falls through to the existing `failures++` path and parks +
alerts after `MAX_FAILURES`.

Why it is required: minor-ingest §2c routes corrupt-bytes cases into the
audit → sweep heal loop. Without validation here the sweep would re-fetch the
same corrupt bytes, save them, mark healed, and the next audit would count the
object present — the gate reads 100% over a corrupt artifact. Must land before
`auditArtifactCoverage` is used as the go/no-go gate.
