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

