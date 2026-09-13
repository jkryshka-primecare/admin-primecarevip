# Roadmap

## D-317 — durable slow-chart hydration recovery (in progress)
- [ ] Confirm GitHub issue number (API has been 403; propose designator if blocked)
- [ ] Shared terminal-status helper (`hydrationStatus` write out of `claimAccount.js`)
- [ ] Claim-time soft budget ~120s → `deferred` + `hydrationRunId` + enqueue on recovery run doc
- [ ] Hydration recovery driver (deferred + stale pending, armed/opt-in, reports + letters)
- [ ] Letters HTTP/bridge wrapper for `backfillElationLetters`
- [ ] Token settlement for stranded tokens on completion
- [ ] INTEGRATION-CONTRACT.md v1.59 (`deferred` status + letters surface) + D-023 heads-up
- [ ] Unit tests: soft-budget deferral, driver pickup, shared status helper
- [ ] Report issue number, contract diff, run plan. No deploy / no run until MK approves.

## Open (blocked)
- Real-member activation recheck after a member re-clicks their old link (waiting on MK signal)
