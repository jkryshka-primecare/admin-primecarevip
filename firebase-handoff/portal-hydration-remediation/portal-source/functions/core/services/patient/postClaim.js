// functions/core/services/patient/postClaim.js
// Shared post-bind steps for every path that activates a member account:
//   9b   status invited -> active
//   9b-i claim-time guardian bind (#510)
//   9c   first-claim hydration (#304, D-317 soft budget, D-319 deferred retry)
// Moved VERBATIM out of claimAccount.js (no behaviour change) so social sign-in
// path B (#585) runs the identical hydration instead of a second copy.
// `actor` is only the log tag; claimAccount passes 'claimAccount'.
// Never throws (every step was already fail-soft in claimAccount).

const admin = require('firebase-admin');
const { log, logError } = require('../../../middleware/logger');
const { bindGuardianUid } = require('./guardians');
const { backfillElationReports } = require('../../../backfillElationReports');
const { backfillElationLetters } = require('../../../backfillElationLetters');
const {
  CLAIM_SOFT_BUDGET_MS,
  DEFER_REASON_SOFT_BUDGET,
  STATUS_DEFERRED,
  SOURCE_CLAIM,
  reportsOk,
  lettersOk,
  terminalStatus,
  writeTerminalStatus,
  markDeferred,
} = require('./hydrationStatus');
const {
  bindGuardianLinksForClaimer,
  GUARDIAN_BIND_MAX_SCAN,
  GUARDIAN_BIND_MAX_CHILDREN,
} = require('./claimTimeGuardianBind');

