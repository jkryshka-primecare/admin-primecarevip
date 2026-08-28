# Backfill run-level completion & resume model

Scope: `functions/backfillElationReportsHttp.js` only. This is the **run-level**
fix (a 960-patient run cannot finish in one invocation). It is separate from
#459, which bounds **per-patient** hangs.

## The bug

`driveRun` claimed the run doc with `status:'running'` and only ever moved it off
that status inside a `try/catch`. When Cloud Functions SIGKILLs the instance at
the 540s cap, **no JS runs** — no `catch`, no `finally`. The doc stayed
`running` forever, and the apply guard (`if (d.status === 'running') -> 409`)
refused every resume of that runId. Each 540s cycle of a long run therefore
manufactured a permanent zombie.

## The model

### 1. Graceful pre-timeout pause
`driveRun` records `startedAtMs` on entry. Before starting **each chunk** it
checks elapsed against `SOFT_BUDGET_MS = 500_000` (40s of headroom under the
540s cap, which is more than one checkpoint write needs). At/over budget it:

- stops starting new patients,
- flushes the cursor (`pending`, `counters`, `reportTypeCensus`, `failed`),
- writes `status:'paused'`, `pauseReason:'SOFT_BUDGET_REACHED'`, `pausedAt`,
- releases the lease (`leaseOwner:null`, `leaseExpiresAt:0`),
- returns cleanly.

The cursor is `pending`, which is already checkpointed per completed id, so the
pause loses no work even if it lands mid-chunk.

### 2. Resume
Re-POST the same `runId` with the same options. Resumable states: `paused`,
`error`, `claimed`, and `running` with a dead lease. `complete` short-circuits
with `alreadyComplete:true` instead of restarting. The run continues from
`pending`; `cycles` increments each time an instance picks the run up.

### 3. Stale-lease override (dead-instance detection)
Every running instance holds a lease on the run doc:

- `leaseOwner` — `${K_REVISION}-${startMs36}-${rand}`, unique per invocation.
- `leaseExpiresAt` — epoch ms, `now + LEASE_TTL_MS (120s)`.

**Renewal is a heartbeat, not work.** A `setInterval` fires every
`HEARTBEAT_MS (30s)` for as long as `driveRun` is executing and writes *only*
the two lease fields. Chunk writes and per-completed-patient checkpoints also
carry a renewal, but they are opportunistic — the heartbeat alone keeps the
lease live. The timer is cleared before the terminal `complete` write, before
the `paused` write, on the error path, and in a `finally` (so the graceful-pause
`return` cannot leak it).

Why the heartbeat is required, and the earlier claim that was wrong: an earlier
draft of this document said "the per-patient budget is below the TTL, so a live
instance always renews before expiry." That is **false** — the runner's
per-patient budget is `PATIENT_BUDGET_MS = 420s`, which is 3.5× the 120s TTL.
With renewal only at patient/chunk boundaries, an instance that is alive and
working on one slow patient could sit with an **expired lease for up to ~300s**,
so a resume in that window would reclaim a live run and produce two concurrent
instances: idempotent for data, but double Elation load (429 risk) and racing
status writes. The heartbeat closes that window.

**The guarantee, precisely:** while `driveRun` is executing, `leaseExpiresAt` is
never more than `HEARTBEAT_MS + write latency` (~30–35s) in the past-to-future
sense; it is refreshed to `now + 120s` at least every 30s. Therefore
`status:'running'` **and** `leaseExpiresAt <= now` means the instance missed at
least four consecutive heartbeats and is provably gone (a SIGKILL at the 540s
cap being the expected cause). The apply guard 409s **only** on a live lease; a
stale lease is reclaimed and recorded as `reclaimedFrom: <old leaseOwner>`. Docs
with no lease field at all (written before this change) count as dead — that is
what makes the existing zombies recoverable.

**Operator stale threshold:** with the heartbeat, "no lease renewal for > 2
minutes" is a safe reclaim signal, and the console's `staleLease` flag already
computes it from `leaseExpiresAt`. The operator should key off `staleLease` /
`resumable` — **not** off counter movement. A run can legitimately show no
counter movement for up to ~7 minutes (one slow patient at the 420s budget plus
retries) while being perfectly alive; the earlier runbook rule "no counter
movement > 2 min → reclaim" is withdrawn and must not be used. Were the
heartbeat ever removed, the only safe alternative would be `LEASE_TTL_MS >
PATIENT_BUDGET_MS` (e.g. 480s) and an operator threshold above ~9 minutes.

**Chosen option:** the heartbeat (option 1), not a raised TTL. A 480s TTL would
also be correct but makes genuine zombie recovery wait 8 minutes per cycle, and
for a 4–10 cycle run that is most of an hour of operator idling.

**Fencing tokens:** worth noting, not needed here. A `leaseOwner == INSTANCE_ID`
precondition on checkpoint writes would make a reclaim strictly fence the old
owner out. With the heartbeat, the reclaim window only opens after the owner is
provably dead, and every checkpoint write is either an idempotent
`arrayUnion`/`arrayRemove` on `pending`/`completed` or a monotonic counter merge,
so a late write from a zombie owner cannot lose completed work — worst case an
id is re-visited and skipped by skip-existing. If we ever add `force:true`
reclaim of a *live* lease as routine practice (today it is an explicit operator
override), the precondition becomes necessary.

### 4. Clearing existing zombies
New action, admin-gated like every other path:

```json
{ "action": "reset", "runId": "TdyvnxsF5JKFCiTUXj85", "reason": "clear zombie", "actor": "<email>" }
```

Sets `status:'paused'`, `pauseReason:'OPERATOR_RESET'`, clears the lease, and
stamps `resetBy` / `resetReason` / `resetAt`. It refuses (409 `LEASE_LIVE`) if
the lease is still live unless `force:true`. It touches **no** patient data,
labs, imaging, or Storage objects — only the run doc's control fields. Worst
case an already-ingested id is revisited and skipped by skip-existing.

Use it once on `TdyvnxsF5JKFCiTUXj85` and `L0iCYecF1obm5bWklnAK`, then either
resume them or ignore them.

## Operator procedure (explicit)

Resume is **operator-driven re-POST**. There is no self-re-invoke and no
scheduler — deliberately: a self-re-invoking function that mis-detects
completion loops forever against Elation, and this is a one-off migration, not a
standing job.

Per cycle:

1. Watch the console card (it polls `action:'status'` every 10s).
2. When status flips to `paused` (or `running` with `staleLease:true` — i.e. the
   heartbeat has been silent >120s), press Apply again with the **same runId** —
   the console's resume-ID field. Do **not** reclaim on "counters haven't moved";
   a live instance can be inside one slow patient for up to ~7 minutes.
3. Repeat until `status:'complete'` and `pending:0`.

Cycle math for ~960 adults: at concurrency 5 and a realistic 10–25s per patient,
one 500s cycle drains roughly 100–250 patients, so expect **4–10 cycles**,
i.e. 45–90 minutes of wall clock with an operator pressing Apply every ~8
minutes. Worst case (every patient near the 420s per-patient budget) it is more
cycles, but progress is always monotonic — each cycle only ever adds to
`completed`.

## Not in this PR

- Per-patient in-band checkpointing / `inFlight` / abandon-and-advance (separate
  change, still unpushed).
- Any runner (`backfillElationReports.js`) change.
- Console/edge changes: the existing resume-ID + polling UI already drives this;
  the `reset` action is currently invoked via the portal-admin passthrough.
