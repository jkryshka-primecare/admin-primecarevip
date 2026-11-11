// functions/core/services/patient/hydrationStatus.js
// D-317 — THE single source of truth for `patients/{elationPatientId}.hydrationStatus`.
//
// Before this module the terminal status was written in exactly one place, the
// claim-time block in claimAccount.js, which is why a claim that died inside
// hydration (a slow chart crossing the 180s function cap) left a member stuck on
// `pending` forever: the terminal write never ran, and no other code path was
// allowed to write it. The operator report backfill could restore the RECORDS
// but could not clear the "still setting up your records" screen, and it did not
// cover letters at all — so a member could end up with reports only under a
// status nobody could safely mark complete.
//
// LOCKED DECISIONS
//   1. ONE RULE FOR `complete`, SHARED. `terminalStatus()` is byte-for-byte the
//      rule claimAccount has always applied (claimAccount.js:445-449):
//        reports OK  = errors === 0 && !skippedNotAllowlisted && !skippedNonActive
//        letters OK  = the same three AND CURSOR EXHAUSTION,
//                      stored === listed - skippedDeleted
//        complete    = reportsOk && lettersOk, otherwise failed.
//      `complete` therefore NEVER means "reports are in". Reports-only is
//      `failed`, and a failed run is re-runnable. Both callers (claim time and
//      the recovery driver) import this function; neither re-implements it.
//   2. `deferred` IS A REAL STATE, NOT A BARE `pending`. Claim-time hydration
//      that runs out of its soft budget writes `deferred` + a `hydrationRunId`
//      and enqueues the member on the standing recovery run. `pending` now only
//      ever means "a claim is actively hydrating right now".
//   3. STALE PENDING IS STILL RECOVERABLE. Pre-D-317 members (and any claim
//      killed before it could write `deferred`) are picked up by the
//      `STALE_PENDING` rule, so nothing already stuck needs a data migration.
//   4. PURE DECISIONS ARE SEPARABLE. Everything above the write helpers takes
//      plain objects and requires no firebase-admin, so it is unit-testable
//      without the emulator.

const STATUS_PENDING = 'pending';
const STATUS_DEFERRED = 'deferred';
const STATUS_COMPLETE = 'complete';
const STATUS_FAILED = 'failed';

const HYDRATION_STATUSES = [STATUS_PENDING, STATUS_DEFERRED, STATUS_COMPLETE, STATUS_FAILED];

/** The gen-1 function cap claim-time hydration runs under (timeoutSeconds: 180). */
const CLAIM_CAP_MS = 180 * 1000;

/**
 * Claim-time soft budget. Hydration stops AWAITING at this point and defers the
 * remainder, leaving headroom under CLAIM_CAP_MS for the deferral write, the
 * token consume and the claim response itself. Clamped so a bad env value can
 * never push it past the cap it exists to stay under.
 */
const CLAIM_SOFT_BUDGET_MS = Math.max(
  15000,
  Math.min(CLAIM_CAP_MS - 30000, Number(process.env.CLAIM_HYDRATION_SOFT_BUDGET_MS) || 120000),
);

const RECOVERY_RUNS_COLLECTION = 'hydration_runs';
const DEFAULT_RECOVERY_RUN_ID = 'hydration-recovery-standing';

const DEFER_REASON_SOFT_BUDGET = 'CLAIM_SOFT_BUDGET_REACHED';
const SOURCE_CLAIM = 'claimAccount';
const SOURCE_RECOVERY = 'hydrationRecoveryDriver';

/** Reports verdict — no per-patient errors and not wrongly skipped by a gate. */
function reportsOk(rpc) {
  const c = rpc || {};
  return Number(c.errors) === 0 && !c.skippedNotAllowlisted && !c.skippedNonActive;
}

/**
 * Letters verdict. Same three conditions PLUS cursor exhaustion: the Elation
 * /letters/ envelope carries no `count`, so completeness is proven by
 * `stored === listed - skippedDeleted` (D-108 amendment), not by a reconcile.
 */
function lettersOk(lpc) {
  const c = lpc || {};
  if (Number(c.errors) !== 0 || c.skippedNotAllowlisted || c.skippedNonActive) return false;
  const stored = Number(c.stored);
  const listed = Number(c.listed);
  const skippedDeleted = Number(c.skippedDeleted) || 0;
  if (!Number.isFinite(stored) || !Number.isFinite(listed)) return false;
  return stored === listed - skippedDeleted;
}

/**
 * The terminal status for one patient. BOTH resources must pass; reports-only
 * is `failed` by construction, which is the whole point of D-317.
 */
function terminalStatus(outcome) {
  const o = outcome || {};
  return (reportsOk(o.reports) && lettersOk(o.letters)) ? STATUS_COMPLETE : STATUS_FAILED;
}

