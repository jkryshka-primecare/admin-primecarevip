# PR1 account-security review (#617 + #618)

Review-only diff, not imported into Prime Care OS. Portal PR: https://github.com/primecarevip/prime-care-vip-app-v2/pull/621

- Branch: `fix/claim-account-security-617-618-20261121`
- Base: `fba31386d265cca38f53c1c36308f14fa72a9fab`
- Commit: `5433d027b245662437390a6c108b5fffa51fabb2`
- Read-only count at 2026-11-21T15:20:47Z: **0** legacy firebaseUid-without-authUid docs among **1,625** patients. No backfill needed or performed.
- Local isolated results: 26 Auth+Firestore lifecycle tests; 39 existing Firestore gate tests; 11 hydration unit tests; 13 additional Node regression tests, all passed. Includes fresh synthetic password sign-in, exact-UID record resolution, and durable hydration worker flow; email/Elation integrations remain isolated adapters, not hosted certification.
- Gate name and docs-only predicate remain byte unchanged; contract history, adminRevokeInvite, #619 token service and #615 discovery implementation unchanged.
- Independent final read-only security review approved with no concrete high blockers.
- Auth uncertainty and non-cancelling nested report deadlines retain patient ownership. Unknown ownership is intentionally not recovered by lease age; operator reconciliation requires independent quiescence/identity proof.
- Masked reconciliation queue is admin-read/server-write only; RESET_BUSY is explicit.
- No merge, deployment, arming, production cleanup/backfill or invitations. PR2 #619 waits for PR1 merge and separate work.

Review `pr1-review.patch` or GitHub Files changed. Apply through owning portal PR only; do not apply to this admin app.
