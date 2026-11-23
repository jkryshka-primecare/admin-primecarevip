# Pipeline reliability first; discovery retention second

## Review boundary

Two separate owner-filed issues and feature-branch PRs in `primecarevip/prime-care-vip-app-v2`. Claude reviews before implementation. Workstream A goes first. Workstream B is a **design proposal only**, with a separate approval before code; approving A does not authorize B implementation.

No merge, deployment, arming, invitations, production provisioning, eligibility changes, security/reset changes, AUTOSEND changes, nudge release, or readiness-counter start. Preserve #615/#624 and #617/#618/#619. No changes to the Prime Care OS application are proposed.

Reviewed portal main: `a9f8d2dc034c6b1440633c53ec267194e73c5acf`. Refresh main at each implementation boundary.

## Workstream A — deployment pipeline reliability

**Proposed issue title:** “Make deployment snapshots fail loudly and always re-lock admin invokers; upgrade Node-20 Actions.”

**Proposed branch:** `fix/deploy-pipeline-reliability`; one CI-only PR with the real owner-created `Closes #N`.

### Verified findings

- `.github/workflows/deploy-production.yml` sets `GOOGLE_APPLICATION_CREDENTIALS` before the snapshot but does not explicitly authenticate gcloud there. Explicit `gcloud auth activate-service-account` occurs later, in the invoker-lock step.
- Snapshot code disables errexit, discards describe stderr, ignores its exit status, and substitutes `MISSING` for every empty result. It cannot distinguish absent functions from authentication, permission, project, region, generation, or CLI failures.
- Actual logs for #707 (`44653232405`), #708 (`44925965685`), and #710 attempt 2 (`45054437814`) show all 18 snapshot functions as `MISSING`, despite subsequent successful updates. Logs identify sampled `getPatient`/`getAllergies` as 1st Gen in `us-central1`. Historical gcloud stderr was suppressed, so the exact historical error is unrecoverable from those logs; authentication is a concrete code defect, not a proven exclusive cause.
- The invoker-lock step has no `if` condition, so normal Actions success gating skips it after an earlier failure. The post-deploy health gate already uses `if: always()`.
- Deployment currently uses checkout v5 and setup-node v4. The reviewed claim-hydration and discovery workflows use checkout/setup-node/setup-java v4. The repository has 13 workflow files to inventory.

### Proposed changes

1. **Authenticated, reliable pre-deploy snapshot**
   - Authenticate gcloud explicitly using the existing production service identity before reads; validate the selected project against the intended deployment project and set explicit region/generation scope.
   - Obtain a complete, successful function inventory covering the appropriate Gen1/Gen2 surfaces, then match the existing gate list by function name, project, region, and generation. Do not guess generation from an empty result or blindly add `--gen2`.
   - Preserve command stderr and inspect every exit status. Authentication/permission/CLI/API failures, malformed JSON, incomplete inventory, unexpected project, or absent timestamp on an existing function fail the step loudly. No partial snapshot is accepted as a baseline.
   - Only a function genuinely absent from a successful correctly scoped inventory may be labeled `MISSING`, allowing first-time functions. Include generation and status in diagnostic evidence while preserving or explicitly adapting the existing before/after comparison format.
   - Reuse the same authenticated identity and generation selection for the post-deploy timestamp read. Keep unchanged-timestamp visibility report-only under the existing D-071/Option-2 contract; do not silently turn no-op releases into failures.

2. **Invoker re-lock independent of deploy success**
   - Add `if: always()` to the existing lock step within the serialized deployment job. Re-establish its own credentials/project and retain the same admin-function inventory, allowed service identity, binding operations, and policy checks.
   - A failed deploy remains failed. The lock runs after a partial failure, continues through individual function failures, and fails visibly if any endpoint cannot be verified private. Do not add `continue-on-error` or broaden IAM grants.
   - This guarantees the step is scheduled after normal step failures, not execution after runner loss or an externally cancelled job. Keep deployment serialization unchanged.

3. **Actions upgrades only**
   - Inventory all 13 workflows and replace remaining Node-20-based checkout/setup-node/setup-java references with compatible Node-24-based releases: checkout v5, setup-node v5, setup-java v5, verifying upstream release/runtime metadata at implementation.
   - Preserve already-upgraded references and all action inputs, workflow triggers, permissions, job names, Node application version 22, Java 17, package versions, test commands, caches, and deploy targets. No application dependency upgrades.

### Runtime/deploy behavior boundary

