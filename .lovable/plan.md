# #619 — reserve before creation; authorize atomically at C2

**Claude review first; no code/branch/PR/merge/deploy/arming now.**

## Scope and verified baseline

Baseline: portal main `44b97be05542ef5865e6e1b734a58aa622b8831d` includes #621. Owner reports deployed; not independently audited. Issue read 403; supplied scope used.

After Claude approval: `fix/claim-token-reservation-619` off current main; PR **Closes #619**. Preserve #617/#618 proof/UID/holds/reset/409/deferral. No discovery/auto-invite/wave/config/suppression/age/social changes.

Fix sites under functions/: claimAccount.js:124–134,235–269,294–303,323–381; core/services/patient/accountLifecycle.js:7–32,54–97; bindMember.js:49–100; claimToken.js:169–186; adminRevokeInvite.js:27–53,88–110. Creation currently enabled, late consume non-fatal. Full workflow: .github/workflows/claim-hydration-gate.yml:56–82.

## Locked boundary

**C1 reserves; C2 atomically binds and spends.** Revoke/expiry before C2 blocks authorization. If C2 wins first, the token is spent; suspend/reset is the control afterward. No project-wide session kill, post-C2 undo, unconsume, bind rollback or winner deletion.

Sequence: **verification → C1 → disabled account → C2 → credentials/enable → mint**. Auth and Firestore are not atomic. Reservation precedes creation; consumption at C2 requires exact existing account.

## Technical design

### Metadata and retry authority

Use existing accountWork/identityGeneration/claimAccountIntent plus server-only token reservation (attempt/owner/generation/UID/checkpoint). Phases reserved → account_ready → committed → credentials_ready → enabled → complete; release/invalidation pre-C2; uncertain work held. No client secret/Hub/mobile changes/new lock/password persistence.

**Only original invocation's acknowledged first C2 commit + still-live matching ownership permits mint.** Local eligibility starts false; retry/receipt-read/reacquisition/idempotent C2 NEVER restores it. EVERY spent resume/ack recovery returns {uid,loginToken:null}, zero mint; Hub sign-in fallback unchanged.

Resume requires exact C2 receipt/binding/generation/existing verification. Revoked usedAt without claim receipt stays INVALID_TOKEN. Finish only safe acknowledged checkpoints: no replay password/reset/create/bind/grant. Completed revisit 409/sign-in. Client-proof proposals belong in a separate Hub/mobile-coordinated issue.

### C1 — reserve after existing verification

Keep password/DOB throttle/audit checks. C1 reads token/patient/uniqueness after #621 acquisition: correct patient, unused/unrevoked, expiresAt > fresh now per retry; assertWork owner/generation/no reset, unchanged inputs/guards. Same server attempt idempotent; healthy loser 409, uncertainty held. Spent receipt continuation never enters fresh C1/create/mint.

Atomically persist reservation/preselected UID intent. No usedAt/bind/credential mutation/create/enable/mint before C1. Rejected C1 releases only quiescent work.

### C1–C2 — prepare without granting

Reuse #621 provenance/uniqueness/provider checks; explicit invite-only staging leaves non-invite callers unchanged. New Auth account uses disabled:true and submitted password; acknowledge exact existence/disabled state under owner/generation. Disabled recovery requires exact patient intent, never email adoption. Safely stage only a proven enabled orphan disabled; unrelated/completed accounts untouched. Unknown create/disable retains existing fence/hold, not a universal logout promise. Preserve adopted-password-after-bind: no adopted credential overwrite before C2. Late create after revoke/expiry remains disabled.

### C2 — authorization within bindMember

Invite-only optional context; non-claim paths unchanged. Read patient/token/reservation/uniqueness before writes. Require owner/generation/UID/attempt, no reset, account-ready, unchanged inputs/bind guards. Recheck unused/unrevoked/live reservation/patient/strict expiry against fresh now EVERY retry; missing/malformed fails closed.

Atomically commit true-case authUid, normalized firebaseUid, write-once boundAt, existing binding audit, token usedAt + consumed attempt/UID/generation and committed receipt/intent. Remove late best-effort consume. Abort writes neither bind nor claim spend. Lost acknowledgment requires exact receipt read-back; uncertainty holds, no success assumption/deletion.

### After C2 — finish, do not reauthorize

