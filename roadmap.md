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

## Guardian model — Phase A (non-patient guardian accounts + proxy reads) — in progress
- [ ] Guardian account record + chartless activation path
- [ ] Guardian link keyed on guardian account (not chart); explicit positive authorization check
- [ ] Replace "caller must own a chart" fence; explicit empty/missing id rejection
- [ ] Wire medications/allergies/problems/appointments through the shared subject resolver
- [ ] Read-time age-18 gate (moved from Phase C)
- [ ] Negative tests: no links; linked to X requesting Y; null/empty ids both sides
- [ ] DECISION-LOG entry (legal approved model, 2026-09-21) + INTEGRATION-CONTRACT update
- [ ] Arming gated on A + B together; master switch off, allowlist empty
- [ ] Phase B policy filter (allow-all default, state/age/category)
- [ ] Phase C approaching-18 operator report only
- [ ] Phase D transition: DOB second factor + verified OTP contact before account/access
