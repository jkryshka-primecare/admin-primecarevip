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

Extend existing patient `accountWork`/`identityGeneration`/`claimAccountIntent`; matching reservation on `claimTokens/{hash}` stores attempt, owner, generation, exact UID, proof hash, phase/timestamps. No new lock or reservation collection. Phases: reserved → account_ready → committed → credentials_ready → enabled → complete; pre-C2 release/invalidation; uncertainty retains masked reconciliation. usedAt stays null until C2, except existing admin-revoke spent markers.

Spent invite + DOB or attempt ID alone cannot authorize password reset/re-enable. Proposed #619-only Hub transport: random 32-byte attempt secret generated before first request, retained in origin-scoped session storage and sent on retries; persist only hash bound at C1 to patient/token/generation/UID. No secrets in URLs/logs; no stored passwords/raw invite/custom tokens.

Resume requires proof plus existing verification. Completed attempt → 409/sign-in, never password overwrite or repeated mint. Missing proof → sign-in if complete, masked support if incomplete. Initial used-token validation must distinguish proof-authorized continuation from forbidden fresh replay.

Claude must review owning Hub request/retry compatibility before proof enforcement. Preserve `{uid, loginToken}`/errors; no redesign/publication.

### C1 — reserve after existing verification

Keep password policy, token-keyed DOB throttle/audit-first checks. Preliminary validation is not authorization. Acquire #621 work; C1 reads token/patient/required uniqueness evidence before writes. Require correct patient, unused/unrevoked, expiresAt > fresh now on each retry; assertWork owner/generation/no running reset; unchanged verification inputs/existing guards. Same proven attempt idempotent; healthy competitors 409, uncertain work masked hold.

Atomically persist reservation/preselected UID intent. No usedAt/bind/credential mutation/create/enable/mint before C1. Rejected C1 releases only quiescent work.

### C1–C2 — prepare without granting

Reuse #621 provenance/uniqueness/provider checks; explicit invite-only staging leaves non-invite callers unchanged. New Auth account uses disabled:true and submitted password; acknowledge exact existence/disabled state under owner/generation. Disabled recovery requires exact patient intent, never email adoption. Safely stage only a proven enabled orphan disabled; unrelated/completed accounts untouched. Unknown create/disable retains existing fence/hold, not a universal logout promise. Preserve adopted-password-after-bind: no adopted credential overwrite before C2. Late create after revoke/expiry remains disabled.

### C2 — authorization within bindMember

Invite-only transaction context; normal/script/social paths unchanged. Read patient/token/reservation and exact/normalized uniqueness before writes. Require same owner/generation/proof/UID/attempt, no running reset, acknowledged account-ready, unchanged verification inputs and existing bind guards. Recheck unused/unrevoked/live reservation/correct patient/strict expiry against fresh now on EVERY transaction retry; missing/malformed fails closed.

Atomically commit true-case authUid, normalized firebaseUid, write-once boundAt, existing binding audit, token usedAt + consumed attempt/UID/generation and committed receipt/intent. Remove late best-effort consume. Abort writes neither bind nor claim spend. Lost acknowledgment requires exact receipt read-back; uncertainty holds, no success assumption/deletion.

### After C2 — finish, do not reauthorize

Retain ownership. Adopted password update occurs after bind while disabled, preserving #618 masked credential-uncertainty. Acknowledge credentials-ready, enable exact UID, confirm, finalize intent; check ownership/generation/reset/access fences before mutation/mint, not invitation expiry/revoke again.

Durable hydration enqueue still precedes session response; preserve finishing errors, post-claim/Recovery and settled soft-deferral behavior. Mint only after C2/confirmed enable. Known mint failure retains loginToken:null sign-in fallback. Completed retries never overwrite passwords or spend/mint again.

## Release/recovery: do not trap the member

