# Invite-layer age gate — Claude review before coding

**Plan only. No application code, issue/branch/PR creation, send, merge, deployment or arming in this turn.**

## Scope and baseline

Reviewed portal main `59caed7d0378d22f5deb345b976d64f55ca92c22`. #615 is live per owner; this review checks source, not deployed function provenance. Scope: invitation eligibility/report adapters only. Leave discovery, AUTOSEND/config/wave gates, reset/claim/security, social, guardian/Track-D, schedules and matching unchanged.

## 1. Chokepoint and caller-coverage proof

**`inviteOne` is not universal today.** The actual common token writer is `functions/core/services/patient/claimToken.js:47–85`, `issueClaimToken()`. Put the non-bypassable age check inside its existing mint transaction, before the token write at lines 76–82. This changes only the invite-issuance portion; validation, consumption and #619 receipt/reservation behavior remain untouched.

| Sender / entry | Verified current path | Required coverage |
|---|---|---|
| Prime Care OS | `supabase/functions/portal-admin/index.ts:55` forwards invite to `adminIssueInvite` | Covered by downstream checks; no admin-app changes |
| Manual admin | `functions/adminIssueInvite.js:144–166`: revoke, direct `issueClaimToken`, direct `sendInviteEmail` | Bypasses inviteOne; writer gate plus pre-revoke invite eligibility |
| C4 reissue / new_invite | `functions/adminBatchReissue.js:155–160,198–217` → `inviteOne` → writer | Gate selection and immediate pre-revoke; shared writer final check |
| C4 runner | `functions/scripts/invite-wave-runner.js:134–139` POSTs batch endpoint | Same batch path; no runner/cohort/wave changes |
| Other batch invites | `functions/adminBatchInvite.js:180–202,220–257` → `inviteOne` | Gate selection and fresh send; shared writer final check |
| Auto-invite | `functions/autoInviteTick.js:50,287–289,470–478`: production `send` defaults to `inviteOne` | Existing classifier plus fresh invitation checks; leave governance intact |
| Existing birthday sweep | `functions/dependentBirthdaySweep.js:75–80`: direct writer + shared email sender | Covered despite inviteOne bypass; change only invite eligibility/reporting, not birthday conversion or guardians |
| Human CLI | `scripts/issueInvites.cjs:323–348`: direct writer + direct `sgMail.send` | Shared writer blocks mint; same eligibility preflight before its direct send, including sandbox mode |

Source search found four writer call sites: inviteOne, adminIssueInvite, birthday sweep and CLI; no alternate production claim-token creator. Re-inventory the implementation base and add a boundary regression test requiring checked primitives.

Preserve existing recipient/response/audit/transport contracts rather than refactoring all callers into inviteOne.

## 2. One calendar-correct age source

Reuse **`evaluateDiscoveryAge({dob,nowMs})`**, `functions/core/services/patient/rosterDiscovery.js:124–146`, unchanged: valid NY-calendar DOB, 18th birthday, leap-day policy, unknown/future holds and existing supported-year/date-prefix rules. No third calculation.

The classifier is weaker: `functions/core/services/patient/onboardingClassifier.js:23–38,72–79` uses UTC birthdays and permits impossible calendar dates. Read-only examples confirmed:
- DOB `2008-11-22` at `2026-11-22T02:00:00Z`: classifier says needs_access, #615 says MINOR (still November 21 in New York).
- DOB `1980-02-31`: classifier says needs_access, #615 says DOB_UNKNOWN.

Replace classifier arithmetic with #615 evaluation; preserve buckets, other ordering, explicit dependent-minor exclusion and report reasons (`age-under-18`, `dob-unknown`, `dependent-isMinor`). Invite adapters expose uppercase reasons. Remove obsolete ageFromDob/export after repository-wide caller verification (no other reviewed functions/scripts caller). Social age logic stays untouched.

Direct import has no reviewed cycle: rosterDiscovery → pure rosterProvision, not onboardingClassifier. No discovery extraction/change.

## 3. Shared eligibility and side-effect ordering

One invite-only adapter calls the evaluator without arithmetic. Resolve exact patient ID and `patients/{id}.dob`; no email matching, Hint age, caller DOB or cross-chart fallback.

- **MINOR:** valid DOB under 18; retain explicit dependent-minor exclusion on conflicting adult DOB. No guardian conversion.
- **DOB_UNKNOWN:** missing/blank/unparseable/impossible/future/unsupported DOB. Age precedes email/shared-email checks: no-email minors still return MINOR. No force/config bypass.
- **ADULT:** age passes only; existing suppression/status/duplicate/claim/operational exclusions remain.
- Missing/read-error patient evidence stays distinctly fail-closed.

