# Review of the Part B operator runbook — and what I can take off your plate

## Verdict

The runbook is sound. Its sequencing, invariants (flag off, fallback on until the gate, copy-never-move, dry-run before apply), and rollback posture match what we built. I'd ship against it. But "all remaining steps are yours" is overstated — several steps already have, or can have, a button in Prime Care OS.

## Corrections / notes on the runbook as written

1. **Step 2.6's curl is unnecessary.** `adminRunArtifactAudit` is already wired through our `portal-admin` edge function (`runAudit` action) and there is a **Run audit now** button on the Admin → Artifact Coverage tab. Same for the read-path smoke and the unclaimed-guardians report. No Cloud Shell needed for those three.
2. **The gate verdict is already enforced in the UI.** CoverageGate refuses to render a pass unless the report is stamped `legacyFallbackDisabled: true`, so 2.6's manual checklist is largely automatic — you still have to actually set the env var off before triggering.
3. **Genuinely yours (no way around it):** the deploy itself, IAM/`serviceAccountTokenCreator`, env/config changes (`ELATION_READ_ALLOWLIST`, `ARTIFACT_LEGACY_UID_FALLBACK`, `GUARDIAN_READS_ENABLED`), the composite index, bucket CORS, the CI red-team runs, and the real-guardian end-to-end read. Those live in GCP/GitHub, outside this app.
4. **Open item the runbook flags and I can't resolve for you:** whether the reconciler + paired sweep invite-state stamp is in this deploy. Decide before Phase 0.3, since it changes the `index.js` export list and `ADMIN_FUNCTIONS` in the invoker-lock workflow.

## What I can build so you stop pasting curl into Cloud Shell

An **Operator Console** under Admin, driving the existing `portal-admin` edge function (which already impersonates `portal-admin`, so no local impersonation and no key handling):

- **Backfill runner** — new `portal-admin` actions for `backfillInternalUids` and `backfillArtifactObjects`. Dry-run is the default and apply requires a typed reason; the UI loops the `cursor`/`limit` pagination itself and shows live `remaining` / `failed` counts until `done: true`. This replaces steps 2.1 and 2.3 entirely.
- **Minor-track runner** — a `backfillElationReports` action scoped to a pasted/uploaded id list, with the same dry-run-then-apply gate. Replaces the "CONFIRM your runner invocation" gap in 2.4. (Requires an HTTP wrapper for that function in the portal repo — it isn't one today; I'll write it into the handoff bundle for your agent to land.)
- **Guardian-link loader review screen** — reads `guardian-links-final-2026-08-22.csv`, renders the 193 rows with the 40 `email_on_file` ones flagged (including the two Quiles self-emails and the Goldstein shared inbox) so staff can eyeball them in-app before you run `--apply`. Loader itself stays a script.
- **Go-live checklist page** — the whole runbook as tracked state: each step with its owner (you / this app), what proves it done, and the four cohort lines plus four run-checks pulled live from the audit report so 2.6's verdict is one screen.

## Four hard guardrails (from the review — all accepted)

1. **Bulk applies are super-admin only.** The app already has a `super_admin` tier above `admin`. Dry-runs stay admin-level; the `apply` path of `backfillInternalUids`, `backfillArtifactObjects` and the minor-track ingest requires `super_admin` server-side in the edge function, and the button is hidden (not just disabled) for ordinary staff.
2. **Minor-track wrapper gets the full admin-gate treatment.** The new `backfillElationReports` HTTP wrapper goes through `requireAdminCaller` and is added to `ADMIN_FUNCTIONS` in `lock-admin-invokers.yml`. The id list is validated against the known `dependent.isMinor` set before the call — free-form ids are rejected, not merely allowlist-bounded. Dry-run default; apply requires a typed reason and shows exactly which patients are affected first.
3. **Attribution is non-skippable.** Because the Cloud Function only ever sees `portal-admin`, every bulk `apply` writes a `portal_admin_actions` row with the acting staff email and reason *before* the upstream call; if that write fails, the call does not happen. Treated as a hard invariant, same as the existing per-patient mutations.
4. **The console shows readiness, never flips it.** No go-live button, no env-flag control, nothing that can enable a guardian read. `GUARDIAN_READS_ENABLED`, `ARTIFACT_LEGACY_UID_FALLBACK` and the allowlist stay deliberate GCP actions; the checklist displays their state as reported by the audit and marks them "yours".

## Two confirmations folded in

- **Tier is resolved server-side only.** The edge function derives the acting user from the verified JWT and checks `super_admin` against `user_roles` in the database (same pattern as the existing `is_hr_admin` check). `isSuperAdmin` in the client only hides UI; it grants nothing. No role, tier, or actor field is ever read from the request body.
- **The minor id list is validated in the wrapper too.** The `backfillElationReports` HTTP wrapper independently loads each id's patient doc and rejects anything without `dependent.isMinor === true`, returning the rejected ids. The edge function and UI validate as well, but the wrapper is the authority.
- **Review before real data.** The new `portal-admin` actions and the wrapper are delivered for your agent's review first; nothing runs against production until that review clears.

## Technical notes

- New actions in `supabase/functions/portal-admin/index.ts`: `backfillUids`, `backfillArtifacts`, `backfillMinorReports` added to `FUNCTION_BY_ACTION` and `BATCH_ACTIONS`. Dry-run (`apply` absent/false) requires admin; `apply: true` requires `super_admin` plus a reason, and writes the `portal_admin_actions` row before the upstream call — a failed audit write returns 503 and makes no call.
- Client work: extend `src/hooks/usePortalAdmin.ts` (using `isSuperAdmin` from `useAuth` for display only), add `src/components/admin/BackfillRunner.tsx`, `GoLiveChecklist.tsx`, later `GuardianLinkReview.tsx`, and new tabs in `src/pages/admin/AdminHome.tsx`.
- Handoff bundle gets the `backfillElationReports` HTTP wrapper (`requireAdminCaller` + minor-set validation) plus its `lock-admin-invokers.yml` entry.
- No change to any read path, no change to any flag.

## Scope for this pass

Backfill runner + go-live checklist first, guardian-link review second, minor-track runner last since it needs the portal-repo wrapper.

## Reconciler split (agreed)

- **Reconciler: fast-follow.** Lands on its own PR once the gate is green; it is not on the guardian-read critical path.
- **`dependentBirthdaySweep` stays in this deploy**, and the go-live checklist gets a new hard precondition line: the sweep must have **deployed, run at least once, and converted every already-18 dependent** before `GUARDIAN_READS_ENABLED` is flipped. Until that line is green the checklist shows an explicit NO-GO — otherwise a guardian could read a now-adult's record (e.g. Ross, Sept 4) with no consent gate the moment reads go live. The checklist reads the sweep's last-run stamp and remaining `convertsAt <= today` count.
- **Interim alert while the reconciler is pending:** the handoff bundle adds a Cloud Logging alert policy on the sweep's invite-failed log line, so a silently-orphaned now-adult surfaces for a manual re-invite instead of sitting unclaimed.

## Read-path reason enumeration

Included in this pass: a canonical `reason` reference doc built from the shared read-artifact handler and the nine read handlers, so the portal side can diff its 403 family against it.

## Review before real data

The new `portal-admin` actions, the `backfillElationReports` HTTP wrapper, and the reason doc are delivered for your agent's review first — nothing runs against production until that review clears.



