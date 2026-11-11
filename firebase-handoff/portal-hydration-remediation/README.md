# Hydration remediation — review only, wave one held

## Status as of 2026-11-11 22:33 UTC
- Production deploy #697 completed successfully at 21:36:34 UTC. This does not independently certify Driver version or scheduler runtime.
- Current diagnostic service identity remains `lovable-portal-readonly@prive-care-vip.iam.gserviceaccount.com`. Function metadata returns `cloudfunctions.functions.get` denied; Logging returns permission denied for all log views. Re-grant Cloud Functions Viewer and Logging Viewer at the production project. Cloud Build Viewer is optional for later build failures, not required to enable Recovery.
- GitHub issue creation was attempted and denied HTTP 403. No issue number or PR has been created for this work. Draft issue: **Decouple invite activation from durable hydration; certify Recovery before invite wave one**. Do not merge these drafts without the sprint issue and owning-project CI.
- No production config, member binding, token, email, IAM, trigger registration, or social flag changed. Nicholas was not re-invited and no member session was impersonated.

## Review patches
- `portal-review.patch` is against deployed portal commit `7c571f1df46349d6dcf5c05f59abe5e375eb5b89`. It adds a patient-ID keyed `claim_hydration_jobs` worker, commits loading state and recovery ownership atomically with the job before returning the session, and keeps the existing awaited report/letter runner in a durable trigger invocation. The HTTP function never starts fire-and-forget hydration.
- Worker leases reject overlapping deliveries; terminal records do not restart. Fresh pending workers are filtered out of the scheduled safety-net queue to avoid a worker/recovery race. The shared terminal completeness rule and `accessGate.js` are unchanged.
- Social path B keeps its existing awaited path: no social authentication change bundled into the invite repair.
- `hub-review.patch` is against My Health Hub `588242c4`. It uses the server-issued custom token after successful claim, renders the authenticated portal shell with a records-loading section, keeps polling pending/deferred without expiring into an activation error, and raises claim transport timeout to 210 seconds as a compatibility floor while the worker is rolled out. Other calls retain 15 seconds. Subject identity and PHI acknowledgment gates remain intact.
- These are staged source proposals, not owning-project changes or deployed fixes. Apply Hub changes through the owning My Health Hub chat. The source-only tests are not hosted claim/recovery certification.

## Recovery enabling configuration for Michael
This is **not a secret, environment variable or Doppler value**. In the production default Firestore database create/merge:

```json
// Document: config/hydrationRecovery
{"enabled": true, "maxPerTick": 1}
```

Start at one admitted member per tick while verifying the September backlog. The existing schedule is every 30 minutes UTC. This enables hydration only, not invitations. Roll back by setting `enabled:false`; this does not cancel work already running. Do not reset/erase the standing queue or lease. Verify scheduler target, invocations, checkpoint progression, report and letter completeness, and empty outstanding queue before raising the cap. No configuration was applied here.

## Refreshed read-only cohort
Current denominator: **1,036 active Hint members**. Portal buckets: hydrated 272; claimed setup fix 1; expired invite 500; live invite 3; never invited 163; no account 97. Match by stored Hint ID or unique name+DOB only; email is contact validation, never a patient locator. Ambiguous identity is held.

Non-hydrated candidates: **764**. Mutually exclusive review segments: 500 syntax/domain-approved adult accounts (497 expired, 3 currently live); 66 no-account adults held; 195 minors held; 1 age-review hold; 1 adult correction; 1 claimed setup fix. Suppression segment zero. Across candidates there are 2 syntax/domain corrections and 1 risky address; those overlap held segments and must not be added to segment counts. Existing live links still require an explicit reissue decision; eligible does not mean approved to send. All wave/domain preparation and guardian/no-account holds remain.

Files in Files contain only ID-keyed lists except correction/suppression imports, which necessarily contain contact addresses for team review. No imports applied. DNS checks prove domain mail routing, not mailbox existence or deliverability.

## Nicholas and real end-to-end gate
Patient-ID audit query succeeded but the first bounded 100 rows were historical `name_disclosed_beetexting`, not an attributable activation attempt. Existing roster evidence still shows no bound UID and expired historical links. No proof of his exact timeout, password failure, or orphan state exists from this query. After logs/Auth access and fixes, reissue through the governed patient-ID path; Nicholas must operate his own DOB/password/session. Do not collect his password or certify using a staff session looking at his records.

Require owning-project emulator/CI coverage for claim commit, queue failure, retries/concurrent delivery, complete versus reports-only, and denial/ownership. Add explicit deny-client-read/write Firestore rules for `claim_hydration_jobs` and emulator tests before merge (default deny alone is not the release gate). Validate no-blocker entrypoint check. Hosted gates: normal authorized claim -> true-case session -> reports and letters/artifact reads; isolated forced slow/deferred chart -> Recovery -> complete -> UI read-back. These remain pending.

## Social flag discrepancy (separate track)
Fresh reads: master and default practice enabled; exactly one enabled default-practice staff target. Deployed `staffAccess` requires a signed-in, enabled Auth account, enabled master/practice and an exact-UID enabled staff target. Completion transaction rechecks staff/practice. Source remains staff-gated, not broadly open; live Auth/provider/triggers and callables were not independently certified. No available change log identifies actor/time that enabled flags. Recommend restoring master `enabled:false` to match the recorded hold until intentional staff testing is documented; do not silently change it or triggers.

## Tests executed
New queue/worker and domain precheck tests, existing hydration recovery and scheduled-drain decision tests. These verify source behavior with synthetic fixtures, not live charts, Cloud scheduling, delivery or member login.