# Invite and legacy-token claim age gate — review

- Draft PR: https://github.com/primecarevip/prime-care-vip-app-v2/pull/624
- Branch: `fix/invite-claim-age-gate`
- Base: `59caed7d0378d22f5deb345b976d64f55ca92c22`
- Verified head: `35f5f7736ddd1220f7b700747f60439535bfd512`
- GitHub comparison: one commit ahead, zero behind, 27 intended files only; mergeable, draft.
- **Blocker:** GitHub issue creation denied 403 (issues permission). Owner-created issue number requested; PR remains draft until a real `Closes #N` can be added. No invented issue/reference.

## Implemented together

Shared unchanged #615 NY-calendar evaluator gates issueClaimToken inside the mint transaction (re-evaluated on retry), final shared and CLI direct email transport, manual reset-and-invite/revoke and C4 pre-revoke. Existing suppression→cooldown ordering, first-invite routing, caps/pacing/config/wave gates remain unchanged. Classifier uses the same source with existing bucket/order/report contracts and dependent-minor exclusion; invitation adapters return canonical MINOR/DOB_UNKNOWN skips, not provider failures.

claimAccount refuses minors after DOB verification and a fresh roster read, BEFORE acquireWork/C1. Missing/malformed/impossible/future DOB fails closed; incorrect submitted DOB retains the existing throttle/mismatch behavior. This covers pre-existing live invite tokens. No modification to #619 C1/reservation/C2/lease/enable/mint or #617/#618 reset/provenance/security helpers. Pure reset-only resume is inert for the age gate even with mixed invite flags.

## Live token audit (read-only)

At 2026-11-22T22:32:59.711824Z, audited all 2475 token and 1625 patient documents: **387 unused/unexpired tokens; zero minors; zero unknown-DOB; zero adult-DOB explicit dependent-minor holders**. No revocation needed or executed, no patient data changed, no invitation sent. This is a timestamped snapshot.

## Actual hosted evidence on the verified head

All 13 associated Actions runs succeeded. The required claim-hydration-gate executed real tests; its docs-only no-op was **skipped**, not accepted as evidence.

- Full gate: https://github.com/primecarevip/prime-care-vip-app-v2/actions/runs/45079970394 — SUCCESS; queue/worker/Recovery/drain + age units, real C4/rules and real Auth+Firestore lifecycle/reservation/age steps all SUCCESS.
- Social gate: https://github.com/primecarevip/prime-care-vip-app-v2/actions/runs/45079970393 — SUCCESS; actual logical mapping Auth+Firestore+Functions test step executed.
- Invite send safety: https://github.com/primecarevip/prime-care-vip-app-v2/actions/runs/45079970368 — SUCCESS.
- Discovery, auto-invite, invite status, roster backfill, sync email, read enforcement, webhook, artifact red-team and secret scans also SUCCESS.

## Local acceptance/regression evidence

- 21 pure age/inventory tests; strict invalid/future/missing DOB, NY midnight 18th-birthday, leap day, bucket/flag precedence and direct-writer/transport inventory.
- 107 real Auth+Firestore cases: all existing lifecycle and #619 reservation coverage plus 40 new invitation/claim cases. Includes Rhodes synthetic MRN 1455085200211969, unique/shared/no-email minor variants, no Auth/reservation/binding/consume/hydration on refusal, real adult custom-token exchange, retry/correction races, pre-reset/pre-revoke token preservation, reset-only mixed flags, auto read/late-age skips and actual CLI path with synthetic transport.
- 39 existing real C4/rules cases; 80 combined sender/read/social/hydration units; unchanged discovery/provision/auto/webhook direct-script suites; 27 actual social emulator cases.
- Independent read-only reviewer found no high blockers after correction-race fixes.

## Review limits and release hold

Checks use snapshots; they do not promise cross-service atomic DOB-versus-reset/mail operations. Existing C1/C2 immutable roster/ownership checks remain authoritative. Synthetic emulator providers do not certify live external provider behavior. No frontend/client-proof change, deployment, merge, arming, schedule/operational-setting change or real send. Invite and claim checks must release together after review and separate approval.