The deployed function code, runtime versions, environment contents, targets/codebases, deploy order, retry policy, text-scan failure detection, health probes, and intended invoker policy remain unchanged. Intentional orchestration changes are: diagnostic read errors now block a trusted release, and the existing re-lock control runs even after deployment failure. It would be inaccurate to claim absolutely no pipeline behavior changes.

### Acceptance and evidence

- Credential-free command-harness tests: valid Gen1/Gen2 inventories, genuinely missing function, failed authentication, denied read, wrong project/region, malformed/empty metadata, partial inventory, and unchanged versus changed timestamp comparison.
- Workflow/command harness simulates partial deploy failure: the lock still runs for every admin function; deployment failure remains visible; lock failure also remains visible. No production deploy or IAM mutation used for testing.
- Validate workflow syntax, action runtime compatibility, inventory consistency, and an allowed-diff check proving runtime/deploy inputs unchanged.
- Full actual hosted `claim-hydration-gate` on the PR head, not a trivial skipped pass. This PR changes that workflow through the Actions upgrade, so its current relevance predicate should select real execution; verify the decision and every real step. Include queue/worker/Recovery/drain, C4/rules, Auth+Firestore lifecycle/reservation/age suites, with final SHA and run/job links. Run relevant remaining CI including discovery and social regressions.
- Append a scoped deployment-contract amendment to `plans/INTEGRATION-CONTRACT.md`; preserve historical content and numbering.
- Return exact diff, owner issue number, head SHA, hosted evidence, and runtime-boundary comparison before merge. No deployment is needed or authorized to prove this PR.

## Workstream B — durable discovery retention (design only)

**Proposed issue title:** “Retain discovery dry-run and OVER_CAP candidates without cold-start loss or cursor skips.”

**Proposed later branch:** `fix/discovery-pending-candidates`, off then-current main after Workstream A’s separate review/disposition. Its own owner-created issue/PR and approval.

### Verified findings

- `rosterDiscovery.js: resolveSince` uses `now − 7 days` when no valid cursor exists; existing cursors use a 10-minute overlap.
- `rosterDiscoveryTick.js` writes dry-run reports, but no cursor; `would_create` candidates and `OVER_CAP` deferrals are not a durable work queue.
- After a live run, cursor advancement checks hard failures and retryable skips, but not `deferredOverCap`; `computeNextCursor` uses fetched timestamps/run start, not unresolved-candidate boundaries.
- Existing controls include per-practice flags, cap default 50/hard ceiling 500, bounded Elation delta pages, #615 age exclusion, shared pre-creation checks, and create-only `DOC_EXISTS` behavior. Preserve these functions and their eligibility/order.
- Fresh read-only check: `patients/1399946260185089` is absent. Its Elation chart exists, is not deleted, and has `last_modified=2026-11-12T15:42:00Z`. Retained practice reports identify it as `would_create / ELIGIBLE` through November 19. This confirms a bounded historical recovery source; it does not certify current eligibility.

### Proposed durable state

- Per-practice discovery state gains a versioned **cold-start anchor**, distinct from the provisioning cursor. Persist the initial seven-day floor once; never move it forward just because another dry run occurred. Existing valid live cursors are not reset or moved backward.
- A per-practice pending collection keyed by exact Elation patient ID retains `WOULD_CREATE`, `OVER_CAP`, retryable failures, and interrupted writes. Store IDs, first/last observation, observed modification time, source-run provenance, state/reason, bounded retry/lease metadata; no credentials or copied name/email/DOB payloads.
- Dry runs may write this discovery bookkeeping and reports only—never patient docs, Auth, tokens, mail, or live-readiness counts. This is an explicit change to the dry-run state contract for review, not an accidental write hidden as “read-only.” Environment-off ticks still write nothing; pending retention does not override any live gate.

### Discovery and drain protocol