Enforcement:
1. **Mint transaction:** issueClaimToken reads patient + existing tokens, evaluates age using fresh server time on each retry, rejects before writing. Preserve two-argument signature, successful response, TTL/schema/live-token semantics; no production override.
2. **Pre-revoke:** manual and batch selection/send-time checks use the same age decision before revoke/remint. Preserve #601/#602 suppression-before-cooldown ordering. Pure resumeReset bypasses invite checks; reset-and-invite checks age before invoking unchanged reset helpers/fences.
3. **inviteOne:** fresh patient-ID age check before email/mint; propagate MINOR/DOB_UNKNOWN, not MINT_FAILED. Cached selection is insufficient.
4. **Final send:** sendInviteEmail resolves patient ID from server-side token record, repeats age check before transport; CLI uses the identical adapter before sgMail.send. Catch corrected DOB after mint. Preserve delivery-failure cleanup, consumption/security and tracking/ASM; age refusals are skips, not provider failures.

Checks protect each stage's fresh snapshot, not atomic email delivery/recall. DOB changing after an adult mint can block send, not retroactively prevent that mint. No proactive old-token revocation, suspension, cleanup or claim-path changes.

## 4. Caller results and reporting

- Manual: HTTP 409 / FAILED_PRECONDITION, details.reason MINOR or DOB_UNKNOWN; clear operator message, unchanged success/auth. Refusal audits use patient ID/reason only.
- Batch: canonical skippedByReason/skippedAtSend; no sent/reissued/failed or wouldSend/wouldReissue/cap consumption. Late refusal is not a provider failure.
- Auto: canonical skips, not failure/consecutive-failure/auto-stop. Settle any existing send marker through current outcome handling; no lease/queue/governance change.
- Birthday sweep: inviteSkipped carries age reason; existing consent-conversion logic is not rolled back or rewritten.
- CLI: exclude/count holds in dry/live/sandbox; unchanged confirmation/transport/override/other opt-out behavior.

## 5. Rhodes acceptance, without a real invite

Target **patient ID 1455085200211969**. Prior Nov 20 read: DOB `2026-01-04`, unbound/not_invited, no tokens. #615 pure evaluation at `2026-11-22T21:59:00Z` returns **MINOR**. Proposed verdict verified; gate not implemented/live-tested, and live chart not refreshed. No send endpoint called.

Acceptance: synthetic emulator document with this exact MRN/DOB; direct admin, writer/inviteOne and batch return MINOR, zero tokens/mail calls, existing invite/account unchanged. Never invoke the real patient's invite/reset/revoke or copy their email.

## 6. Tests and required evidence

Add invite-age unit/emulator suites; update adapters with valid DOB/patient-bound tokens, not bypasses.
- Unique-email, shared-email and no-email minors: MINOR; zero mint/send/revoke/claim/reset side effects. Unknown DOB variants: DOB_UNKNOWN; zero mint/send. Adult eligible: exactly one normal invite; other exclusions still work.
- Exact NY midnight/18th birthday, UTC disagreement, February-29/March-1, invalid/future/missing DOB/bounds; parity through classifier/gate.
- Every listed entry; direct writer, first/reissue, force refusal, Rhodes MRN.
- DOB corrections after selection/before mint, transaction retry and before mail; no transport. Existing blocked/recent links remain intact; no auto failure-counter/marker trap.
- Existing adult responses/audits, suppression/tracking/ASM, CLI confirmation/sandbox and birthday-conversion regressions; reset-only resume and full #617/#618/#619 regression suites stay green.

Register new suites in **claim-hydration-gate**; preserve name/docs-only predicate and all queue/modified-worker/Recovery/drain, C4/rules and Auth+Firestore lifecycle/reservation suites. Also run classifier/auto/discovery/sender regressions. Report final head SHA, hosted run/job URLs and **executed** steps—not docs-only green. No new tests/CI claimed run now.

## 7. Integration contract and implementation workflow

Append dated INTEGRATION-CONTRACT amendment: shared #615 age source, mint/send/pre-revoke guards, DOB authority, canonical reasons/counters/callers, unchanged gates/security/reset and no old-token claim enforcement. Preserve history/numbering; record approved structure in AGENTS.md on implementation.

After Claude approves: re-read then-current main; create a GitHub issue titled **“Block minor and unknown-DOB portal invitations across every sender”**, then its own `fix/invite-age-exclusion-<issue-number>` branch and PR **Closes #N**. Use the actual returned issue number; if issue creation is denied, obtain owner-created issue before claiming Closes. Return diff and full hosted evidence for separate review. **No merge/deploy/arming or real-patient invitation authorization.**
