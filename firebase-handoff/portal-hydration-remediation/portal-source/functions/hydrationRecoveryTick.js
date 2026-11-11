// functions/hydrationRecoveryTick.js
// D-319 — the scheduled drain for the standing hydration recovery run.
//
// THE GAP THIS CLOSES. D-317 made a stranded member RECOVERABLE: claim-time
// hydration that runs out of budget writes `hydrationStatus: 'deferred'` and
// enqueues the member on `hydration_runs/hydration-recovery-standing`. But
// nothing ever drained that queue — `index.js` registers no schedule for
// hydration, and `backfillDriverTick`'s circuit breaker 6 is opt-in on its own
// `driver_state` runIds. So `deferred` was recoverable in theory and terminal in
// practice: the member sat on "records loading" until an operator noticed.
//
// WHAT THIS DOES. Every 30 minutes: read the fail-closed switch, refuse if the
// standing run's lease is live, refill the durable cursor from the queue plus
// the driver's own read-only selection, and hand off to the UNCHANGED D-317
// `driveRun`. Terminal status is still written by `writeTerminalStatus` alone.
//
// WHAT IT DOES NOT DO.
//   * It never touches `failed`. `recoveryEligibility` refuses a terminal
//     failure without `force`, and a timer must not hold `force` — a chart that
//     fails structurally upstream would be retried forever, hammering Elation
//     and rewriting the same status. Recovering a `failed` member stays an
//     operator action through `hydrationRecoveryDriver`.
//   * It never widens the #403 gate: selection is claimed-active members only.
//   * It holds no in-memory state. "Next tick" and "restart after a kill" are
//     the same code path, which is why a 540s cap is survivable here.
//
// CADENCE / MEMBER-VISIBLE WAIT. 30 minutes, 48 runs a day, nearly all of them
// an empty read. Deferrals are rare (they need a chart slow enough to blow a
// 120s claim budget) and the member already has a live account and a bounded
// wait, so a faster tick buys little and keeps a 2GB instance warm for nothing.
// The consequence is a member-visible wait of UP TO ~30 MINUTES plus the run
// itself: member-facing copy must promise a self-resolving wait, never "a
// moment" or any specific short duration.

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { log, logError } = require('./middleware/logger');
const {
  RECOVERY_RUNS_COLLECTION,
  DEFAULT_RECOVERY_RUN_ID,
  SOURCE_RECOVERY,
  recoveryEligibility,
} = require('./core/services/patient/hydrationStatus');
const {
  DRAIN_CONFIG_DOC,
  drainConfig,
  tickDecision,
  nextPending,
  consumedFromQueue,
} = require('./core/services/patient/hydrationDrain');
const { _selectCohort, _driveRun } = require('./hydrationRecoveryDriver');

const REGION = 'us-central1';
const TICK_ACTOR = `system:${SOURCE_RECOVERY}:d319`;
/** Consecutive blocked/paused ticks before the log line is alert-worthy. */
const STALL_ALERT_AFTER = 6; // ~3 hours at a 30-minute cadence

function db() { return admin.firestore(); }

/**
 * One tick. Returns the summary that goes to the log line — every field is a
 * count or a reason token, never PHI.
 */
