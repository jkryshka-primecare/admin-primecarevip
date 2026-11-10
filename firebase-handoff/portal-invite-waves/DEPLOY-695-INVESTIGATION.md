# Production run #695 — investigation, 2026-11-10

## Status

Root cause remains unverified: Google Cloud diagnostic reads returned HTTP 403 using `lovable-portal-readonly@prive-care-vip.iam.gserviceaccount.com`. No redeploy, source repair, sends, flag changes, IAM changes or Auth trigger registration performed.

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

- Logging `entries:list`: `Permission denied for all log views`.
- Regional/global Cloud Build history: caller permission denied.
- Cloud Functions list/operations list and individual get for driver, webhook and reissue: corresponding permission denied.
- Cloud Run service/revisions reads: corresponding permission denied; additionally, the driver is confirmed gen1 by source and deploy output.

## Required read-only access

Grant this investigation identity project-level `roles/logging.viewer`, `roles/cloudfunctions.viewer`, and `roles/cloudbuild.builds.viewer`. No Editor/runtime write permission is needed. Add narrowly scoped build-log object access only if the referenced build logs are stored in a private Cloud Storage bucket and the subsequent read specifically fails there.

Once granted: retrieve the gen1 function metadata and failed operations; resolve the function build ID and build error; read function startup/platform logs for 19:58–20:30 UTC; compare old/new source/build/config; verify webhook and reissue `updateTime` and source provenance. Present a confirmed root cause and proposed repair before deployment. Keep all wave approvals/domain-prep gates and flags unchanged.