function millisOf(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** A `pending` older than the claim cap can only be an abandoned claim. */
function isStalePending(data, now, capMs) {
  const d = data || {};
  if (d.hydrationStatus !== STATUS_PENDING) return false;
  const cap = Number(capMs) || CLAIM_CAP_MS;
  const at = millisOf(d.hydrationPendingAt);
  return (Number(now) || Date.now()) - at > cap;
}

/**
 * Is this member owed hydration recovery?
 *
 * Only a CLAIMED, ACTIVE member qualifies — recovery must never be the thing
 * that opens the #403 claimed-active ingest gate for somebody who has not
 * claimed. `force` re-admits terminal states for an operator re-run; it cannot
 * re-admit an unclaimed member.
 */
function recoveryEligibility(data, now, capMs, opts) {
  const options = opts || {};
  if (!data) return { eligible: false, reason: 'NO_PATIENT_DOC' };
  if (data.status !== 'active' || !data.firebaseUid) {
    return { eligible: false, reason: 'NOT_CLAIMED_ACTIVE' };
  }
  const status = data.hydrationStatus;
  if (status === STATUS_DEFERRED) return { eligible: true, reason: 'DEFERRED' };
  if (isStalePending(data, now, capMs)) return { eligible: true, reason: 'STALE_PENDING' };
  if (status === STATUS_PENDING) return { eligible: false, reason: 'PENDING_FRESH' };
  if (status === STATUS_FAILED) {
    return options.force
      ? { eligible: true, reason: 'FORCED_FAILED' }
      : { eligible: false, reason: 'TERMINAL_FAILED' };
  }
  if (status === STATUS_COMPLETE) {
    return options.force
      ? { eligible: true, reason: 'FORCED_COMPLETE' }
      : { eligible: false, reason: 'ALREADY_COMPLETE' };
  }
  // No hydration has ever been attempted for a claimed active member: that is
  // itself a miss (a pre-D-108 claim, or a provisioning/claim ordering bug).
  return { eligible: true, reason: 'NEVER_HYDRATED' };
}

/**
 * Enqueue a member on the standing recovery run doc. Additive and idempotent —
 * `arrayUnion` on a merge write, so a repeat defer is a no-op and this can never
 * clobber a run in flight.
 */
async function enqueueForRecovery(db, FieldValue, elationPatientId, runId) {
  const id = String(elationPatientId);
  const ref = db.collection(RECOVERY_RUNS_COLLECTION).doc(runId || DEFAULT_RECOVERY_RUN_ID);
  await ref.set({
    runId: runId || DEFAULT_RECOVERY_RUN_ID,
    standing: true,
    queued: FieldValue.arrayUnion(id),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return ref.id;
}

/** Write the terminal status. The ONLY writer of `complete` / `failed`. */
async function writeTerminalStatus(db, FieldValue, elationPatientId, status, meta) {
  if (status !== STATUS_COMPLETE && status !== STATUS_FAILED) {
    throw new Error('HYDRATION_STATUS_NOT_TERMINAL');
  }
  const m = meta || {};
  await db.collection('patients').doc(String(elationPatientId)).set({
    hydrationStatus: status,
    hydrationCompletedAt: FieldValue.serverTimestamp(),
    hydrationLastSource: m.source || SOURCE_RECOVERY,
    hydrationLastRunId: m.runId || null,
  }, { merge: true });
  return status;
}

/**
 * Mark a member deferred and enqueue them. Never leaves a bare `pending`:
 * the status write and the enqueue happen together, so "deferred" always has a
 * queue entry behind it.
 */
async function markDeferred(db, FieldValue, elationPatientId, meta) {
  const m = meta || {};
  const runId = m.runId || DEFAULT_RECOVERY_RUN_ID;
  await db.collection('patients').doc(String(elationPatientId)).set({
    hydrationStatus: STATUS_DEFERRED,
    hydrationDeferredAt: FieldValue.serverTimestamp(),
    hydrationDeferReason: m.reason || DEFER_REASON_SOFT_BUDGET,
    hydrationRunId: runId,
  }, { merge: true });
  await enqueueForRecovery(db, FieldValue, elationPatientId, runId);
  return { status: STATUS_DEFERRED, runId };
}

module.exports = {
  STATUS_PENDING,
  STATUS_DEFERRED,
  STATUS_COMPLETE,
  STATUS_FAILED,
  HYDRATION_STATUSES,
  CLAIM_CAP_MS,
  CLAIM_SOFT_BUDGET_MS,
  RECOVERY_RUNS_COLLECTION,
  DEFAULT_RECOVERY_RUN_ID,
  DEFER_REASON_SOFT_BUDGET,
  SOURCE_CLAIM,
  SOURCE_RECOVERY,
  reportsOk,
  lettersOk,
  terminalStatus,
  isStalePending,
  recoveryEligibility,
  enqueueForRecovery,
  writeTerminalStatus,
  markDeferred,
};