async function runPostClaimSteps({ elationPatientId, uid, actor = 'claimAccount', skipHydration = false, ownsPending = false }) {
  // 9b) Flip lifecycle status invited -> active (#303). bindMember owns identity
  //     (firebaseUid), NOT lifecycle — so the CF writes status. Ordered AFTER a
  //     successful bind and idempotent (merge). A failure HERE leaves the patient
  //     bound-but-invited (can log in; delta poller won't ingest until active,
  //     D-095) — recoverable, not corrupt: #304 backfill defensively re-asserts
  //     status:active. Log loudly; do NOT fail the response (account is live).
  try {
    await admin.firestore().collection('patients').doc(String(elationPatientId)).set({ status: 'active' }, { merge: true });
  } catch (err) {
    logError(actor, 'status-activate-failed', err, { elationPatientId, uid });
    // non-fatal: patient is bound; status self-heals on #304 backfill.
  }

  // 9b-i) #510 CLAIM-TIME GUARDIAN BIND. Path A resolution, at the only moment we
  //     know both halves of the identity: this claimer's chart id (elationPatientId)
  //     and their brand-new Auth uid. For every minor carrying an ACTIVE guardian
  //     entry whose `guardianElationId` equals this chart id, stamp
  //     `guardians[i].guardianUid` with the LOWERCASED uid (D-016 Firestore-key
  //     form) — the same field the 48-record identity backfill wrote, and the field
  //     `resolveGuardianAccess` / `getMyDependents.looksLikeMine` read on the fast
  //     path. Without this a newly-onboarded parent would need a separate backfill
  //     run before their children resolved.
  //
  //     SCOPE: chart-backed entries ONLY. `email_on_file` links (guardianElationId
  //     null) are phase 2 and are deliberately NOT bound here — binding by a shared
  //     email fuses two parents' proxies and breaks per-parent revocation
  //     (guardians.js, bindGuardianUid).
  //     IDENTITY: never derive identity from the email format (D-016). True-case
  //     `userRecord.uid` is for Auth ops only; `uid` (lowercased) is the Firestore key.
  //     IDEMPOTENT: `bindGuardianUid` is a no-op on an entry already bound to this
  //     uid, and fails closed (ALREADY_BOUND / GUARDIAN_NOT_BINDABLE) otherwise.
  //     FAIL-SOFT: any failure logs `guardian-bind-failed` and NEVER fails the claim —
  //     activation still returns 200 and the birthday sweep / identity backfill remain
  //     the safety net.
  //     The logic lives in `core/services/patient/claimTimeGuardianBind.js` so the
  //     scope / consent-gate / fail-soft contract is unit-testable without an
  //     emulator (test/unit/claim-time-guardian-bind.test.js). It never throws.
  await bindGuardianLinksForClaimer({
    db: admin.firestore(),
    bindGuardianUid,
    elationPatientId,
    uid,
    log,
    logError,
    maxScan: GUARDIAN_BIND_MAX_SCAN,
    maxChildren: GUARDIAN_BIND_MAX_CHILDREN,
  });




  // Invite claims persist a durable worker job before requesting a session.
  // Social path B keeps its existing awaited behavior until its separate review.
  if (skipHydration) return;

  // 9c) First-claim hydration (#304). Pull this patient's historical Elation reports +
  //     letters into the store so records are present on first login. AWAITED: Firebase
  //     does not run work after the response returns, so the claim waits (~seconds for
  //     one patient, bounded by timeoutSeconds:180) and returns with hydrationStatus
  //     already resolved. #305 UI reads hydrationStatus (D-108).
  //     Guard (D-108 / #304 acceptance): fire ONLY if hydrationStatus is unset, so a
  //     re-claim / re-login never double-enqueues. Set 'pending' synchronously before
  //     the async kickoff so a concurrent re-entry sees it.
  try {
    const pRef = admin.firestore().collection('patients').doc(String(elationPatientId));
    // Atomically claim hydration: read hydrationStatus and set 'pending' only if unset,
    // inside one transaction. Prevents two concurrent claims both firing the backfill
    // (the read-then-set version had a race window). claimed=true only for the winner.
    const claimed = await admin.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(pRef);
      const data = snap.exists ? (snap.data() || {}) : {};
      const already = data.hydrationStatus;
      // Stale-pending recovery: a hydration that timed out (timeoutSeconds:180) or
      // crashed leaves hydrationStatus stuck at 'pending' — the terminal write never
      // ran (Cloud Functions halts execution at timeout; the catch does not run).
      // Allow re-claiming a 'pending' older than the timeout budget so a later login
      // resumes hydration, without reintroducing the concurrent double-fire (a fresh
      // 'pending' from a still-running attempt is NOT reclaimable).
      const pendingAt = data.hydrationPendingAt && typeof data.hydrationPendingAt.toMillis === 'function'
        ? data.hydrationPendingAt.toMillis() : 0;
      const stalePending = already === 'pending' && (Date.now() - pendingAt) > 180000;
      // D-319 — a `deferred` member who comes back IS allowed to re-fire
      // hydration. Before this, 9c skipped them (`already` was set), so the
      // only drain was the operator; combined with the standing run never being
      // ticked, "records loading" was self-resolving in name only. Re-entry is
      // safe: the runners skip already-stored artifacts, the soft budget still
      // bounds this call, and a second expiry just re-defers (markDeferred's
      // enqueue is an idempotent arrayUnion). `failed` and `complete` stay
      // untouched here — those are operator/force territory.
      const deferredRetry = already === STATUS_DEFERRED;
      if (already === undefined || already === null || stalePending || deferredRetry || (ownsPending && already === 'pending')) {
        tx.set(pRef, {
          hydrationStatus: 'pending',
          hydrationPendingAt: admin.firestore.FieldValue.serverTimestamp(),
          // Clear the prior deferral markers so `deferred` always describes the
          // CURRENT state; the standing-run entry is left alone on purpose, so
          // the drain still owns this member if the re-click dies too.
          ...(already === STATUS_DEFERRED ? {
            hydrationDeferredAt: null,
            hydrationDeferReason: null,
          } : {}),
        }, { merge: true });
        return true;
      }
      return false;
    });
    if (claimed) {
      // AWAITED (not fire-and-forget): Firebase Cloud Functions do not run background
      // work after the response is sent — code after the function returns loses CPU
      // and will not complete (Firebase Tips & tricks). So hydration is awaited here.
      //
      // D-317 SOFT BUDGET. timeoutSeconds is 180; a chart whose /reports/ list
      // takes ~28s per call does not fit, and the instance used to be KILLED
      // inside this block — the terminal write never ran and the member was
      // left on `pending` forever with no recovery path. Hydration now races a
      // CLAIM_SOFT_BUDGET_MS timer (~120s, well under the cap): if the budget
      // wins, we stop awaiting, write `deferred` + a hydrationRunId and enqueue
      // the member on the standing recovery run, all inside the remaining
      // headroom. A bare `pending` is no longer a reachable end state here.
      try {
        // Defensively re-assert status:active (the 9b write may have failed; the
        // ingest gates require status==='active' to store anything).
        await pRef.set({ status: 'active' }, { merge: true });

        let softTimer = null;
        const softBudget = new Promise((resolve) => {
          softTimer = setTimeout(() => resolve({ __deferred: true }), CLAIM_SOFT_BUDGET_MS);
          if (softTimer && typeof softTimer.unref === 'function') softTimer.unref();
        });
        const hydrate = (async () => {
          const reportsRes = await backfillElationReports(admin.firestore(), admin.firestore.FieldValue, [String(elationPatientId)]);
          const lettersRes = await backfillElationLetters(admin.firestore(), admin.firestore.FieldValue, [String(elationPatientId)]);
          return {
            reports: (reportsRes && reportsRes.perPatient && reportsRes.perPatient[0]) || {},
            letters: (lettersRes && lettersRes.perPatient && lettersRes.perPatient[0]) || {},
          };
        })();

        const outcome = await Promise.race([hydrate, softBudget]);
        if (softTimer) clearTimeout(softTimer);

        if (outcome && outcome.__deferred) {
          // The in-flight hydration keeps running until the instance ends; its
          // writes are idempotent, and the recovery driver skips what is stored.
          await markDeferred(admin.firestore(), admin.firestore.FieldValue, elationPatientId, {
            reason: DEFER_REASON_SOFT_BUDGET,
          });
          log(actor, 'hydration-deferred', {
            elationPatientId, uid, softBudgetMs: CLAIM_SOFT_BUDGET_MS,
          });
        } else {
          // Verify (cursor-exhaustion — Elation list envelopes carry NO count field,
          // confirmed live for /reports/, /letters/, and the feed; D-108 amended).
          // Reports: no per-patient errors AND not wrongly skipped.
          // Letters: no errors, not wrongly skipped, AND stored == listed - skippedDeleted.
          // The rule itself now lives in the shared helper so the recovery driver
          // applies it identically — `complete` always means BOTH resources passed.
          const rpc = outcome.reports;
          const lpc = outcome.letters;
          const finalStatus = terminalStatus({ reports: rpc, letters: lpc });
          await writeTerminalStatus(
            admin.firestore(), admin.firestore.FieldValue, elationPatientId, finalStatus,
            { source: SOURCE_CLAIM },
          );
          log(actor, 'hydration-' + finalStatus, {
            elationPatientId, uid,
            reportsOk: reportsOk(rpc), lettersOk: lettersOk(lpc),
            reports: { stored: rpc.stored, listed: rpc.listed, errors: rpc.errors },
            letters: { stored: lpc.stored, listed: lpc.listed, skippedDeleted: lpc.skippedDeleted, errors: lpc.errors },
          });
        }
      } catch (err) {
        logError(actor, 'hydration-failed', err, { elationPatientId, uid });
        try {
          await writeTerminalStatus(
            admin.firestore(), admin.firestore.FieldValue, elationPatientId, 'failed',
            { source: SOURCE_CLAIM },
          );
        } catch (e2) { logError(actor, 'hydration-status-write-failed', e2, { elationPatientId, uid }); }
      }
    } else {
      log(actor, 'hydration-skip-already-set', { elationPatientId, uid });
    }
  } catch (err) {
    logError(actor, 'hydration-kickoff-failed', err, { elationPatientId, uid });
    // non-fatal: account is live; hydration can be re-run manually if the kickoff failed.
  }
}

module.exports = { runPostClaimSteps };
