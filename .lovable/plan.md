# Workstream B — discovery cursor reliability (design only)

Read against current deployed main `6fe7d292026b32190292f113dcad2a8352daf514` (newer than the earlier `fc399738` review). No code, issue or PR until you approve.

## 1. Confirmation against current source

**#11 over-cap drop: confirmed, with two corrections.**
- `rosterDiscoveryTick.js:164` runs `selectDiscoveryCandidates(..., cap: MAX_SAFE_INTEGER)`; `:171-193` runs `evaluateNewMember` per candidate; `:195` `batchList = eligible.slice(0, cap)`; `:198` the rest become `deferred / OVER_CAP`.
- `:313` guard is `stats.failed === 0 && retryableSkips === 0`. OVER_CAP is neither, so the cursor advances. `:314` passes `patients: alive` (every fetched patient), and the non-truncated branch of `computeNextCursor` (`rosterDiscovery.js:106`) returns `max(newest, runStartedAt)`. Deferred members fall below the next `since` and are lost until their chart changes again.
- Correction 1: the cap is `resolveCap(config)`. It defaults to 50, can be set per practice, and is clamped to `HARD_CAP` 500. It is not a fixed 50.
- Correction 2: `eligible` keeps Elation's page order (id order, not change time). So the first 50 provisioned are arbitrary relative to `last_modified`, and "newest provisioned" says nothing about which deferred members are older or newer. The fix must sort.
- A deferred run also increments `liveRunCount` (`:325`), so it counts toward the D-407 auto-invite readiness interlock even though it didn't finish.

**Truncation: confirmed unsafe in principle.** `rosterFetch.js:161-192` pages by limit/offset with `last_modified__gt` and no ordering. `truncated` is cleared only when Elation reports no next page. `computeNextCursor:104` advances to the newest `last_modified` read. With pages that aren't in change-time order, unread records can be older than that value, so they get silently skipped. The ceiling is `DELTA_PAGE_CAP` 50 × `PAGE_SIZE` 100 = 5,000 per tick. Config `maxPages` can only lower it.

## 2. Cursor-advance rule for #11

This is a pure function, `computeNextCursor`, with new inputs. Eligible members are sorted by `last_modified` ascending (ties broken by Elation id) **before** the cap slice, so the batch is always the oldest eligible members.

```text
if failed > 0 or retryableSkips > 0         -> hold (no write, as today)
if truncated                                 -> hold (see section 3)
if deferred (eligible not in batch) is empty -> today's rule: max(newestFetched, runStart), monotonic
else                                         -> L = min last_modified among deferred
                                                if any deferred last_modified is missing or unparseable -> hold
                                                next = max(previousCursor, L)
```

- Setting the cursor to exactly `L` is safe. The next `since` is `L − 10 min`, and with `__gt` the deferred member at `L` is fetched again.
- **Progress:** provisioned members are now in `existingIds`, so they're dropped as DOC_EXISTS before evaluation. The next tick's batch is the next-oldest deferred members, even if the cursor didn't move. A backlog drains `cap` members per tick, with no loss and no stall.
- **Quiet practice:** no deferrals and a complete fetch fall straight into the existing run-start branch. Live behavior is unchanged at today's volume (8 eligible against a cap of 50).
- `DOC_EXISTS` races count as handled, as today. Members skipped as ineligible (minor, guard refusal) don't hold the cursor, as today. Only eligible-but-not-provisioned members hold it.

## 3. Truncation

- **Rule:** a truncated fetch **holds** the cursor. It does not advance to "newest read". Without change-time order, nothing we read limits the unread tail, so holding is the only correct watermark. Eligible members we did read still get provisioned; holding just re-reads the window.
- **Failure mode:** stall, not loss. If more than 5,000 charts change inside one window, every tick re-reads the same id-ordered first 5,000 and stays held. The run is flagged (`cursorHeld: 'TRUNCATED'` in stats, report and audit) and logged at error level, so a person sees it.
- **Exact-ID fallback:** I agree it stays unbuilt. Truncation has never fired, the ceiling is about 100× today's deltas (46 fetched), and your rule limits it to proven occurrence. If it's ever needed, I'd propose narrowing the window with `last_modified__lte` (the API supports it) before an exact-ID path, since it needs no stored ID list. This would be a separate proposal.

## 4. Edge cases (`last_modified__gt` plus 10-minute overlap)

- **Same-timestamp straddle:** members at the same `L`, some provisioned and some deferred. The cursor is `L` and the next `since` is `L − 10m`, so all of them are fetched again. The provisioned ones drop as DOC_EXISTS. Strict `__gt` can't exclude `L`, because `since < L`.
- **Many more than `cap` members at one timestamp:** the cursor stays at `L` across ticks while each tick provisions `cap` more (tie-break by id), then moves forward. No livelock.
- **Deferred `L` below the previous cursor** (possible inside the overlap band): the monotonic clamp keeps `previousCursor`. Its `since` (`prev − 10m`) still covers `L`, because the member was fetched with `L > since`.
- **Clock skew, Elation `last_modified` ahead of run start:** the existing `max(newest, runStart)` is unchanged in the drained case. In the deferred case the cursor comes only from deferred timestamps, so it can't jump past them.
- **Empty delta:** advances to run start, as today.
- **Retryable or failed:** hold, as today. **Dry run:** never writes the cursor, as today.
- **Non-monotonic input** (`previousCursor` unparseable): falls back as today; never moves backwards.

