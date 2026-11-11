# Portal login-to-records readiness — 2026-11-11, 21:29–21:34 UTC

## Decision
Not certified for wave one. Read-only audit found a disabled recovery drain and a live activation request timeout shorter than awaited hydration. No production mutation, send, claim, impersonation, flag change or redeploy was performed.

## Hydration model
- Provisioning creates the patient identity/contact roster, not a complete historical chart; issuing an invitation mints/sends the claim link, not a hydration run.
- Current portal source at `add6ec67810a9a376fedcddce259387bac6d2ddd`: claim binds the Auth UID, sets lifecycle `active`, and awaits `runPostClaimSteps`. Historical reports and letters are hydrated, with a default 120-second soft budget inside a 180-second function cap. Completion requires clean reports and letters, including the letters listed/stored-minus-deleted rule. This is not a universal guarantee of every Elation object or PDF artifact.
- Slow hydration writes `deferred`, `CLAIM_SOFT_BUDGET_REACHED`, and a durable recovery queue entry. Terminal `failed` is not automatically retried by the scheduled Tick.
- Historical baseline and ongoing Elation change ingestion are different paths; Recovery Driver/Tick recover unfinished baseline hydration, not the general continuous-sync feed.
- Ingest gate still permits claimed-active charts independently of the legacy allowlist. Read authorization retains patient UID ownership; no business-rule change was made.

## Live state
- Full default-database read: 1,606 portal patient documents; 305 lifecycle-active, of which 304 hydration-complete and one deferred. No pending/failed hydration states found.
- Active Hint denominator: 1,036. ID-only matching via chart/integration ID, stored Hint ID and the previous ID mapping yielded 269 login-bound active members: 268 complete, one deferred. 108 active Hint members were unmatched by these ID sources; no email-based matching was performed.
- Prior reviewed send-eligible reissue cohort contains 501 IDs: 498 expired-invite rows plus three live-invite rows. At this read, 500 had no hydrationStatus and no login binding, one had since claimed and completed. This is NOT an exhaustive replay of the original 501 expired-invite bucket: the export excluded three original expired rows. Recompute eligibility before sending.
- `config/hydrationRecovery` is absent (404). Current Tick fails closed unless `enabled === true` in that document, so the configured scheduled drain is disabled.
- `hydration_runs/hydration-recovery-standing` contains one queued member; no cycles, lastTickAt, lastTickReason, results or active cursor. Last update September 21 at 16:01:36.929 UTC. Not caught up.
- Deferred member record ID `848387093037057`: claim started September 21 at 15:59:36.789; deferred at 16:01:36.891, approximately 120 seconds later, reason `CLAIM_SOFT_BUDGET_REACHED`. Token used at 16:01:37.045. Cached counts: 26 labs/report documents, zero letters. Counts do not prove upstream completeness or that letters should exist. Exact slow upstream call cannot be reconstructed without runtime logs.
- This failure can recur for wave claimers whose hydration exceeds the budget; enabling/recovering the drain requires separate approved execution and verification.

## Live member UI timing
- My Health Hub snapshot `588242c4`: shared `portalClient.ts` aborts requests after 15 seconds. Claim uses this client and awaits hydration server-side for up to approximately 120 seconds before a deferred success response. A slow claim can show a network failure while server-side account creation continues.
- Live `care.primecarevip.com` shared bundle `button-E7MXVxd6.js` independently confirms `R=15e3`, an AbortController timer using R, and the normal claim function call. This is deployed behavior, not source-only inference.
- Hub blocks pending/deferred/failed hydration states and polls on pending/deferred. Polling chart reads does not itself invoke post-claim hydration; ordinary password login does not call it either. The comment suggesting login retries hydrate is not a verified execution path.
- Default claim frontend is two-step: claim, then password sign-in. Custom-token handoff requires `?onestep=1`; no automatic first-session walkthrough was executed.
- Public browser verification: login renders, password sign-in button exists, and unauthenticated medical-records navigation returns to login. No authenticated records or real claim flow was exercised.

## Reported login case
- Located the named member by the patient record's name, not email: record ID `970269181870081`, unique exact first/last match in the portal roster.
- Lifecycle `invited`; authUid/firebaseUid absent; hydrationStatus absent. Two unused historical claim tokens expired August 22 and October 19. No live claim token found. Cached counts: two labs/report documents, zero letters; these do not establish a working portal account.
- Normal patient-record resolution cannot serve this chart through a legitimate own-chart session without a bound UID. An old claim link is expired. This supports an incomplete activation/expired-link explanation, NOT attribution of his particular browser attempt or proof no orphan Auth account exists.
- No password requested, reset or sign-in attempted; no email-based Auth lookup or patient impersonation.

## Additional live configuration discrepancy
- `config/socialSignIn.enabled` and `config/socialSignIn/practices/default.enabled` both read true, contrary to earlier flag-off hold. Staff gates still exist in source; this does not prove public canary enabled. Live login has no visible Google/Apple controls. No switches changed; operator must reconcile intentional staff-canary state before rollout.

## Verification limits and next gates
- Current diagnostic identity: lovable-portal-readonly. Cloud Functions metadata reads now return 403; Logging returns permission denied for all log views; Firebase Auth lookup returns INSUFFICIENT_PERMISSION; Auth project settings return 403. Current deployed Driver version, Tick invocation health, continuous feed lag, exact login error and blocker registration are not verified. Previous v24 evidence cannot be presented as a fresh read.
- GitHub run 696 completed successfully at main `add6ec67`; run 697 at `7c571f1d` was in progress during this audit. Workflow success alone does not prove per-function version or runtime health.
- Before wave one: repair the claim-client timing mismatch in the owning Hub project; approve and verify recovery drain and clear the deferred case; recheck deployed runtime/continuous feed with read access restored; inspect the reported member's actual failure without impersonation; perform an authorized synthetic/staff claim → real Firebase session → UI records/artifact read-back. No existing session suitable for that walkthrough was supplied.

No release readiness or completeness guarantee is claimed.