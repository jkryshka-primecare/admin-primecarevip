# Minor ingest — the two changed functions, for review

Both files live in the portal repo (`primecarevip/prime-care-vip-app-v2`), not in
this bundle; the shared decision module they import ships here as
`functions/core/services/patient/ingestEligibility.js` (real code, review that
too — it is where the gate actually lives).

`GUARDIAN_READS_ENABLED` stays **OFF** through all of this.

---

## 1. `functions/ingestElationReports.js` — the gate exception

Only the gate changes. The D-068 allowlist check is untouched and still runs
**first**; the decision is delegated so there is exactly one definition of
"eligible".

```js
// top of file
const { ingestEligibility } = require('./core/services/patient/ingestEligibility');
```

Replace the D-111 status gate:

```js
// BEFORE
if (!isIngestAllowed(patient)) { log('ingestElationReports','skip-not-allowlisted',{ id }); return; }
const pSnap = await db.collection('patients').doc(String(id)).get();
if (!pSnap.exists || pSnap.data().status !== 'active') {
  log('ingestElationReports', 'skip-non-active', { id });
  return;
}
```

```js
// AFTER
if (!isIngestAllowed(patient)) { log('ingestElationReports','skip-not-allowlisted',{ id }); return; }
const pSnap = await db.collection('patients').doc(String(id)).get();
const gate = ingestEligibility(pSnap.exists ? pSnap.data() : null);
if (!gate.eligible) {
  log('ingestElationReports', gate.reason, { id, cohort: gate.cohort });
  return;
}
log('ingestElationReports', 'ingest-allowed', { id, cohort: gate.cohort, reason: gate.reason });
```

Properties to check while reading:

- **Both conditions required.** `ingestEligibility` admits an unclaimed record
  only when `dependent.isMinor === true` **and** at least one guardian entry has
  `status === 'active'`. Either alone is a skip.
- **A converted adult cannot slip through.** The birthday sweep sets
  `dependent.isMinor = false` *and* moves every `active` entry to
  `pending_adult_consent` in the same write; condition 1 alone already denies,
  and condition 2 denies independently. Belt and suspenders.
- **`pending_adult_consent` / `revoked` never qualify** — only the literal
  string `'active'`.
- **No behaviour change for adults.** `status === 'active'` returns eligible
  exactly as before; anything else with no minor flag returns the same
  `skip-non-active` tag, so existing log-based alerts keep working.
- **Allowlist unchanged.** A minor not in `ELATION_READ_ALLOWLIST` is still
  dropped before the gate is consulted.

## 2. `functions/backfillElationReports.js` — `internalUid` re-key, dropped skip/flip

```js
const { ensureInternalUid, objectPathFor } =
  require('./core/services/patient/internalUid');
const { ingestEligibility } = require('./core/services/patient/ingestEligibility');
```

```js
// BEFORE
const uid = pSnap.data().firebaseUid;
if (!uid) {
  log('backfillElationReports', 'artifact-skip-unclaimed', { id });
  await docRef.set({ hasArtifact: false }, { merge: true });   // <- the flip
  return;
}
const path = `elation-artifacts/${uid}/${reportId}/report.pdf`;
```

```js
// AFTER
// The RECORD's id, not the caller's. Minors have no auth uid at all, so an
// auth-keyed path cannot express a dependent's artifact and would mislocate
// PHI under a guardian's prefix.
const { internalUid } = await ensureInternalUid(id);
if (!internalUid) {
  log('backfillElationReports', 'artifact-skip-no-internal-uid', { id });
  return;               // no hasArtifact flip — this is a mint gap, not "no artifact"
}
const path = objectPathFor(internalUid, reportId);
```

and the early return at the top of the row loop gets the same exception:

```js
// BEFORE:  if (!pSnap.exists || pSnap.data().status !== 'active') return;
const gate = ingestEligibility(pSnap.exists ? pSnap.data() : null);
if (!gate.eligible) { log('backfillElationReports', gate.reason, { id, cohort: gate.cohort }); return; }
```

### PR note — the `hasArtifact:false` removal is minor-only (refinement 2)

Deleting `artifact-skip-unclaimed` and its `hasArtifact:false` flip **cannot**
change behaviour for an unclaimed adult:

- The flip only ever ran on a `labs` metadata doc that already existed.
- `ingestElationReports` is the only writer of those docs, and an unclaimed
  adult (no `status === 'active'`, not a minor, no active guardian) does not
  match the exception — so no `labs` doc is ever written for them.
- With no `labs` doc, `backfillElationReports` has no row to process for that
  patient, so the removed branch was unreachable for adults. It fired only on
  records that *had* metadata but no `firebaseUid`, i.e. exactly the dependents
  this change exists to support.

Net: adults see zero behavioural delta; minors stop being force-marked
"no artifact".

### PR note — `ensureInternalUid` is a fallback, not the primary mint (refinement 4)

`backfillInternalUids` runs **before** `backfillElationReports` in the Part B
runbook, so every id already has an `internalUid` by the time the upload runs.
`ensureInternalUid` re-reads inside a transaction and returns the existing value
untouched when one is present — it can only mint for a record the backfill
missed, and it can never produce a second uid for the same record (that would
orphan objects). Ordering is enforced by the runbook, not by hope: step 4 of
`README-PART-B-RUNBOOK.md` is gated on step 1 reporting `failed: 0`.

## Scope note

"At least one active guardian entry" ingests all 175 minors, including the 40
whose only link is `email_on_file` and whose guardians cannot read until phase 2.
That is intended: the bytes sit in Storage behind the same read path as everyone
else's, `GUARDIAN_READS_ENABLED` is OFF, and those 40 children belong in the
minor coverage denominator.
