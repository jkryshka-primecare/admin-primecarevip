# Release 2a — artifact integrity handoff

Four pieces for the Firebase repo. Everything here is storage-and-audit only: no
`portalAccess` writes, no identity changes, no re-keying (that is 2b).

```text
functions/auditArtifactCoverage.js                 A — nightly coverage audit (read-only)
functions/sweepArtifactRepairs.js                  B — nightly bounded self-heal
functions/core/services/artifacts/repairQueue.js   C — server-derived on-miss enqueue
test/redteam/artifact-ownership.test.js            D — permanent CI gate
```

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

Standing CI gate, run on every PR, not a one-off pass. Cases:

1. **Bucket privacy is asserted, not assumed** — no `allUsers` binding, uniform
   bucket-level access on, no public object ACLs. If a guessed path is ever
   directly fetchable, ownership-at-read is moot.
2. Cross-patient path guessing returns 403 with no signed URL minted.
3. Stale and replayed signed URLs are rejected.
4. Suspended patient gets 403 and hidden items stay hidden **immediately after a
   heal** — healing is never a side channel that un-hides or un-suspends.
5. The repair queue cannot be pointed at another patient's document.

Grant/guardian cases (revoked grant, guardian-expanded allowed-id sets) are
present as **`test.skip` forward scaffolding for 2b**. They must not report green
and must not gate 2a.

## 2a exit criteria

- Coverage 100% on the **referenced** set.
- Sweep proven on a deliberately seeded miss.
- Red-team green, including the privacy assertion and the post-heal suppression
  case.
- Zero active **adult** Hint members without a portal record, with minors,
  `NO_MATCH` and `AMBIGUOUS_MATCH` published as tracked, intentional exceptions —
  not counted as failures.