1. Acquire a per-practice transactional lease/generation so scheduled/manual overlapping ticks cannot race progress. This is discovery ownership only; do not reuse or alter claim/reset ownership.
2. Use the existing delta filter and page ceiling. Cold start begins at the fixed initial seven-day floor, not the start of the roster. Do not fetch the full roster, widen the floor backward, or call the backlog provisioner.
3. Durably retain every eligible not-yet-provisioned observation before allowing progress. Pending writes fail closed; existing best-effort reports cannot serve as the durability boundary. Define a separate bounded fetch checkpoint if needed for paging, never mislabel it as completed provisioning.
4. Drain a bounded, deterministic oldest-first selection combined with the current delta, deduplicated by chart ID. Re-fetch pending charts by exact ID and re-run unchanged deletion/practice checks, #615/#624 DOB/age policy, batch duplicate context, and `evaluateNewMember` membership/identity checks. Pending state is not eligibility proof. Uncertain checks stay pending; terminal ineligibility is reported/held with its existing reason and is not created.
5. One total per-practice provisioning budget applies across pending and fresh candidates, preserving the current configured/hard cap. Use the existing create-only patient write. Concurrent creation becomes `DOC_EXISTS` and settles safely; no overwrite or duplicate account creation.
6. Settle pending work only after confirmed patient creation or confirmed `DOC_EXISTS`, or an explicit recorded terminal eligibility decision. Crash after creation but before settlement recovers through `DOC_EXISTS`. Lease expiry alone never certifies work completion; transaction fences reject stale owners.
7. **Provisioning cursor never crosses unresolved deferred work.** Hold advancement while unresolved deferred/failed/retryable candidates remain; release only after settlement. Durable IDs also survive a historical observation older than an already-established cursor without rewinding it. Truncated/unsorted pages cannot advance past an unread tail; conservatively retain the old cursor without demonstrated ordered completeness.

### Bounds and overload behavior

- Keep existing delta page/provision limits. Proposed pending capacity: 500 active entries per practice; proposed per-run pending chart refresh limit: at most 50 and never more than the effective creation cap. These are design values for review, not live settings changes.
- Capacity exhaustion, exhausted execution budget, or failed persistence must retain the cursor/anchor/checkpoint and produce a visible blocked report—never silently drop candidates or expire unresolved work. Do not evict pending work merely because its chart goes quiet.
- Avoid full-collection pending reads: bounded indexed state queries, deterministic ordering, and counts. Compaction/TTL applies only to settled bookkeeping, never unresolved candidates or historical patient/account records. Specify any new indexes and client-denied/admin-read schema in the contract before implementation.
- Do not redefine or start `liveRunCount`; pending/dry/retry work must not count as clean live creation runs. Preserve the existing interlock contract and operational hold.

### Cynthia recovery, without a roster rescan

The new mechanism cannot rediscover an already-aged-off chart solely from today’s seven-day delta. Propose an explicit, bounded bootstrap from retained discovery-report IDs (`would_create` and `OVER_CAP`), with preview and separate owner execution approval. No automatic bulk replay on deployment.

`1399946260185089` is demonstrably present in that source and would enter pending retention, then be fetched by exact chart ID regardless of its old modification date. Current eligibility must pass all unchanged checks before a later approved live creation; no invite. Do not assume the abbreviated `1399246085` identifier in the brief is the same record without verifying its source relationship. Cynthia remains untouched during design/review.

### Required future tests and contract amendment

- Cold-start floor remains fixed across more than seven days of dry runs; candidate remains available for a later live run.
- Cap+1 and multi-run backlogs drain without starvation, duplicates, or cursor crossing deferred work; equal timestamps, unsorted/truncated pages, and new arrivals covered.
- Crashes before/after pending persistence, before/after create, before settlement, and during cursor transaction; concurrent ticks, expired/stale leases, queue saturation and transient Elation/Hint/Auth/Firestore failures.
- Eligibility changes after observation: inactive membership, minor/unknown DOB, explicit dependent-minor, deleted/merged/wrong-practice chart, duplicate/shared email, existing login/roster. Preserve canonical reasons and create-only behavior; recheck combined pending/fresh batch conflicts.
- Synthetic fixture with Cynthia’s observed modification boundary and retained-report provenance: picked up beyond seven days, current eligibility rechecked, at most one patient doc, zero tokens/emails. No real-patient execution for acceptance.
- Real Auth+Firestore discovery emulator suite plus full actual hosted claim-hydration-gate, including #617/#618/#619 lifecycle/reservation and #615/#624 age regressions, on the exact eventual head SHA. No no-op gate used as evidence.
- Amend `INTEGRATION-CONTRACT.md` for dry-run bookkeeping, pending ownership/state/index rules, cursor semantics, report additions, bootstrap approval, and readiness compatibility. Preserve old report fields/consumers or provide an explicit additive versioned transition.

## Next approval

Claude reviews A’s implementation scope and B’s design separately. Owner supplies actual issue numbers at code time. No issues, branches, PRs, source changes, live settings, or patient writes have been created by this planning pass; no hosted test execution is claimed yet.