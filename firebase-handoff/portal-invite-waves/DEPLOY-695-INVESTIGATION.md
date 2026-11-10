# Production run #695 — investigation, 2026-11-10

## Status

Read-only function/build/log access succeeded after the temporary grants. Confirmed failure boundary: the gen1 update operation stalled after a successful build, the automatic retry was refused because that operation was still running, and the original operation ended with code 10 `Operation interrupted.` GCP exposes no deeper reason in the accessible logs; a startup crash or specific application defect is **not established**. No redeploy, source repair, sends, flag changes, IAM changes or Auth trigger registration performed.

## Verified evidence

- Run #695 deployed commit `1f910aa4b0390d657e8e7175147f6079b2cdec11`, parent `d1deacf6ff3c34feb6d55bef328891fa79ca2c40`. The job ran 19:57:18–20:29:24 UTC. Firebase deploy step ran 19:58:02–20:29:09 UTC and failed; admin invoker locking was skipped.
- Firebase explicitly identifies `hydrationRecoveryDriver` as **Node.js 22, 1st Gen**. Source imports `firebase-functions` and uses `runWith(...).https.onRequest`, not the v2 API. Therefore a gen2 Cloud Run service/revision is not the established resource to investigate; start with Cloud Functions gen1 operation errors, function logs and its build ID.
- First attempt reports `Task index 0 failed: timed out after 1500000ms.` The automatic retry reports the driver failed again. The entire deploy step lasted approximately 31 minutes, not two full 25-minute windows; the logs do not establish a second full-duration timeout.
- The first and retry outputs both contain `sendgridEventWebhook ... Successful update operation.` Retry also contains `adminBatchReissue ... Successful update operation.` These are strong deployment-success evidence from the run, despite stale failure lines elsewhere in the summary. Output is buffered: log timestamps around 20:25:24 and 20:29:09 are **not** authoritative function `updateTime` values.
- The runner is `functions/scripts/invite-wave-runner.js`, an operator-run Node script, not an independently deployed Cloud Function. Its source is merged at `1f910aa`; it has no Cloud Function last-deployed timestamp. Live sends would call `adminBatchReissue`, whose updated `inviteOne`/`sendInviteEmail` code is included in the function source bundle. No script execution performed.
- #595 changes nine files: three email/invite services, the new wave helper/script/test, webhook test and two contract documents. It does **not** change `hydrationRecoveryDriver.js`, the functions entrypoint, deployment workflow, dependency manifests or lockfiles. A shared dependency change introduced by this PR is ruled out; rebuild-time dependency/platform drift or a pre-existing configuration defect is not yet established.
- Run #694, on the parent commit, concluded success. That alone does not certify this driver's prior update, since successful workflows can skip unchanged functions.
- Post-deploy health checks got JSON HTTP 401 responses from 18 listed read/messaging functions. They did not test the webhook, driver or reissue function. All recorded updateTime entries were `MISSING` both before and after; this cannot certify release freshness or meaningful unchanged timestamps.

## Direct GCP read results

### Follow-up after grants, 21:25 UTC request

- Driver failed update: accepted at **20:00:23.705 UTC**, intended version **25**. Build `e12846c5-a7c3-45f6-98b5-8dd27acb3395` succeeded at **20:00:17.544 UTC**; complete build logs contain fetch success, dependency-install completion, `node --check index.js`, all steps complete and `DONE`. This build is shared with backfillElationReports; the driver's operation metadata explicitly references it. There is no build error.
- At **20:27:44.066 UTC**, automatic retry failed with code **9**: `An operation on function hydrationRecoveryDriver in region us-central1 in project prive-care-vip is already in progress. Please try again later.` It did not create a second build or a second 25-minute rollout.
- Original operation completed at **20:30:24 UTC** with code **10**, `Operation interrupted.` Its final metadata is available, but contains no detailed infrastructure/startup cause. The operation is now done, not still holding an in-progress lock.
- Exhaustive driver-name function/startup search for Nov 9–10 and broader incident-window search returned audit records only, **no runtime startup crash/stack trace**. Build status SUCCESS does not prove the function started; absent startup logs do not prove absence of a crash.
- Driver remains **ACTIVE, version 24**, last updated **2026-11-09T20:32:34.757Z**. Its prior successful update took approximately 22 seconds (20:32:12–20:32:34 UTC); a Nov 9 earlier update also succeeded. This is not evidence of a longstanding broken application revision.
- Webhook is **ACTIVE, version 4**, last updated **2026-11-10T20:28:38.890Z** (**15:28:38.890 New York**). Its live build `17ff33b3-0036-42d4-b807-b9482dcedaa5` succeeded at 20:27:33.949 UTC. Both webhook update operations have successful final audit records; latest completes 20:28:39.059 UTC. Live `firebase-functions-hash` `15e28703e6485b9873f67913deb102fe40640d8d` equals both #695 update requests. Those requests use the same first/retry uploaded source objects as run #695. This confirms #695's webhook release landed via deployment metadata/audit provenance.
- `adminBatchReissue` is **ACTIVE, version 23**, last updated **2026-11-10T20:28:48.047Z**. Runner remains a merged operator script; nothing executed.
- Direct source download (`cloudfunctions.functions.sourceCodeGet`) and build source-object read both returned **403**. Thus deployment provenance is verified, but independent byte-level inspection of deployed `portal_invite` logic and a signed event-to-Firestore acceptance test remain unperformed. Do not mistake release provenance for functional feed certification.
- #595 introduced no dependency/lockfile or hydration-source change. Old/new builds use the same Node.js runtime and builder release identifiers. Evidence points to an interrupted **post-build control-plane update**, but does not establish why it stalled. No speculative dependency/runtime patch is justified.

### Initial reads before grants

- Logging `entries:list`: `Permission denied for all log views`.
- Regional/global Cloud Build history: caller permission denied.
- Cloud Functions list/operations list and individual get for driver, webhook and reissue: corresponding permission denied.
- Cloud Run service/revisions reads: corresponding permission denied; additionally, the driver is confirmed gen1 by source and deploy output.

## Required read-only access

Grant this investigation identity project-level `roles/logging.viewer`, `roles/cloudfunctions.viewer`, and `roles/cloudbuild.builds.viewer`. No Editor/runtime write permission is needed. Add narrowly scoped build-log object access only if the referenced build logs are stored in a private Cloud Storage bucket and the subsequent read specifically fails there.

Function metadata, operation and build/log reads are now complete. Deeper platform interruption cause remains unavailable in these records. Optional narrowly scoped source-code/object read would allow independent byte comparison, not necessarily expose the control-plane reason. Keep redeployment held pending owner review of these findings; no startup-crash fix or blind retry is justified. Keep wave gates and flags unchanged. The owner may revoke the temporary diagnostic grants after reviewing the captured evidence.