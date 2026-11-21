# Fix plan: claim/account security issues #617–#619

## Review status and scope
- **Plan only: Claude reviews before coding.** No accounts, invitations, arming, merges or deployments.
- Main **`fba31386`** verified; #615 merged, no primary fix-site changes. Preserve its contract amendment.
- Confirmed sites: `functions/adminIssueInvite.js:116–144` (#617); `functions/claimAccount.js:233–255,338–355` (#618); `claimAccount.js:375–400` and `functions/core/services/patient/claimToken.js:169–185` (#619).
- Exclude discovery, auto-invite/AUTOSEND, schedules, wave gates, password/DOB policy, social settings, roster matching, record deletion and other findings.

## PR grouping and sequence
1. New portal feature branch from refreshed main: **#617 + #618 together**, PR with `Closes #617` and `Closes #618`.
2. Separate branch/PR for **#619**, `Closes #619`; base on PR 1 after merge or explicitly stack as dependent.
3. Each PR updates `plans/INTEGRATION-CONTRACT.md`, runs the full non-skipped `claim-hydration-gate` and new Auth/Firestore emulator tests.

## PR 1 / #617 — verified, true-case account reset
### Identity proof
- Target `patients/{patientId}`; delete by exact **authUid**, never lowercased firebaseUid. Require consistent, unique exact/normalized binding; reject privileged identities.
- Legacy firebaseUid-only: an email lookup discovers a candidate, **never authorizes deletion**. Require candidate UID normalization to equal the stored binding plus independent server-written patient-ID-linked binding evidence. Unknown/conflicting evidence → hold.
- `user-not-found` is sufficient only for the exact previously verified UID, confirmed absent by `getUser(uid)`; never for a guessed lowercase alias.

### Reset boundaries
1. Keep caller/reason and suppression-before-reset checks. Validate roster recipient before destructive work.
2. **Transaction R1:** re-read proof/binding; acquire patient-scoped reset operation with old exact UID and fencing ID. Keep binding intact; block competing claim/bind/reset.
3. Serialize reset with hydration acquisition. Running/unknown worker or Recovery ownership → `RESET_BUSY`, no delete/clear. Cancel queued old-identity work; stale events must exit without activating the patient or touching a replacement job. No broader hydration redesign.
4. **Auth outside transactions:** disable verified user, revoke refresh tokens, delete exact UID, confirm absence; save resumable checkpoints. Uncertainty retains binding/fence; no mint/send. Resume same operation.
5. **Transaction R2**, after verified absence and quiescence: recheck operation/binding; clear firebaseUid, authUid, boundAt, claim/verification timestamps and old claim-attempt provenance. Revoke old tokens; remove/cancel old-UID hydration job and this patient's unowned pending/queued recovery entries. Clear stale identity-scoped hydration markers. Preserve reset/audit history.
6. Preserve demographics, chart/storage identity, records, guardian relationships and portal suspension/visibility. Retain verified complete medical hydration; clear stale/failed/pending job state so new claim can queue.
7. Complete reset, then existing suppression/mint/send. Send failure revokes fresh link; never resurrect old Auth.

**Session limit:** issued ID tokens/file URLs may outlive deletion. Binding removal denies core reads; fence claim/binding/resolver during reset. No promise of project-wide instant logout; broader session changes excluded.

### Tests: real Auth + Firestore, synthetic only
- Mixed-case delete; lowercase decoy survives. Proven legacy fallback succeeds; email-only/wrong-patient/duplicate/privileged/unreadable proof holds.
- Revoke/delete/confirm faults retain binding; post-delete transaction failure resumes safely.
- Clear both UIDs/residue; fresh reclaim UID; records/settings unchanged.
- Running/queued/stale job and Recovery races cannot activate old identity or overwrite new job; other patients unaffected.
- Suppression prevents all deletion; verify Auth revocation state, not hosted-token semantics.

## PR 1 / #618 — prove ownership before orphan adoption
- `email-already-exists` does **not** establish an orphan. Require durable patient-ID-linked proof: exact patient.authUid or server-created prior claim provenance with exact UID/patient/operation. Candidate must match exact UID and unique binding; preserve existing transactional uniqueness/audit guards.
- Unrelated, unproven-disabled/privileged/unexpected, conflicting or unreadable identity → masked manual-reconciliation hold. No password change, bind, delete, hydration or session; mask other identity.
- Preserve proven orphan recovery. Completed same-UID claim remains login-only, with no password overwrite/replay session.
- New attempts preselect unpredictable Auth UID and persist patient-ID-linked creation intent **before** `createUser({uid,...})`, owned by a patient-scoped lease. Ambiguous create resumes via exact UID, never guessed email ownership. No stored passwords/raw tokens; unrelated collision holds.
- Re-read provenance/binding transactionally. Credential failure checkpoints same operation; never delete adopted user.
- **#617 interaction:** successful reset deletes old Auth and clears provenance; fresh claim creates a new account. Historical orphans lacking proof require reconciliation.

### Tests
- Unrelated email owner unchanged; owned orphan recovers; wrong-case/stale/reset/cross-patient proof holds.
- Create-before-bind crash resumes same UID; concurrency loser cannot overwrite/delete winner.
- Completed replay login-only; credential failure retry limited to proven operation.
- Reset → fresh claim → hydration → exact-UID own-record read.

## PR 2 / #619 — reserve before Auth, finalize before grant
Auth/Firestore cannot commit atomically. Use fenced, durable reservation, not early irreversible consumption.

### Exact transaction boundaries
1. Existing token/password/DOB/audit checks remain; preliminary token validation grants no rights.
2. **C1: reserve before Auth create/update.** Transaction rechecks server-time expiry, usedAt/revokedAt, patient and reset state; acquires single attempt ID/lease/fencing version and intended exact UID. Live competing reservation returns setup-in-progress. Reservation is not successful consumption; terminal tokens never reopen.
3. **Auth outside transactions:** new user starts disabled and unbound, preventing premature password/chart access. PR 1 provenance required; already usable identities are held, not disabled speculatively.
4. **C2: authorization commit.** Recheck reservation owner/version, live unrevoked/unexpired token, reset state and exact UID uniqueness. Atomically consume token (usedAt + claimedByAttempt), bind/audit and create durable hydration/recovery ownership, or recognize verified complete hydration. Transaction-aware helpers; no nested transactions or network/Auth in C2. Remove nonfatal post-account consumption.
5. After successful C2, enable account and mint true-case custom token; check reset/revocation state before delivery. Persist enable/mint completion checkpoints. Spent-token retries use login/password recovery, never replay sessions/password overwrite. Trusted recovery finishes enablement; no reopening; hydration durable.

**Claude decision: grant linearization.** C2 is the authorization boundary. Revoke/expiry **before C2** prevents grant; after C2 the invite is spent and account suspension/reset is the operational control. No final check eliminates the cross-service race. If expiry/revocation before *physical token delivery* must undo an already committed grant, broader session design needs approval before coding.

### Retry/release/revoke
- Pre-Auth failure: owner-checked release only while token remains live/unrevoked; never clear terminal markers or another reservation.
- Uncertain Auth create: retain exact-UID proof; resume or confirmed-delete only this operation's own disabled user. Unknown outcome cannot release to another creator.
- Crashed lease: successor recovers same UID with fencing; old worker cannot commit. Expiry is not proof of stopped execution.
- Revocation helper transactionally invalidates reserved attempts and unused tokens. Reissue never revives revoked attempt. Keep signatures/suppression/cooldown.
- Expired/revoked before C2: no binding, enablement, hydration or custom token; clean up only proven operation-created user. Unknown cleanup holds.

### Tests
- Used/revoked/expired/missing before C1: no Auth/binding/session.
- Revoke/expiry C1–C2 blocks; transaction races establish C2-first versus revoke-first.
- Concurrent/stale/delayed claims: one winner, no loser password/session.
- Crash/fault at reserve/create/C2/enable/mint: recoverable, no duplicates/unrelated deletion/replay/lost hydration.
- Release cannot revive terminal tokens; suppression/cooldown unchanged.
- Synthetic claim → correct UID → loading → hydrated own records; no synchronous hydration/15-second dependency.

## Contract, checks and approval
- Append reset proof/error/cleanup, orphan provenance/holds, reservation schema/states and grant/retry boundaries to integration contract; preserve historical amendments including #615. Correct only contradicted current statements, including nonfatal post-create consume.
- Backward compatibility: old valid tokens treated as unreserved; legacy identity without proof held. Internal attempt state client-denied and emulator-tested; no raw secrets persisted.
- Current gate launches **Firestore only**. Add Auth + Firestore lifecycle suites under `demo-*` with no production credentials; keep every existing queue/worker/Recovery/rules/C4 test. Units supplement emulators.
- Claude approves identity proof, reset/worker serialization, retry semantics and C2 boundary before coding. Each PR requires reviewed diff and full non-skipped hydration gate/relevant suites green.
- Hosted semantics need authorized isolated checks; no real-patient destructive tests. No code, PRs or deploy yet.
