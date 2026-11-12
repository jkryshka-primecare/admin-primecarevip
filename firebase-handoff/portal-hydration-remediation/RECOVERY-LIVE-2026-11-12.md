# Live Recovery and synthetic claim readiness

Read-only observations at approximately 01:34–01:39 UTC, November 12, 2026.

## Recovery: successful
- `config/hydrationRecovery`: enabled true, maxPerTick 1.
- `hydration_runs/hydration-recovery-standing`: complete, queued 0, pending 0, results 1 complete, consecutiveBlockedTicks 0, lease cleared.
- September deferred record `848387093037057` is now hydrationStatus complete; hydrationCompletedAt November 11 23:05:56.082 UTC, last source hydrationRecoveryDriver.
- Genuine drain-tick completion November 11 23:05:56.537 UTC: drove true, driven 1, completed 1, failed 0, remaining 0, stalled false. Execution about 104 seconds, status ok.
- Result: reportsOk true, lettersOk true; reports listed 44/stored 26/errors 0, with 18 records-deferred excluded; letters listed 40/stored 32/skippedDeleted 8/errors 0. One stranded token settled. This is the deployed completeness policy, not a promise that excluded Elation documents are shown.
- Recent genuine invocations November 12 00:16:04, 00:46:11, 01:16:11 UTC: ok true, NOTHING_OWED, eligible 0, queued 0; each execution finished status ok. Confirms observed 30-minute runtime cadence, not merely configured schedule.
- Full patient-state counts: 305 complete, 1301 unset; zero pending/deferred/failed.
- Function metadata: Driver ACTIVE v31 updated November 11 23:46:36.038 UTC; Tick ACTIVE v30 updated 23:46:39.331 UTC. Tick uses its hydrationRecoveryTick Pub/Sub schedule topic.
- Scheduler jobs listing denied 403; no independent job-settings read claimed. Logging and function metadata reads succeeded.

## Synthetic claim: blocked before changes
- Existing pinned disposable fixture: Test Kieffer, Elation chart `816455979040769`, DOB `1980-02-28`.
- Exact chart-ID Elation GET confirms synthetic name/DOB; report list returns 8, letter list returns 24 of which 16 marked deleted. Does not independently inspect signed/displayable status or every PDF.
- Portal roster is active, already bound with authUid/firebaseUid, hydration complete, contact info@primecarevip.com. This is NOT an unclaimed-ready fixture.
- Other test roster documents are guardian/minor synthetic IDs, not eligible adult Elation chart fixtures.
- Existing fixture Auth lookup returns auth/insufficient-permission. Project testIamPermissions returned no granted requested datastore mutation, Auth get/delete/create or function-invoke permissions.
- No reset script executed; no Auth deletion, roster mutation, token mint, invitation send/reissue, upstream write, config change or deployment attempted.
- Required next step: authorized operator provisions/reset only this independently verified synthetic fixture using the owning portal's governed path, with a controlled test recipient or securely delivered single-use link. Avoid manual clearing of bindings while a live Auth account remains. Preserve append-only audit and validate current durable jobs/recovery state. Do not reuse an old claimed link or impersonate a real member.
- Link unavailable; no raw claim/custom tokens, passwords, service credentials or patient names beyond the confirmed synthetic fixture are stored here.

Wave-one certification remains held for the owner-operated live unclaimed invite → authenticated session → loading → records walkthrough; Recovery proof itself passed.