# Discovery minor exclusion and cold-start gap — review plan

## Decision requested
Approve a narrowly scoped discovery age/DOB safeguard after Claude reviews this plan. No implementation, issue creation, branch, PR, production cleanup, configuration change, deployment, or invitation has occurred. Track D remains parked; AUTOSEND and all invitation gates remain unchanged.

## 1. Verified defect and current production evidence

Read-only checks on November 20, 2026 UTC confirmed:

- `config/rosterDiscovery/practices/809235966787588`: `enabled:true`, `dryRun:false`.
- First live report `rosterDiscoveryReports/809235966787588_2026-11-19_live_1795130423639`: started `2026-11-19T23:20:23.639Z`; fetched **206**, evaluated **201**, eligible/provisioned **15**. The uploaded brief's 201 is the evaluated count, not the raw fetched count. Skips: DOC_EXISTS 169, HINT_NOT_ACTIVE 9, NO_EMAIL 3, EMAIL_SHARED 5. Default cap remains 50.
- `sync_state/rosterDiscovery/practices/809235966787588`: `liveRunCount:1`, cursor `2026-11-19T23:20:23.639Z`, last run `2026-11-19T23:21:06.020Z`, zero write failures and `truncated:false`.

### Exact source path

This is a two-stage evaluator, not one function:

1. `functions/core/services/patient/rosterDiscovery.js:122–156`, **`selectDiscoveryCandidates()`**, eliminates existing records and calls `buildRosterDoc()`. Raw DOB is available as `p.dob`; successful candidates retain both the chart and normalized document DOB. No age check exists.
2. `functions/core/services/patient/memberSafeguards.js:83–117`, **`evaluateNewMember()`**, evaluates email validity, duplicate-chart suspicion, shared mailboxes, existing login ownership, and exactly one active Hint name+DOB match. DOB is available on `chart.dob` and used in matching, but there is no age check; email validation currently wins first.
3. `functions/rosterDiscoveryTick.js:164–205`, **`runDiscoveryForPractice()`**, invokes both stages, builds per-entry decisions/reasons, merges skip tallies, and applies the provision cap. `skippedByReason` is assigned at line 228. The actual create-if-absent write is at lines 250–262; report writing is in `writeReport()` at lines 79–95.

`functions/core/services/patient/rosterProvision.js:68–77,115–117` already rejects missing/non-shaped DOB as `NO_USABLE_DOB`, but its parser accepts impossible calendar dates such as February 31 and future dates within its 1900–2100 range. It does not reject minors.

## 2. Proposed change: exclude/hold, never create

### Rules and precedence

- Capture one run instant (`nowMs`, already injected into the tick). Calculate calendar age using the run's **America/New_York calendar date**, matching the discovery schedule; never divide milliseconds by 365 days.
- In discovery candidate selection, after patient-ID/dedup/existing-record checks and **before `buildRosterDoc()` and all email/Hint safeguards**, validate raw DOB and age.
- A valid DOB with age **under 18** returns a per-person skip `MINOR`. A patient on their 18th birthday is not excluded by this age rule; every existing email, membership, ownership, and provisioning safeguard still applies.
- Missing, unparseable, impossible-calendar, future, or out-of-supported-range DOB returns `DOB_UNKNOWN`, a non-provisioning manual-review hold. Retain the provisioner's existing lower year boundary of 1900 rather than inventing an additional maximum-age policy. Support only the date/date-prefix format already supported by the provisioner; do not infer dates or use Hint's inconsistent numeric `age` field.
- Preserve `DOC_EXISTS` handling: this change never rewrites or retroactively cleans existing patient records.
- Record `decision:'skipped'`, `reason:'MINOR'` or `'DOB_UNKNOWN'` in reports and increment the same reason in `skippedByReason`. Neither category consumes the provision cap. A DOB hold is visible for manual review, not an endlessly retryable service-outage condition.
- Preserve shared-email detection against the original relevant candidate chart population, including excluded minors. Removing a child from the provisioning list must not accidentally make a parent's shared mailbox eligible. Age precedence changes the child's report reason, not the adult's existing mailbox protection.

### Family-model threshold confirmed

`plans/FAMILY-MODEL-DESIGN-BRIEF.md:8–14` says minors are dependents and do not receive their own login. Lines **35–37** define soft-18: independent-account invitations begin at 18, with no forced proxy separation. Lines **48–50** describe the historical Florida posture as no 12–17 confidentiality/category split; that is **not** an exemption allowing a minor standalone login. Therefore **under 18** is the right exclusion for this discovery-only fix. Existing dependent adults still need future family-model handling; this patch does not implement it, proxy access, guardian accounts, separation, nudges, or birthday invitations.

### Intended code scope, only after approval

- Add a small pure discovery DOB/age evaluator in `functions/core/services/patient/rosterDiscovery.js`, with deterministic run-time input.
- Call it from `selectDiscoveryCandidates()` and pass the tick's `nowMs` through. Adjust batch-context construction only as needed to preserve current shared-mailbox safeguards.
- Do not change the shared manual provisioner or send-time evaluator merely to impose discovery-only policy on their other callers.
- No Auth changes, dependency changes, AUTOSEND edits, guardian/family implementation, bulk patient changes, or deployment in this work.

## 3. Rhodes Semel: recommend retain-and-quarantine, not deletion

Scope is **only `patients/1455085200211969`**, DOB `2026-01-04`.

Live reads show `status:'not_invited'`, `firebaseUid:null`, no `authUid` or hydration-status field, source `os.discovery.d406`, and an existing internal storage UID. The patient-ID query returned **zero claimTokens**, one discovery audit entry, and no `claim_hydration_jobs/1455085200211969` document. No claim or hydration was initiated by this investigation.

