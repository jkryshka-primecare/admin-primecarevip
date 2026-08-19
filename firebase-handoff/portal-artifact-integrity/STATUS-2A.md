# Release 2a — status of record (2026-08-19)

Reconciled with the repo agent after the merge of PR #421 (`release-2a/centralize-artifact-read`)
and the lockfile follow-up PR #422. Lovable's GitHub token is Actions-blind (403 on workflow runs),
so the runtime evidence below comes from the repo agent, not from a read of `main`.

## Coverage measurement (2026-08-19)

First trustworthy run: **94.1%** — 1,262 / 1,341 referenced artifacts present, 79 genuinely
missing, `erroredCount: 0`, `status: ok`, `truncatedWalk: false`. Unblocked by granting
`roles/storage.objectAdmin` to `prive-care-vip@appspot.gserviceaccount.com` scoped to
`prive-care-vip.firebasestorage.app` (project Editor mapped only to `storage.legacyBucketOwner`,
a bucket-level role — hence `ls` worked and `objects.get` 403'd). Error classification (#430) is
merged and deployed; probes now resolve present/absent/error and errors never enter the queue.

## Closed


- **Code on `main`** — verified file by file: `readArtifact.js`, `repairQueue.js`, the three
  delegating wrappers (`!wantArtifact` list guard, audit-first `phi_access_log`, module pinned,
  `ttlSeconds: 300` hardcoded), `auditArtifactCoverage.js` + `sweepArtifactRepairs.js` registered in
  `index.js`, `adminRunArtifactAudit` in `ADMIN_FUNCTIONS`, `redteam.yml` with the bucket-prefix and
  prod-SA fixes, `package.json` / `helpers/env.js` test wiring.
- **Red-team gate** — stateful suite green (14 passed, 4 skipped) under
  `emulators:exec --only auth,firestore,storage`. Mutation performed: planted hole → RED → revert → green.
- **`REDTEAM_WEB_API_KEY`** — set (dummy value; the Auth emulator ignores it on custom-token exchange).
- **Production deploy** — green end to end. All six admin functions expose
  `serviceAccount:portal-admin@prive-care-vip.iam.gserviceaccount.com` as the only invoker,
  unauthenticated → 403. `getLabs` remains public by design.

## Deferred to the portal cutover gate

- **Live read-path smoke** on the Test Kieffer fixture (real lab PDF 200 + signed URL, hidden → 404,
  suspended → 403, plus one imaging and one medical-record artifact). The refactored functions are
  deployed but not yet live-serving; `care.primecarevip.com` is still the pre-Lovable portal.
- **Member-UI behavior changes — Lovable owns this.** See `mem://portal-artifact-contract`:
  300s TTL (re-request on expiry) and `{ state: 'preparing' }` rendered as a preparing state, not an
  error. Both must be handled before cutover.

## Open, owned by the repo agent

- **First audit/sweep observation.** Trigger `adminRunArtifactAudit` (or wait for the 03:15 schedule),
  read `artifact_coverage_reports/{runId}` for `coveragePct`, `totalReferenced`, `missing`,
  `truncatedWalk`; then let `sweepArtifactRepairs` run once and confirm the on-miss queue drains.

## Correction to carry into 2b

Do **not** use the step-6a reference-ownership check as a mutation target expecting RED — the
`category` match (5b) and the uid-scoped Storage path independently block cross-patient reads, so the
suite stays green. That also means the reference check is not independently covered. 2b follow-up:
add a case that seeds patient B's object under B's uid and points patient A's reference at it.

## Remaining for 2a (2026-08-19)

1. **Red-team green on `main`** — PR #432 (replaces #429, whose branch conflicts post-#428):
   `initOnce()` only sets `credential` when the emulator key was minted, else falls back to ADC.
   Merge, then confirm the `push`-event run: bucket-privacy 3/3 + stateful green.
2. **Sweep outcome on the 79** — record `healed` vs `blocked/deferred` per reason. The queue write
   is capped at 500/run and the walk at 50,000 docs; 79 < 500, so no tail this cycle. Re-run the
   audit after the sweep and expect coverage to climb with `missingCount` falling.
3. **Residual misses are a data question, not a code one** — any that stay missing after two sweeps
   are artifacts Elation never produced. Classify them (deleted at source / never generated /
   wrong-path legacy) before cutover; a member opening one gets `{ state: 'preparing' }`, which is
   correct behavior but a bad experience if it is permanent.
4. **Live read-path smoke** on the Test Kieffer fixture — real lab PDF 200 + signed URL, hidden 404,
   suspended 403, plus one imaging and one medical-record artifact. Now genuinely runnable since the
   SA can `objects.get`.
5. **Member-UI contract** (`mem://portal-artifact-contract`) — 300s TTL re-request, `preparing`
   rendered as a state not an error, absence never shown as forbidden. Lovable owns this at cutover.

Not in 2a: **re-keying storage off `firebaseUid` onto an internal UUID.** Hold for 2b. Doing it now
would invalidate every path the 94.1% number was just measured against and require a full copy +
backfill of 1,341 objects on the eve of cutover, for zero cutover-blocking benefit. 2b can migrate
behind `artifactPath` (already honored first by `expectedPath`), which makes it a per-doc, resumable
cutover rather than a big-bang re-key.

The failed "Deploy to Production" run on the `audit: never conflate...` commit is explained: a **409
concurrency collision**, not a health/IAM probe. Two Deploy runs (the commit push and the merge)
raced to update the 2nd-gen `ingestElationReports` / `elationEventTarget`; the loser got
`409 unable to queue the operation` and failed after one retry. The merge deploy succeeded and the
live audit returned the new fields (`erroredCount`, `status`, `errorStatusCounts`), so prod is
correct. Fixed by PR #434 — `concurrency: { group: deploy-production, cancel-in-progress: false }`
in `deploy-production.yml`, so back-to-back merges serialize instead of racing.

