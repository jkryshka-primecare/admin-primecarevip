# Roadmap

## D-317 — durable slow-chart hydration recovery (in progress)
- [x] Issue number attempt — GitHub Issues API still 403; MK must file (proposed #530 designator) (API has been 403; propose designator if blocked)
- [x] Shared terminal-status helper (`hydrationStatus` write out of `claimAccount.js`)
- [x] Claim-time soft budget ~120s → `deferred` + `hydrationRunId` + enqueue on recovery run doc
- [x] Hydration recovery driver (deferred + stale pending, armed/opt-in, reports + letters)
- [x] Letters HTTP/bridge wrapper for `backfillElationLetters`
- [x] Token settlement for stranded tokens on completion
- [x] INTEGRATION-CONTRACT.md v1.59 (`deferred` status + letters surface) + D-023 heads-up
- [x] Unit tests (16 passing): soft-budget deferral, driver pickup, shared status helper
- [x] Report issue number, contract diff, run plan. No deploy / no run until MK approves.

## Open (blocked)
- Real-member activation recheck after a member re-clicks their old link (waiting on MK signal)

- [ ] BLOCKED ON MK: file the D-317 issue, approve deploy, then dry-run + cap:1 for 1370412230508545

## Guardian model — Phase A (non-patient guardian accounts + proxy reads) — BUILT, PR #560, parked
- [x] Guardian account record + chartless activation path
- [x] Guardian link keyed on guardian account (not chart); explicit positive authorization check
- [x] Replace "caller must own a chart" fence; explicit empty/missing id rejection
- [x] Wire medications/allergies/problems/appointments through the shared subject resolver
- [x] Read-time age-18 gate (moved from Phase C)
- [x] Negative tests: no links; linked to X requesting Y; null/empty ids both sides (26 tests green)
- [x] DECISION-LOG D-409 (legal approved 2026-09-21) + INTEGRATION-CONTRACT v1.69
- [ ] BLOCKED: named-test-account walkthrough needs a deploy (emulator/staging) — not authorized yet
- [ ] Arming gated on A + B together; master switch off, allowlist empty
- [ ] Phase B policy filter (allow-all default, state/age/category)
- [ ] Phase C approaching-18 operator report only
- [ ] Phase D transition: DOB second factor + verified OTP contact before account/access

- [ ] CRM crmdb Firestore target — draft PR #565 built + verified. HOLDS: (1) Greg confirms CRM frontend is callable-only, else scoped rules; (2) move ci-staged/*.yml into .github/workflows (token lacks workflow scope); (3) Greg: 26 vs 27 indexes

## Refresh-email-from-chart (PR #574) — code approved 2026-10-08
- [ ] BLOCKED ON RYAN: review + confirm main is deploy-safe, then merge/deploy
- [ ] At go-live: confirm the Portal tab "Refresh email from chart" button works end to end (re-enable if greyed out)
- [ ] Future ticket: store true-case authUid on claimed records (removes email fallback; firebaseUid-only partial failures currently need manual reconcile after 409)
