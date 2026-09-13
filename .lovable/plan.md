# Sean Liesenberg hydration recovery — findings and recommended sequence (read-only)

Nothing was run. All conclusions come from reading the deployed code.

## 1. Is the operator backfill (the Willmore tool) the right recovery tool?

Mostly yes — with two gaps you need to know before you approve a run.

What it does right:
- It is `backfillElationReports` via its HTTP wrapper, reached through the authenticated
  `portal-admin` bridge action `backfillMinorReports` with `patientIds: ["1370412230508545"]`.
  Same path used for Willmore (`e2e403-willmore-01`).
- It runs **outside** the 180s claim cap: 540s instance cap, a 500s soft budget that pauses
  gracefully, a 420s per-patient budget and a 240s per-artifact budget.
- It is **resumable**: the run doc keeps a durable `pending` cursor with a lease + 30s
  heartbeat, so a slow chart (~28s/call) survives pause/resume without losing work.
- It **writes his record subcollections** and is idempotent (skip-existing), so a partial
  earlier attempt is safe.

Gap A — it does **not** flip `hydrationStatus`. `hydrationStatus` is written in exactly one
place in the codebase: the claim-time block in `claimAccount.js`. The backfill wrapper never
touches it. So after a successful operator backfill Sean would have records but the portal
would still show "still setting up your records". Completing him needs a second, explicit
one-field write (`hydrationStatus: 'complete'`) after the backfill verifies.

Gap B — **letters are not covered**. Claim-time hydration runs reports *and*
`backfillElationLetters`. That letters job is an in-process module only; it is not exported in
`index.js` and has no HTTP or bridge surface. The operator tool restores reports/medical
records only; his letters baseline stays empty until either a letters surface exists or a
claim-time hydration re-run happens.

His unconsumed token: the backfill touches no token state, so the token stays **stranded** —
live, unused, expiring 2026-10-12, on an account that is already active. It is harmless
(claim would be a no-op re-entry) but it will mis-count him as "not yet claimed" in any
reconciliation that keys off unused tokens. Recommend revoking or marking it as part of the
same operator action, or accepting it as known drift.

## 2. Will he self-heal?

No. Two mechanisms could plausibly pick him up; neither does.

- **Auto-resume driver** (`backfillDriver.js`) ticks every 2 minutes via Cloud Scheduler, but
  circuit breaker 6 is explicit opt-in: it only ever touches the runIds recorded on its own
  `driver_state` doc. It has no notion of "scan for stuck `hydrationStatus: pending`". A run
  must be armed by an operator with a runId, cohort ids and a written reason.
- **Claim-time stale-pending recovery**: `claimAccount` will re-claim a `pending` older than
  180s and re-run hydration — but only inside a claim call. Sean has already claimed; nothing
  re-enters that path on login. And even if he re-opened his (still-unconsumed) link, the
  re-run would hit the same 180s wall on the same slow chart.

So: **operator-triggered, and it needs the driver armed or a single direct run.**

Invocation (single patient, via the bridge — no Firebase super_admin token, so **no SA key
regeneration**; the bridge authenticates with your app session and enforces `is_hr_admin` plus
`super_admin` for `apply:true`):

```
action: "backfillMinorReports"
patientIds: ["1370412230508545"]
apply: false            // dry run first
reason: "D-317 single-patient hydration recovery — Sean Liesenberg"
runId: "d317-sean-01"   // same runId on every resume
```
Then the same body with `apply: true`, re-POSTed with the identical `runId` each time it
returns `paused` / `SOFT_BUDGET_REACHED`, until `status: complete` and `pending: 0`. At ~28s
per call he should fit inside one or two cycles.

## 3. D-317 durable fix — scope only

Goal: claim-time hydration hands a slow chart to the async driver instead of dying at 180s, so
the remaining ~585 unclaimed members get a self-resolving "records loading" state.

Shape (smallest correct version):
1. Claim-time hydration gets its own soft budget (~120s) well under the 180s cap. On expiry it
   stops awaiting, writes `hydrationStatus: 'deferred'` plus a `hydrationRunId`, and enqueues
   the patient on a standing recovery run doc instead of leaving `pending`.
2. A **hydration recovery driver**: either a new opt-in cohort on the existing driver, or a
   low-frequency scheduled sweep that claims `deferred` (and `pending` older than the cap)
   patients, runs reports + letters through the existing bounded/resumable machinery, and — the
   one genuinely new behaviour — **writes the terminal `hydrationStatus`** itself. That write
   should move out of `claimAccount` into a shared helper both paths call.
3. Letters need an operator/driver-reachable surface (export + wrapper), or the driver can only
   ever half-hydrate.
4. Member UI: `deferred` must render as self-resolving "records loading", not the terminal
   concierge-call screen. `getMyPatientRecord` already returns `hydrationStatus`, so this is a
   copy/state change, not a new field.

Size: medium — roughly a day of backend work (claim budget + shared status helper + driver
cohort + letters wrapper + tests), plus a small member-app change.

Shared surface: **yes**. It adds a `hydrationStatus` value (`deferred`) that the member app
branches on, and a new letters surface. Both need an INTEGRATION-CONTRACT entry in the same PR
and a D-023 notification.

## Recommended sequence

1. Dry-run the single-patient backfill for Sean (`apply:false`) — confirms eligibility and that
   the run doc claims cleanly.
2. Live run, same runId, resume until `pending:0`. Verify his subcollections.
3. Decide on the two gaps for him specifically: the explicit `hydrationStatus: 'complete'`
   write (needed for the screen to clear), his missing letters, and whether to settle the
   stranded token.
4. Only then scope D-317 properly — it is the fix that stops the next slow-chart claimer from
   landing in the same place.

Nothing above has been executed; awaiting your approval on step 1.
