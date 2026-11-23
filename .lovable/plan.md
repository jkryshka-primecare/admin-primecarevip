# Discovery retention — revised design for Claude review

Workstream A is implemented in draft PR #626; its approved scope is preserved in `.lovable/reviews/pipeline-a-approved-scope.md`. No B code until A merges and Claude approves. No merge/deploy/arming, patient writes, sends or counter start.

## Workstream B — durable discovery retention (design only)

**Proposed issue title:** “Stabilize discovery cold-start anchor and hold cursors for unresolved cap/retry candidates.”

**Proposed later branch:** `fix/discovery-anchor-cursor-reliability`, off then-current main **only after Workstream A merges**, with its own owner-created issue/PR and separate code approval.

### Verified findings

- `rosterDiscovery.js: resolveSince` uses `now − 7 days` when no valid cursor exists; existing cursors use a 10-minute overlap.
- `rosterDiscoveryTick.js` writes dry-run reports, but no cursor; `would_create` candidates and `OVER_CAP` deferrals are not a durable work queue.
- After a live run, cursor advancement checks hard failures and retryable skips, but not `deferredOverCap`; `computeNextCursor` uses fetched timestamps/run start, not unresolved-candidate boundaries.
- Existing controls include per-practice flags, cap default 50/hard ceiling 500, bounded Elation delta pages, #615 age exclusion, shared pre-creation checks, and create-only `DOC_EXISTS` behavior. Preserve these functions and their eligibility/order.
- Fresh read-only check: `patients/1399946260185089` is absent. Its Elation chart exists, is not deleted, and has `last_modified=2026-11-12T15:42:00Z`. Retained practice reports identify it as `would_create / ELIGIBLE` through November 19. This confirms a bounded historical recovery source; it does not certify current eligibility.

### Revised decision: anchor + cursor discipline first, no full pending collection

The simpler pair covers both requested failure classes in the code reviewed:

| Real case | Why anchor + hold suffices | Additional collection needed? |
|---|---|---|
| Repeated dry runs before the first live cursor | A once-persisted initial seven-day floor does not move forward as the chart goes quiet. | No. |
| Cross-run cap backlog | Keep the cursor/anchor unchanged while OVER_CAP remains. On the next run, existing patient IDs are excluded and the next eligible cap-sized batch can be created. | No, provided the bounded delta pages replay the deferred IDs. |
| Write failure or crash before cursor commit | Existing code advances only after writes finish. Cursor hold forces re-evaluation; create-only retries safely return DOC_EXISTS when a prior write actually committed. | No. |
| Crash after patient creation but before report/cursor | Re-read existing IDs and treat the already-created record as DOC_EXISTS. Reports are diagnostic, not completion authority. | No. |
| Chart becomes deleted/inactive/minor/ambiguous between runs | Fresh chart and unchanged current checks refuse creation. Historical eligibility never authorizes provisioning. | No. |

**No verified real case in this review establishes that a full pending-candidate collection is necessary.** Remove it from the default scope. A collection would add leases, settlement, indexes, retry states, and capacity management without fixing a demonstrated gap beyond the simpler design.

### Bounded paging limitation to investigate, not a queue justification

`rosterFetch` uses bounded limit/offset delta pages without an explicit validated ordering contract. If a held window is truncated and fresh changes repeatedly displace an already-observed deferred ID from the bounded pages, anchor/hold alone cannot guarantee that ID reappears promptly. This is a concrete limitation of the inspected fetcher, **not a confirmed production occurrence**. A pending collection also cannot recover never-observed IDs or itself prove paging completeness.

Before implementation, reproduce page replay/truncation with the existing fetcher and establish ordered-complete behavior or a bounded scan checkpoint. Default conservatively to no cursor advance on truncation; do not scan the full roster or widen the lower floor backward. If tests demonstrate loss/starvation of already-observed IDs despite that protocol, return a targeted supplemental design: per-practice, exact-ID-only retained overflow metadata for those observed replay gaps, not a general queue for all candidates. No such collection is approved for code now.

### Minimal state and run protocol

