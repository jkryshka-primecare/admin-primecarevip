# Minor ingest — the two changed functions, verified against the real files

Rewritten 2026-08-22 against the actual portal-repo sources
(`functions/ingestElationReports.js` @ 239 lines, `functions/backfillElationReports.js`
@ 349 lines). The earlier draft of this file guessed at both gates and got the
backfill one wrong — see "Correction" below.

The shared decision module ships here as
`functions/core/services/patient/ingestEligibility.js`. `GUARDIAN_READS_ENABLED`
stays **OFF** through all of this.

---

## 1. `ingestElationReports.js` — the D-111 gate (lines 114–121)

Add the import next to the other `./core/...` requires (~line 50):

```js
const { ingestEligibility } = require('./core/services/patient/ingestEligibility');
```

```js
// BEFORE (114–121)
  // D-111 active-member gate: store only for a claimed patient (status === 'active',
  // the claim-lifecycle field). membershipStatus is billing-only, NOT this gate.
  const pSnap = await db.collection('patients').doc(patient).get();
  if (!pSnap.exists || (pSnap.data() || {}).status !== 'active') {
    counters.skippedNonActive += 1;
    log('ingestElationReports', 'skip-non-active', { reportId, elationPatientId: patient, feedId: Number(rec.id) });
    return; // advance (replay-safe; resurfaced if they activate + a later event fires)
  }
```

```js
// AFTER
  // D-111 active-member gate, plus the Release 2b guardian-proxied-dependent
  // exception. Single definition of "eligible" lives in ingestEligibility.
  const pSnap = await db.collection('patients').doc(patient).get();
  const gate = ingestEligibility(pSnap.exists ? pSnap.data() : null);
  if (!gate.eligible) {
    counters.skippedNonActive += 1;
    log('ingestElationReports', gate.reason, { reportId, elationPatientId: patient, feedId: Number(rec.id), cohort: gate.cohort });
    return; // advance (replay-safe)
  }
```

Notes:

- The D-068 `isIngestAllowed` check at 108–112 is **untouched** and still runs first.
- `counters.skippedNonActive` keeps its name so the run-stats shape is unchanged;
  only the log tag now varies (`skip-non-active`, `skip-minor-no-active-guardian`,
  `no-patient-doc`).
- Adults: `status === 'active'` → eligible, byte-identical behaviour. A missing
  doc still returns `no-patient-doc` and skips (hard gate preserved — this poller
  has no vetted input list).
- Minors: admitted only when `dependent.isMinor === true` **and** ≥1 guardian
  entry with `status === 'active'`. Either alone is a skip.

## 2. `backfillElationReports.js` — soft gate (105–116) and the artifact key (245–296)

```js
const { ensureInternalUid, objectPathFor } = require('./core/services/patient/internalUid');
const { ingestEligibility, isMinorRecord } = require('./core/services/patient/ingestEligibility');
```

### 2a. Correction — this gate is SOFT (D-080), not the poller's hard gate

```js
// BEFORE (105–116)
  if (pSnap.exists) {
    const status = (pSnap.data() || {}).status;
    if (status !== undefined && status !== 'active') {
      counters.patientsSkippedNonActive += 1;
      pc.skippedNonActive = true;
      log('backfillElationReports', 'skip-non-active', { elationPatientId: pid, status: status });
      return pc;
    }
  } else {
    pc.noPatientDoc = true;
    log('backfillElationReports', 'no-patient-doc-proceeding', { elationPatientId: pid });
  }
```

```js
// AFTER — D-080 soft posture preserved for ADULTS exactly: a MISSING doc still
// proceeds, and an existing doc with no `status` field still proceeds.
// MINORS are ALWAYS subject to the guardian check, regardless of `status`.
  if (pSnap.exists) {
    const data = pSnap.data() || {};
    const gate = ingestEligibility(data);
    if (!gate.eligible && (data.status !== undefined || isMinorRecord(data))) {
      counters.patientsSkippedNonActive += 1;
      pc.skippedNonActive = true;
      log('backfillElationReports', gate.reason, { elationPatientId: pid, status: data.status, cohort: gate.cohort });
      return pc;
    }
  } else {
    pc.noPatientDoc = true;
    log('backfillElationReports', 'no-patient-doc-proceeding', { elationPatientId: pid });
  }
```

