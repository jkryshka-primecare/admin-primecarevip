# Review pack — operator console (nothing has run against real data)

Three things need your agent's sign-off before any of this touches production.

## 1. New `portal-admin` edge-function actions

`supabase/functions/portal-admin/index.ts` gains three actions mapped to the
existing Cloud Functions:

| action | Cloud Function |
| --- | --- |
| `backfillUids` | `backfillInternalUids` |
| `backfillArtifacts` | `backfillArtifactObjects` |
| `backfillMinorReports` | `backfillElationReports` (new HTTP wrapper, below) |

Enforcement, in order, inside the request handler:

1. `requireStaff` (unchanged) → verified session; the acting uid comes from the
   JWT, never from the body.
2. All three actions require `is_hr_admin` even for a dry run.
3. `apply: true` additionally requires `has_role(uid, 'super_admin')`, resolved
   **server-side from the database** against the session uid. No role, tier or
   actor field is read from the request body anywhere.
4. `apply: true` requires a non-empty `reason`.
5. **Audit-row-first, fail-closed.** `recordActionStrict` inserts the
   `portal_admin_actions` row (`action: "<action>:apply"`, actor email, reason,
   the id list / cursor / limit) *before* the identity token is used. If that
   insert errors the handler returns 503 and the Cloud Function is never called.
   A second `:apply-result` row records the outcome. Dry runs write one
   `:dry-run` row via the existing best-effort path.
6. `phi_access_log` scope is stamped `<action>:apply` or `<action>:dry-run`.

Minor-track ids are shape-validated here (digits, 6–25 chars, deduped, max 500)
and passed as `patientIds`. This is a fast failure, not the authority.

## 2. `backfillElationReportsHttp.js` — the new HTTP surface

`firebase-handoff/portal-dependents/functions/backfillElationReportsHttp.js`.

- `requireAdminCaller` + `selfAudience`, identical to every other admin
  function, and `backfillElationReports` is added to `ADMIN_FUNCTIONS` in
  `lock-admin-invokers.yml` so the deploy strips `allUsers`.
- POST only, `Cache-Control: no-store`, dry run unless `apply: true`.
- **The minor set is the authority.** `partitionByMinorSet` loads each patient
  doc via `getAll` and admits an id only when `isMinorRecord(data)` is true AND
  `ingestEligibility(data).eligible` is true. Everything else comes back in
  `rejected` with a reason (`NO_PATIENT_DOC`, `NOT_A_MINOR`, or the gate's own
  reason) and never reaches the runner. Note the deliberate difference from the
  backfill's D-080 soft posture: a *missing* doc proceeds in a full-collection
  sweep, but an *explicitly targeted* id must exist to be targeted.
- The runner re-applies the §2a gate per patient, so a guardian revoked between
  this partition and the write is still caught.
- Two points for you to confirm against the real repo: the runner's exported
  entrypoint name (the wrapper tries `_run`, `run`, then `backfill` and throws
  `RUNNER_ENTRYPOINT_MISSING` otherwise), and that the runner accepts
  `{ patientIds, actor, reason }`.
- `index.js` must export this wrapper; the runner keeps its own export.

## 3. `READ-PATH-REASONS.md`

The canonical `reason` enumeration for the read path, so the portal UI can diff
its 403 family against it. Contract rule: a token is added here first, then in
the handler; no PHI in `reason` or `message`; hidden and suppressed items keep
the not-found shape.

## Also in this pass

- `sweep-invite-failed-alert.md` — log-based metric + alert policy for the
  sweep's invite-failure line, the interim cover while the reconciler is pending.
- Go-live checklist in the admin app now carries the birthday-sweep precondition
  as an explicit NO-GO line: the sweep must have deployed, run, and converted
  every already-18 dependent before `GUARDIAN_READS_ENABLED` flips.

## What the console still cannot do

Flip any flag. There is no control in the app for `GUARDIAN_READS_ENABLED`,
`ARTIFACT_LEGACY_UID_FALLBACK` or `ELATION_READ_ALLOWLIST`, by design.