## 5. Shared surfaces, contract, decision log

- **The `sync_state/rosterDiscovery/practices/{id}` cursor doc changes, additively only:** `lastStats.deferredOverCap`, `lastStats.cursorHeld` (`null | 'TRUNCATED' | 'UNPARSEABLE_DEFERRED'`) and `lastStats.drained` (boolean). `cursor`, `practiceId`, `lastRunAt` and `liveRunCount` keep their names and types.
- **Readiness-count change (for your decision):** I recommend incrementing `liveRunCount` only on **drained** runs: complete fetch, no deferrals, no failed or retryable members. A partial run isn't a clean creation run. This makes the D-407 interlock slightly stricter and never looser. It changes nothing today, because the counter is held and live runs drain.
- **`INTEGRATION-CONTRACT.md`:** yes. I'd prepend an amendment for the new cursor rule, the additive `lastStats` fields and the `liveRunCount` meaning. The historical text stays byte-identical.
- **DECISION-LOG:** yes. One new entry amending D-406/D-407: "cursor never passes the oldest unprovisioned eligible member; truncation holds; readiness counts drained runs only." Existing entries won't be renumbered or edited.

## 6. Test plan (unit, credential-free, plus the existing emulator suite)

Pure `computeNextCursor` tests, one per rule:
1. Deferral present → the cursor equals the min deferred `last_modified`, never run start.
2. Batch is the oldest eligible members: unsorted input with cap 2 → the two oldest are provisioned, and the cursor sits at the third's timestamp.
3. Fully drained → `max(newest, runStart)` (regression of current behavior).
4. Truncated, with or without deferrals → the cursor equals `previousCursor`.
5. Empty delta → run start.
6. Monotonic: deferred `L` < `previousCursor` → `previousCursor`.
7. Same-timestamp straddle → the cursor equals `L`, and `resolveSince` of it is below `L`.
8. A deferred member with missing or unparseable `last_modified` → hold.

Tick-level tests (injected `fetchDelta`/`deps`, existing harness):
9. Multi-tick backlog: 120 eligible, cap 50 → ticks provision 50/50/20, no member is lost, and the third tick is drained and advances to run start.
10. `liveRunCount` increments only on the drained tick; deferred and truncated ticks write the cursor/`lastStats` without incrementing.
11. A retryable skip combined with a deferral still holds (existing precedence).
12. Dry run never writes the cursor (existing).

Plus the full hosted `roster-discovery-test` and claim-hydration-gate.

## 7. Defect #10 (my read only, not in this PR)

Confirmed: `COLD_START_LOOKBACK_MS` = 7 days (`rosterDiscovery.js:29`), used only when a practice has no cursor, and the cursor only moves forward. Active members whose charts were untouched for more than 7 days before practice 809235966787588's first live run are invisible to the tick until their chart changes. That's by design: the historical roster is `provisionRosterDocs`' job. The live practice already has a cursor, so cold start won't recur there; the exposure is a one-time historical gap. I'd handle it as a separate read-only reconciliation: compare Hint-active members to `patients/` doc ids by chart id, list missing ids, and confirm whether and when `provisionRosterDocs` ran. Cynthia (1399946260185089) stays her own separate, previewed, owner-approved bootstrap.

## Delivery (approved build brief)
- Issue #631 → branch `fix/discovery-cursor-reliability` off `6fe7d292026b32190292f113dcad2a8352daf514` → DRAFT PR with `Closes #631`.
- Confirmed: `liveRunCount` increments only on drained runs; truncation holds `previousCursor`, sets `lastStats.cursorHeld = 'TRUNCATED'`, logs at error level; a deferred member with missing/unparseable `last_modified` holds. Exact-ID fallback stays unbuilt.
- Sort once: eligible sorted by `last_modified` ascending (tie-break by Elation id) in one helper; the batch is a slice of that list, and L = min `last_modified` of the remainder from the same list. No other ordering anywhere.
- PR description states that provisioning order changes from lowest-id to oldest-by-`last_modified`, and that this is intended and harmless (create-if-absent).
- Scope lock: `rosterDiscovery.js` (`computeNextCursor` plus the sort helper), the cap slice and cursor-guard block in `rosterDiscoveryTick.js`, tests, the `INTEGRATION-CONTRACT.md` amendment (prepended) and a `DECISION-LOG.md` entry amending D-406/D-407 (appended, no renumbering). Nothing else.
- Run the local suite (8 pure + 4 tick-level cases) and report the counts. Full claim-hydration-gate real suite and hosted roster-discovery-test must be green at head. Report the head SHA when CI is green. No merge, deploy or arming.