Why the `|| isMinorRecord(data)` conjunct matters: without it, a minor doc whose
`status` is unset slips through D-080 without ever consulting
`ingestEligibility`, so "guardian-proxied minors only" would be enforced by the
input list rather than by the code — a guardian revoked between the batch load
and the backfill run would still get their child's PHI stored. With it, a
guardian-less minor is skipped as `skip-minor-no-active-guardian` on every path.

**What status does a minor's doc actually carry?** Verified in the repo:
`adminProvisionPatients.js` writes `status: 'not_invited'` on creation (line
224), and `adminLinkGuardian.js` never writes `status` at all. So today a
provisioned minor's `status` is **defined** (`'not_invited'`) and already routes
through the eligibility path — the extra conjunct is a belt-and-braces guard for
docs created by other/legacy writers, not a behaviour change for the 175.

The `data.status !== undefined` conjunct is what keeps D-080 soft **for adults**:
an adult doc with no `status` field proceeds today and must keep proceeding. Net
effect of the change is one new admission — a doc whose `status` is set to
something other than `active` but which is a minor with an active guardian — and
one new skip: a status-less minor with no active guardian.


### 2b. Artifact key: `firebaseUid` → `internalUid` (245–296)

```js
// BEFORE (249–262)
        const fbUid = (pSnap && pSnap.exists) ? pSnap.data().firebaseUid : null;
        if (!fbUid) {
          try {
            await db.collection('patients').doc(pid).collection('labs').doc(reportId)
              .set({ hasArtifact: false }, { merge: true });
          } catch (flipErr) { ... }
          pc.artifactSkippedUnclaimed += 1; counters.artifactSkippedUnclaimed += 1;
          log('backfillElationReports', 'artifact-skip-unclaimed', { elationPatientId: pid, reportId });
        } else {
          const uidLc = String(fbUid).toLowerCase();
          const objectPath = 'elation-artifacts/' + uidLc + '/' + reportId + '/report.pdf';
```

```js
// AFTER
        // The RECORD's id, not the caller's. Minors have no auth uid at all, so an
        // auth-keyed path cannot express a dependent's artifact and would mislocate
        // PHI under a guardian's prefix. ensureInternalUid is a fallback only —
        // backfillInternalUids has already minted for every id (runbook step 1).
        const { internalUid } = await ensureInternalUid(pid, db);
        if (!internalUid) {
          // A mint gap, NOT "no artifact": do not flip hasArtifact:false.
          pc.artifactErrors += 1; counters.artifactErrors += 1;
          log('backfillElationReports', 'artifact-skip-no-internal-uid', { elationPatientId: pid, reportId });
        } else {
          const objectPath = objectPathFor(internalUid, reportId);
```

Everything inside the `else` after `objectPath` (the `/printable` fetch, the
`%PDF-` download-back self-check, the `artifact-failed` flip) is **unchanged**.
`counters.artifactSkippedUnclaimed` and `pc.artifactSkippedUnclaimed` (lines 80,
and their declarations) become dead and can be dropped in the same PR, or left at
0 if you prefer the run-stats shape frozen.

## PR note — removing the `hasArtifact:false` unclaimed flip is minor-only

- The flip only ever ran on a `labs` metadata doc that already existed.
- `ingestElationReports` is the only writer of those docs, and pre-2b an unclaimed
  adult never passed its hard `status === 'active'` gate — so no `labs` doc exists.
- With no `labs` doc, the backfill has no row to reach line 245 with. The branch
  was unreachable for unclaimed adults; it fired only on records that had metadata
  but no `firebaseUid`, i.e. exactly the dependents this change exists to support.

Net: adults see zero behavioural delta; minors stop being force-marked "no artifact".

## Scope note

"At least one active guardian entry" ingests all 175 minors, including the 40
whose only link is `email_on_file` and whose guardians cannot read until phase 2.
Intended: the bytes sit in Storage behind the same read path as everyone else's,
`GUARDIAN_READS_ENABLED` is OFF, and those 40 belong in the minor coverage
denominator (`bySegment.minor.byLinkage.emailOnFile`).