Original invocation updates adopted password after disabled bind (#618 holds preserved). Confirm ready/enable with owner/generation/reset/access fences; no invite reauthorization. Spent resume NEVER mutates password; incomplete adopted credentials stay held.

Keep enqueue-before-response/finishing/Recovery/deferral. Mint requires confirmed enable + original live ownership. ALL spent resumes/ack recovery/known mint failure: loginToken:null; no password/spend/mint replay.

## Release/recovery: do not trap the member

- Settled pre-C2 failure: transactionally release only matching reservation/checkpoints/work. Release never writes usedAt or erases revoke. Live retry reuses proven disabled UID; no speculative orphan deletion.
- Created account/C2 denied: retain disabled UID evidence for safe reuse/reconciliation; revoked/expired links require newly authorized invite, never revival.
- Crash/non-canceling deadline: retain work and durable checkpoint/review deadline in existing portalAccountReconciliation. Deadline/Auth read is not quiescence or takeover permission.
- No admin-resume op: settled retries self-heal without mint; crashed/uncertain work stays reconciled, never lease-stealing. resumeReset unchanged.
- Pre-C2 retry rechecks live token; post-C2 uses exact receipt/credentials-ready, never unconsume/unbind/delete/mint. Missing account/unfinished adopted credentials/unknown mutation retains #618 hold: fail-closed exception to self-healing, never replay password.

Consumed claims always have exact existing account plus atomic binding. Interrupted enablement remains completable, not a token spent before creation.

## adminRevokeInvite

Replace query-outside/batch with transaction reading patient and matching token query. Include unused live tokens AND active pre-C2 reservations even if expiry elapsed. Recheck used/committed state; write existing usedAt/revokedAt/revokedBy/revokeReason and invalidate matching reservation/intent atomically. Never clear work, bump generation, mutate Auth or undo C2. C2-first → skip spent claim; revoke-first → C2 rejects. Count once, repeats idempotent; transaction limits/errors → existing REVOKE_FAILED, never partial success.

Preserve admin auth/audience/validation, response {ok, elationPatientId, revoked}, invite_revoked audit/best-effort audit failure and shared callers’ suppression-first/gate/cap/pacing behavior. Endpoint currently has no suppression lookup: invent none.

### Shared compatibility verified

- revokeLiveTokens retains (patientId,actor,reason) → NUMBER; admin endpoint retains {ok,elationPatientId,revoked}/invite_revoked audit. adminIssueInvite:97–114,144–149 suppression then revoke; adminBatchReissue:196–211 preflight then same helper (new_invite skips revoke). Runner:134–139 calls batch endpoint. Preserve failure-before-send, gates/cap/pacing/report.
- bindMember absent optional invite context: no token access/mutation/error/result change; script keeps args. Social uses Session.link (socialSignIn.js:237–269), not historical header’s bindMember; leave untouched. No new claim identity writer.

## Tests and INTEGRATION-CONTRACT

Add real Auth+Firestore claim-reservation.emulator.test.cjs exercising claim/revoke handlers with synthetic external adapters and deterministic barriers. Assert actual Auth/password-disabled refusal/custom-token exchange, durable token/bind/intent/audit/work:
- Used/revoked/expired/missing before C1 and exact expiry equality: generic rejection; zero create/bind/enable/mint.
- Revoke/expiry C1–C2, including pending create: no grant, late account disabled. C2-first then revoke/expiry: committed finishing, no undo.
- Double-use/two tokens/patient/wrong receipt/generation: one grant, healthy 409/no extra UID. ALL spent resumes: loginToken:null, zero mint/exchange; original acknowledged C2 owner alone mints.
- Crashes reserve/create-before-ack/account-ready: no spend/bind; exact retry or hold, no lease stealing.
- C2 abort/ack loss/immediate crash: atomic bind+spend or neither; receipt read-back, existing disabled account resumable.
- Credential/enable crash/ack loss: exact UID/hold; replay never changes password including credential_pending. Ready enable resumes with loginToken:null.
- Mint failure/after-mint crash: no second consume/destruction/password rewrite; known failure sign-in fallback.
- Release/revoke/spent retry/late execution: no revival/successor alteration/mint privilege; no new admin-resume.
- Rules/suppression/audit/errors/healthy concurrency/deferral unchanged. Test 3 revoke callers/count/envelope/audit/firstInvite/failure-before-send; omitted bind context causes no token access/mutation; script/social regressions.

Full claim-hydration-gate: queue/modified-worker/Recovery/drain units; hydration-rules/batch-reissue/invite-wave emulator suites; unchanged Auth+Firestore lifecycle plus new reservation suite. Preserve workflow/job name and docs-only predicate. Run affected token/binding/sender tests and full social regression gate for shared helpers. Report head SHA/hosted URLs/real executed steps: docs-only green is insufficient. No tests claimed run now.

Append #619 INTEGRATION-CONTRACT amendment: C1/C2/server reservation/disabled staging/bind+spend, original-only mint/null on ALL spent resumes/no replay password or client/admin op, release/holds, revoke-before versus suspend/reset-after, shared contracts/full gate. Preserve history/numbering.

**Next:** Claude review; then recheck main, Closes #619 PR/diff/full gate evidence. No merge/deploy/arming.