async function runTick() {
  const FieldValue = admin.firestore.FieldValue;
  const now = Date.now();
  const runRef = db().collection(RECOVERY_RUNS_COLLECTION).doc(DEFAULT_RECOVERY_RUN_ID);

  const cfgSnap = await db().collection('config').doc(DRAIN_CONFIG_DOC).get();
  const config = drainConfig(cfgSnap.exists ? cfgSnap.data() : null);

  const runSnap = await runRef.get();
  const run = runSnap.exists ? (runSnap.data() || {}) : {};
  // Do not let the recovery safety-net queue race a fresh claim worker.
  const queuedRaw = Array.isArray(run.queued) ? run.queued : [];
  const queued = [];
  if (config.enabled) {
    for (const id of queuedRaw) {
      const patient = await db().collection('patients').doc(String(id)).get();
      if (recoveryEligibility(patient.exists ? patient.data() : null, now).eligible) queued.push(String(id));
    }
  }

  // Cheap gates first: never pay for a cohort scan on a disabled or busy tick.
  const preflight = tickDecision({
    config, run, queuedOrEligible: queued.length, now,
  });
  if (!preflight.run && preflight.reason !== 'NOTHING_OWED') {
    return { ok: true, drove: false, reason: preflight.reason, maxPerTick: config.maxPerTick };
  }

  const selection = await _selectCohort(config.maxPerTick * 4);
  const decision = tickDecision({
    config, run, queuedOrEligible: queued.length + selection.eligible.length, now,
  });
  if (!decision.run) {
    await runRef.set({
      lastTickAt: FieldValue.serverTimestamp(),
      lastTickReason: decision.reason,
      consecutiveBlockedTicks: decision.reason === 'NOTHING_OWED' ? 0 : FieldValue.increment(1),
    }, { merge: true });
    return {
      ok: true,
      drove: false,
      reason: decision.reason,
      eligible: selection.eligible.length,
      queued: queued.length,
    };
  }

  const pending = nextPending({
    pending: run.pending,
    queued,
    eligible: selection.eligible,
    maxPerTick: config.maxPerTick,
  });
  const consumed = consumedFromQueue(queued, pending);

  await runRef.set({
    runId: DEFAULT_RECOVERY_RUN_ID,
    standing: true,
    actor: TICK_ACTOR,
    reason: 'D-319 scheduled drain of the standing hydration recovery run',
    pending,
    cohortSize: pending.length,
    status: 'claimed',
    claimedAt: FieldValue.serverTimestamp(),
    lastTickAt: FieldValue.serverTimestamp(),
    lastTickReason: decision.reason,
    ...(consumed.length ? { queued: FieldValue.arrayRemove(...consumed) } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  const outcome = await _driveRun(DEFAULT_RECOVERY_RUN_ID, TICK_ACTOR);
  const results = Array.isArray(outcome.results) ? outcome.results : [];
  const completed = results.filter((r) => r.status === 'complete').length;
  const failed = results.filter((r) => r.status === 'failed').length;

  // A pause is normal progress (soft budget, Elation busy) — the next tick
  // resumes the same cursor. It only becomes a signal when it REPEATS.
  const blocked = outcome.status === 'paused';
  await runRef.set({
    consecutiveBlockedTicks: blocked ? FieldValue.increment(1) : 0,
  }, { merge: true });
  const blockedCount = blocked ? (Number(run.consecutiveBlockedTicks) || 0) + 1 : 0;

  return {
    ok: true,
    drove: true,
    reason: decision.reason,
    driven: pending.length,
    status: outcome.status,
    pauseReason: outcome.pauseReason || null,
    remaining: outcome.pending,
    completed,
    failed,
    consecutiveBlockedTicks: blockedCount,
    stalled: blockedCount >= STALL_ALERT_AFTER,
  };
}

const hydrationRecoveryTick = functions
  .region(REGION)
  .runWith({
    timeoutSeconds: 540,
    // Matches the driver: D-318 streams artifacts, so this is headroom, not a
    // dependency on chart size.
    memory: '2GB',
    secrets: ['ELATION_CLIENT_ID', 'ELATION_CLIENT_SECRET'],
  })
  .pubsub.schedule('every 30 minutes')
  .timeZone('Etc/UTC')
  .onRun(async () => {
    try {
      const out = await runTick();
      if (out.stalled) {
        // Distinct severity + a distinct message token so a log-based metric can
        // alert on a drain that has been blocked for hours without paging on
        // ordinary soft-budget pauses.
        logError(SOURCE_RECOVERY, 'drain-stalled', new Error('HYDRATION_DRAIN_STALLED'), out);
      } else {
        log(SOURCE_RECOVERY, 'drain-tick', out);
      }
    } catch (err) {
      logError(SOURCE_RECOVERY, 'drain-tick-failed', err, {});
    }
    return null;
  });

module.exports = {
  hydrationRecoveryTick,
  // exported for unit tests
  _runTick: runTick,
  STALL_ALERT_AFTER,
};