1. Persist a versioned per-practice `coldStartSince` anchor once as the initial seven-day floor. Existing valid live cursors stay unchanged; no backwards reset or earlier roster reach. Anchor reads/writes fail closed and concurrent initializers use one transaction.
2. An enabled dry run may now write **anchor bookkeeping only: timestamps/version/practice ID**, in addition to its existing reports. No new pending collection, copied name/email/DOB payload, patient/Auth write, token, invite, or mail. Environment-off remains no work; distinguish configured diagnostic dry runs from live permission. This dry-run contract change is explicit and needs review.
3. Fetch the existing bounded practice delta from the saved anchor or stored cursor/overlap. Re-fetch/re-evaluate every aged candidate against ALL unchanged current checks: deletion/practice, #615/#624 age/DOB/dependent-minor, batch duplicate/shared-email context, existing record/login, and evaluateNewMember membership/identity checks. Never create from a stale report.
4. Preserve the configured/default/hard cap exactly. One total creation budget applies to fresh and replayed candidates; deduplicate by chart ID before selection. Unresolved overflow holds progress, rather than consuming a slot or being silently skipped.
5. Keep create-only patient writes and DOC_EXISTS behavior. If any selected write, current lookup, or state read is uncertain, hold the cursor. Interrupted runs are retried safely from the same boundary; never infer completion from an elapsed timeout.
6. Do not advance the cursor when OVER_CAP, unresolved retryable work, failed writes, or incomplete/truncated page replay remains. Advance only on a demonstrably completed eligible pass; maintain the existing monotonic cursor/overlap contract. No backward cursor/window widening.
7. Dry, held-backlog and interrupted/retry runs never increment the clean-run interlock. Only the existing qualifying clean live creation-run boundary may count; do not start or reset that counter, change AUTOSEND, or release operational holds during this work. Contract/test the classification explicitly before code.

### Cynthia remains a separate owner-approved bootstrap

An anchor initialized now cannot reach back to a chart already lost before it existed. The read-only evidence shows MRN `1399946260185089` in retained `would_create / ELIGIBLE` reports, with chart last_modified `2026-11-12T15:42:00Z` and no patient doc at this audit.

Recovery is a separate, previewed, exact-ID one-time bootstrap from that verified provenance, requiring owner execution approval. It is never automatic on deployment, does not initialize an earlier floor, and never sends an invite. Fresh eligibility must be rechecked through ALL unchanged safeguards before any future create. The abbreviated `1399246085` is not assumed to identify the chart. No patient work or bootstrap has been executed.

### Required future tests and contract amendment

- Initial cold-start floor remains fixed across more than seven days of dry runs and concurrent initializers; a quiet previously observed candidate remains eligible for re-evaluation at a later approved live run.
- Cap+1 and multi-run capped backlogs replay without cursor crossing, duplicates, or starvation; equal timestamps, newly arriving charts and truncated/unstable pages must be tested. Confirm the paging assumption or return the narrowly scoped overflow proposal before coding it.
- Crashes/uncertainty before create, after create but before cursor/report, during cursor commit, and transient Elation/Hint/Auth/Firestore failures. Safe DOC_EXISTS retries; no counter increment for dry/held/retry runs.
- Membership becomes inactive, minor/unknown DOB, dependent-minor flag, deleted/merged/wrong-practice chart, duplicate/shared email, existing login/record: all current checks re-run and canonical reasons/create-only behavior preserved. No stale eligibility bypass.
- Synthetic Cynthia-boundary fixture demonstrates stable-anchor retention; historical actual Cynthia bootstrap is a separate reviewed exact-ID preview, zero automatic patient creations or sends.
- Existing real Auth+Firestore discovery suite and the full actual hosted claim-hydration-gate on the eventual exact head SHA, including #617/#618/#619 lifecycle/reservation and #615/#624 age regressions. A no-op gate is not evidence.
- Append INTEGRATION-CONTRACT amendment for the anchor's dry-run bookkeeping, hold/progress/counter semantics and additive report compatibility, preserving historical text. No pending schema/index change unless separately justified and reviewed.

## Next approval

Workstream A code is in draft PR #626 on fix/deploy-pipeline-reliability; issue creation is still owner-only (403), so the genuine issue number/Closes reference is pending. Hosted evidence is tracked separately from this B design.

Claude reviews this narrowed Workstream B design. Approval does not authorize B implementation before A merges. No full pending collection, automatic bootstrap, patient changes, merge/deploy/arming, invitation sends, nudge release, or counter start.