**Recommendation:** retain the record and its storage identity/audit trail, place this one patient on an explicit Track D/operator exclusion list, and—only after separate approval—stamp the existing `dependent.isMinor:true` classification plus an auditable minor-hold reason. Preserve DOB, chart ID, clinical records, binding fields and storage mappings. Never delete a parent/login selected by the shared email.

**Important limitation:** this is not presently a universal technical quarantine. `onboardingClassifier.js:72–79` honors `dependent.isMinor` and computed age, so scheduled auto-invite excludes this patient already. But `inviteOne.js:53–95` has no patient-level minor/quarantine check, and the admin Issue-invite path does not establish such a hold either. `postClaim.js:95–135` likewise does not enforce an arbitrary quarantine flag. Do **not** set an invented field and claim it blocks all senders/hydration. While there are no tokens, jobs or binding, keeping this MRN out of all manually reviewed invite inputs prevents claim-driven hydration; AUTOSEND must remain off as requested.

A hard all-sender/all-hydration quarantine would need separately approved enforcement work. Deleting now is less safe: the current discovery code can recreate the same chart while it remains in the delta window, and deletion risks losing linkage/traceability. No cleanup or quarantine write is included in this approval.

## 4. Cynthia Goldberg: confirmed trailing-edge loss

Patient ID **1399946260185089**, DOB `1982-09-13`:

| Evidence | Value |
|---|---|
| Morning dry report | `809235966787588_2026-11-19_dry_1795087224828` |
| Morning cutoff | `2026-11-12T11:20:24.828Z` |
| Morning decision | `would_create / ELIGIBLE` |
| Current Elation `last_modified` | `2026-11-12T15:42:00Z` |
| Evening live cutoff | `2026-11-12T23:20:23.639Z` |
| Evening report | No entry for this MRN |
| Current Firestore patient document | Absent (404) |
| Current exact name+DOB Hint match | Exactly one, `membership_status:'active'` |
| Current Elation deleted date | null |

Her unchanged chart timestamp falls **after the morning cutoff but before the evening cutoff**. This is the moving seven-day cold-start edge, not an existing document or an inactive Hint member. She is the only morning `would_create` entry not created in the evening report. Current full eligibility beyond active membership must be rechecked before any later provisioning action.

### Reliability verdict and separate remedy

**The system cannot currently guarantee that eligible active members never fall off this edge.**

- `rosterDiscovery.js:74–79` recalculates `nowMs - 7 days` whenever no cursor exists.
- `rosterDiscoveryTick.js:238–247` intentionally does not persist a cursor during dry runs. This prevents consumption, but does not freeze the cold-start lower bound between runs.
- `rosterFetch.js:160–188` queries exclusively `last_modified__gt=since`.
- The first live cursor now advances beyond Cynthia's unchanged chart; the ordinary next tick's ten-minute overlap will not recover her.
- Another source concern: `rosterDiscoveryTick.js:195–204,313–320` can advance after `OVER_CAP` deferrals, although deferred patients have not been created. Treat this as an additional risk needing a dedicated regression/design, not as evidence it happened in this 15-of-50 run.

**Separate follow-up proposal:** establish a persisted, unconsumed cold-start anchor/pending candidate mechanism so dry-run eligibility and cap-deferred work cannot disappear before successful live processing. Freeze the lower bound until the backlog is accounted for, and preserve retryable-failure protections. Before an owner-operated targeted provisioning of Cynthia, rerun patient-ID-scoped age, current Hint/name+DOB, email ownership/sharing and create-if-absent checks; no invites. Do not silently widen windows, rewind production cursors, or perform a bulk backfill in this minor-fix PR. Review/authorize the window remedy separately.

## 5. Tests and shared contract

After review, add/adjust:

- `functions/test/unit/roster-discovery-d406.test.cjs`: infant/child/17-year-old → MINOR; exact 18th birthday → passes age gate; day before → MINOR; missing/malformed/impossible/future DOB → DOB_UNKNOWN. Calendar/leap-year and New York date-boundary cases use a fixed run instant.
- `test/emulator/roster-discovery.test.js`: minors with unique, shared, and missing email all report MINOR; invalid DOB reports DOB_UNKNOWN; zero patient creation/internal UID mint/invite/token/hydration job; reports/tallies agree; adult sharing a child's mailbox retains EMAIL_SHARED protection; excluded records do not consume the cap; existing patient docs remain byte-unchanged.
- Preserve existing Hint outage, dry-run, create-if-absent, concurrency, cursor, and no-send tests. For the separate window follow-up, reproduce Cynthia's two cutoffs and add a >50-eligible continuation case before changing cursor behavior.

**Yes, the report is a shared surface.** `plans/INTEGRATION-CONTRACT.md:101` documents `rosterDiscoveryReports/{runId}` and lines 105–107 document discovery/cursor behavior. Add a new amendment documenting MINOR, DOB_UNKNOWN, age cutoff/calendar basis, precedence, hold meaning, and unchanged provisioning-only scope. Preserve historical contract/decision-log content. No report rules/schema expansion is proposed unless required by the eventual implementation.

## 6. Approval and delivery sequence

1. Claude reviews this plan; owner approves implementation scope.
2. Open **one GitHub issue for the age/DOB defect**, create a new feature branch from current portal main, and make a narrowly scoped PR with `Closes #N`; never commit to portal main.
3. Include the integration-contract amendment and unit/emulator tests in that PR. Run the full emulator suite through required **claim-hydration-gate**, plus discovery unit tests; require green CI before reporting ready.
4. Do not merge, deploy, arm invitations, alter discovery config, or quarantine/delete any production record without separate authorization.
5. Keep the proven cold-start loss and potential cap continuation defect explicit follow-up items rather than silently bundling a cursor/backlog redesign into this patch.