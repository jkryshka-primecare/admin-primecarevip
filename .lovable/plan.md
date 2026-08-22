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

Everything above is read-only by default and every apply writes a `portal_admin_actions` row with the acting staff email and reason, per the existing control-plane audit rule.

## Technical notes

- New actions go in `supabase/functions/portal-admin/index.ts`: added to `FUNCTION_BY_ACTION`, listed in `BATCH_ACTIONS`, and in `MUTATIONS` (so a reason is mandatory) when `apply: true`; dry-runs stay `ADMIN_ONLY`.
- Client work: extend `src/hooks/usePortalAdmin.ts`, add `src/components/admin/BackfillRunner.tsx`, `GuardianLinkReview.tsx`, `GoLiveChecklist.tsx`, and new tabs in `src/pages/admin/AdminHome.tsx`.
- The new admin function names must also be added to `ADMIN_FUNCTIONS` in `firebase-handoff/portal-iam-hardening/lock-admin-invokers.yml`.
- No change to any read path, no change to the flags, nothing that can make a guardian read live.

## Suggested scope for this pass

Backfill runner + go-live checklist first (they remove the most Cloud Shell), guardian-link review second, minor-track runner last since it needs a portal-repo wrapper.
