# PR1 account-security review (#617 + #618)

Review-only diff, not imported into Prime Care OS. Portal PR: https://github.com/primecarevip/prime-care-vip-app-v2/pull/621

- Branch: `fix/claim-account-security-617-618-20261121`
- Base: `fba31386d265cca38f53c1c36308f14fa72a9fab`
- Core-approved commit: `1ae3367369298ce19c2a703d0bb5d612bdb566c6`
- Read-only count at 2026-11-21T15:20:47Z: **0** legacy firebaseUid-without-authUid docs among **1,625** patients. No backfill needed or performed.
- Local isolated results: 26 Auth+Firestore lifecycle tests; 39 existing Firestore gate tests; 11 hydration unit tests; 13 additional Node regression tests, all passed. Includes fresh synthetic password sign-in, exact-UID record resolution, and durable hydration worker flow; email/Elation integrations remain isolated adapters, not hosted certification.
- Gate name and docs-only predicate remain byte unchanged; contract history, adminRevokeInvite, #619 token service and #615 discovery implementation unchanged.
- Independent final read-only security review approved with no concrete high blockers.
- Auth uncertainty and non-cancelling nested report deadlines retain patient ownership. Unknown ownership is intentionally not recovered by lease age; operator reconciliation requires independent quiescence/identity proof.
- Masked reconciliation queue is admin-read/server-write only; RESET_BUSY is explicit.
- No merge, deployment, arming, production cleanup/backfill or invitations. PR2 #619 waits for PR1 merge and separate work.

Review `pr1-review.patch` or GitHub Files changed. Apply through owning portal PR only; do not apply to this admin app.

Final hosted `claim-hydration-gate` passed on the head above: https://github.com/primecarevip/prime-care-vip-app-v2/actions/runs/44920131876

Sender safety local rerun: 18/18; suppression-first error precedence preserved. No completed hosted workflow failures at final check.

## Approved-core follow-up (2026-11-21)

- Head: `98b4a1c3954f9d5235dcd1802952ece47b946344`, same feature branch; no merge/deploy/arming.
- R1 creates a reset-in-progress admin queue signal atomically; R2 completes/reset done synchronously. Authenticated adminIssueInvite `resumeReset:true` is patient-scoped reset-only and sends/mints nothing; repeated completed resume cannot touch a successor.
- Exact completed claim loser returns409 sign-in; fresh live claim returns409 in-progress, no false reconciliation. Genuine unknown ownership remains held.
- Normal soft deferral awaits bounded real-work drain; settled deferral is queued for Recovery without reconciliation. Drain timeout/nested non-cancelling mutation deadline is genuine uncertainty and retains ownership.
- Production read-only: master social enabled=false; default practice=true; five deployed callables ACTIVE. Deployed, not enabled for users. No settings changed.
- Full local hydration: modified worker/queue/Recovery/drain units11/11; existing C4/rules39/39; lifecycle29/29. Full local social:15 nonce/no-mutation/deployment tests plus27 real Auth+Firestore+Functions cases, including lifecycle fences/generation and existing callable flows. Sender18/18.
- New follow-up independent security review: approve, no concrete high blockers. Hosted final evidence follows.
- adminRevokeInvite, token service/consumption, gate workflow and Recovery decision helper remain byte unchanged. #619 waits for PR1 merge.

Final follow-up hosted gates GREEN on `98b4a1c3954f9d5235dcd1802952ece47b946344`:
- claim-hydration-gate: https://github.com/primecarevip/prime-care-vip-app-v2/actions/runs/44922627234
- social-signin-gate: https://github.com/primecarevip/prime-care-vip-app-v2/actions/runs/44922627275
