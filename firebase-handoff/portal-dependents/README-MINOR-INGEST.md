# Answer to close-out item #2 — do loaded minors carry `labs` docs with `hasArtifact: true`?

**NOT BUILT.** Read against `primecarevip/prime-care-vip-app-v2` `main`
(`functions/ingestElationReports.js`, `functions/backfillElationReports.js`,
`functions/adminProvisionPatients.js`). Guardian reads will return "not available"
for every child until the step below exists — phase 1 authorizes correctly, but
there is nothing to authorize *to*.

## Why, precisely — three independent gates, in order

1. **Provisioning writes no documents.** `adminProvisionPatients` creates
   `patients/<elationPatientId>` only. It never touches the `labs` subcollection.
   Minors loaded in Release 2b therefore have zero report metadata today.
2. **Ingest is allowlist- and claim-gated.**
   `ingestElationReports` drops an event unless `isIngestAllowed(patient)`
   (D-068 `ELATION_READ_ALLOWLIST`) **and** `patients/<id>.status === 'active'`
   (D-111, the *claim*-lifecycle field, not `membershipStatus`). Minors never
   claim, so `status` is not `active` and every report event is skipped as
   `skip-non-active` — no metadata doc is ever written for them.
3. **Object upload is keyed on `firebaseUid`.** Only `backfillElationReports`
   uploads bytes, and it reads `pSnap.data().firebaseUid`; when it is absent it
   logs `artifact-skip-unclaimed` and **force-flips `hasArtifact: false`** on the
   metadata doc.

Consequence for the 2a machinery: `auditArtifactCoverage` walks
`collectionGroup('labs').where('hasArtifact','==',true)`, so minors are outside
the **denominator**. A "100% coverage" report today means 100% of *adults*, and
`sweepArtifactRepairs` (which only heals `MISSING_OBJECT` rows produced by that
audit) will never touch a child. Nothing self-heals its way to a working
guardian read.

## The missing step, and where it lives

A **minor-ingest** change in the portal repo's ingest path, not in this bundle:

- `functions/ingestElationReports.js` — replace the D-111 `status === 'active'`
  gate with "record exists **and** (`status === 'active'` **or** the patient is a
  guardian-proxied dependent with at least one `active` guardian entry)". Keep
  the D-068 allowlist gate, and add the minors to `ELATION_READ_ALLOWLIST`
  deliberately, in the same batch as their `internalUid` mint.
- `functions/backfillElationReports.js` — re-key the upload the same way Part B
  re-keyed the read path: resolve `internalUid` via
  `core/services/patient/internalUid.ensureInternalUid()` and write to
  `elation-artifacts/<internalUid>/<reportId>/report.pdf`. Delete the
  `firebaseUid`-missing `artifact-skip-unclaimed` branch and the
  `hasArtifact:false` flip that goes with it — "unclaimed" is now a normal state,
  not an error. The same `no-patient-doc-proceeding`/status early-return needs the
  dependent exception above.
- `functions/auditArtifactCoverage.js` (this bundle) is already internalUid-aware;
  once minors carry `hasArtifact: true`, they enter the denominator automatically
  and the sweep heals them from `/printable`. Report coverage split adult/minor so
  a minor gap can't hide inside a rounded 100%.

## Sequencing

Superseded by the merged runbook: **`README-PART-B-RUNBOOK.md`** — one order for
the adult (re-key) and minor (ingest) tracks, with a single join gate:
`auditArtifactCoverage` at 100% on **both** `bySegment.adult` and
`bySegment.minor`, each with a non-zero denominator. `GUARDIAN_READS_ENABLED`
stays OFF until that gate, one real end-to-end guardian read, and the red-team
runs are all done.

## Built

- `functions/core/services/patient/ingestEligibility.js` — the shared gate.
  Admits an unclaimed record only when `dependent.isMinor === true` **and** at
  least one guardian entry is `active`; D-068 allowlist still checked first.
- `MINOR-INGEST-CHANGES.md` — the two portal-repo function changes for review,
  with the PR notes proving the `hasArtifact:false` removal is minor-only and
  that `ensureInternalUid()` in the upload can only ever be a fallback.
- `auditArtifactCoverage.js` now reports `bySegment.adult` / `bySegment.minor`, and
  `bySegment.minor.byLinkage.chartBacked` / `.emailOnFile` so the 40 email-only
  children are a visible line in the report. Scope decision (ingest all 175) and
  the join-gate addendum live in `README-PART-B-RUNBOOK.md`.