- Settled pre-C2 failure: transactionally release only matching reservation/checkpoints/work. Release never writes usedAt or erases revoke. Live retry reuses proven disabled UID; no speculative orphan deletion.
- Created account/C2 denied: retain disabled UID evidence for safe reuse/reconciliation; revoked/expired links require newly authorized invite, never revival.
- Crash/non-canceling deadline: retain work and durable checkpoint/review deadline in existing portalAccountReconciliation. Deadline/Auth read is not quiescence or takeover permission.
- #619-only authenticated admin resume, separate from resumeReset: patient ID/exact receipt, release/reassign only after verified old invocation termination AND settled operations; otherwise visible busy/hold. Reset semantics unchanged.
- Proof-bearing continuation finishes only known-settled work. Pre-C2 rechecks live token; post-C2 uses exact committed receipt, never unconsume/unbind/delete. Missing account or unknown credential mutation stays masked #618 hold; no substitute UID or completed-password overwrite.

Consumed claims always have exact existing account plus atomic binding. Interrupted enablement remains completable, not a token spent before creation.

## adminRevokeInvite

Replace query-outside/batch with transaction reading patient and matching token query. Include unused live tokens AND active pre-C2 reservations even if expiry elapsed. Recheck used/committed state; write existing usedAt/revokedAt/revokedBy/revokeReason and invalidate matching reservation/intent atomically. Never clear work, bump generation, mutate Auth or undo C2. C2-first → skip spent claim; revoke-first → C2 rejects. Count once, repeats idempotent; transaction limits/errors → existing REVOKE_FAILED, never partial success.

Preserve admin auth/audience/validation, response {ok, elationPatientId, revoked}, invite_revoked audit/best-effort audit failure and shared callers’ suppression-first/gate/cap/pacing behavior. Endpoint currently has no suppression lookup: invent none.

## Tests and INTEGRATION-CONTRACT

Add real Auth+Firestore claim-reservation.emulator.test.cjs exercising claim/revoke handlers with synthetic external adapters and deterministic barriers. Assert actual Auth/password-disabled refusal/custom-token exchange, durable token/bind/intent/audit/work:
- Used/revoked/expired/missing before C1 and exact expiry equality: generic rejection; zero create/bind/enable/mint.
- Revoke/expiry C1–C2, including pending create: no grant, late account disabled. C2-first then revoke/expiry: committed finishing, no undo.
- Double-use/same patient different tokens/wrong proof or patient/stale generation: one grant; healthy 409 losers; no extra UID/password overwrite.
- Crashes reserve/create-before-ack/account-ready: no spend/bind; exact retry or hold, no lease stealing.
- C2 abort/ack loss/immediate crash: atomic bind+spend or neither; receipt read-back, existing disabled account resumable.
- Credential/enable crashes or lost acknowledgment: exact UID only; uncertainty held; completed password unchanged.
- Mint failure/after-mint crash: no second consume/destruction/password rewrite; known failure sign-in fallback.
- Release/revoke race/admin resume replay/late old execution: no revoked revival or successor alteration.
- Existing client-deny rules, suppression/audit/error contracts, healthy concurrency and normal soft deferral unchanged.

Full claim-hydration-gate: queue/modified-worker/Recovery/drain units; hydration-rules/batch-reissue/invite-wave emulator suites; unchanged Auth+Firestore lifecycle plus new reservation suite. Preserve workflow/job name and docs-only predicate. Run affected token/binding/sender tests and full social regression gate for shared helpers. Report head SHA/hosted URLs/real executed steps: docs-only green is insufficient. No tests claimed run now.

Append dated #619 amendment to plans/INTEGRATION-CONTRACT.md: C1/C2, schema/proof/checkpoints, disabled staging, atomic bind+spend, release/uncertainty/resume, revoke-before versus suspend/reset-after, unchanged contracts/full gate. Preserve historical #621 text and decision-log numbering.

**Next:** Claude reviews atomicity, enablement, proof/Hub compatibility and quiescence. After approval: recheck main, separate Closes #619 PR/diff/full gate evidence. No merge/deploy/arming.
