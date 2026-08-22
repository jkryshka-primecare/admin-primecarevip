# Release 2b · Part B — the single runbook (adult track + minor track)

Two parallel tracks feed one audit. `README-INTERNAL-UID.md` is the **adult**
track (storage re-key); `README-MINOR-INGEST.md` + `MINOR-INGEST-CHANGES.md` are
the **minor** track (turning ingest on for guardian-proxied dependents). Running
one track to "100%" while the other never populated is the failure this document
exists to prevent — hence one join gate on **both** splits.

`GUARDIAN_READS_ENABLED` stays **OFF** until every line below is done.

## Order

```
1. backfillInternalUids  (adults + minors, dry-run then apply)   -> failed: 0
        |                                          |
   ADULT track                                 MINOR track
2a. dual-read window ON                   2b. deploy minor-ingest
    (ARTIFACT_LEGACY_UID_FALLBACK)            (ingestElationReports gate +
3a. backfillArtifactObjects (COPY)             backfillElationReports re-key)
    legacy -> internalUid path            3b. add the 175 minors to
                                              ELATION_READ_ALLOWLIST
                                          4b. backfillElationReports over the
                                              175 minor ids
        |                                          |
        +--------------------+---------------------+
                             v
5. JOIN GATE: auditArtifactCoverage with ARTIFACT_LEGACY_UID_FALLBACK=false
     report.bySegment.adult.coveragePct === 100  AND adult.referenced > 0
     report.bySegment.minor.coveragePct === 100  AND minor.referenced > 0
     unpathedCount === 0, erroredCount === 0, truncatedWalk === false
6. one real guardian resolves one real child PDF end to end   (Condition 1)
7. red-team: Run 1 green; Run 2 and 2b mutation red -> revert -> green
8. GUARDIAN_READS_ENABLED = true
9. cleanup: delete the legacy fallback branch, then legacy objects
```

## Why the gate reads `bySegment`, not `coveragePct`

`auditArtifactCoverage` now reports per-cohort counts (`bySegment.adult`,
`bySegment.minor`), split on `patients/<id>.dependent.isMinor`. Before step 2b
the minor split is `{ referenced: 0, coveragePct: null }` — and `null` is **not**
a pass. A zero denominator is the exact way a child gap hides inside a rounded
overall 100%, so the gate requires a non-zero `referenced` on both sides.

## Step notes

1. **Mint** — `backfillInternalUids`, admin-only, dry-run default, resumable.
   Everything downstream assumes this finished: the upload's
   `ensureInternalUid()` is a fallback that returns the existing value, never a
   second mint.
2a/3a. **Adult re-key** — dual-read window (14 days, or 3 consecutive clean
   audits, whichever is later), then `backfillArtifactObjects`. **Copy, never
   move**; legacy objects are deleted only in step 9.
2b. **Minor ingest** — the two changed portal-repo functions, reviewed per
   `MINOR-INGEST-CHANGES.md`. Both conditions (`dependent.isMinor === true` AND
   >= 1 `active` guardian entry) are required; the D-068 allowlist still gates
   first.
3b. **Allowlist** — deliberate, batched with the mint. Minors are not
   auto-allowlisted anywhere.
4b. Once minors carry `hasArtifact: true` they enter the denominator
   automatically and `sweepArtifactRepairs` heals misses from `/printable`.

## Invariants held throughout

UBLA + Public Access Prevention, no public object ACLs, v4 signing only,
suppression checked before any Storage access, the healer writes bytes only and
never grants access, absence-never-forbidden on every denial path.

## Open item 1 — `email_on_file` ingest scope: recommendation is (a), ingest all 175

Ingest all 175 minors now; do **not** carve the 40 `email_on_file` children out of
phase 1.

Why:

- **Minimum-necessary governs use and disclosure, not which of the covered
  entity's own systems holds the record.** Elation already holds these charts;
  copying report bytes into the practice's own UBLA/PAP-locked bucket, behind a
  read path whose flag is OFF and whose guardian resolver *strictly* rejects an
  email-only link, is not a new disclosure. Nothing becomes reachable.
- **The security boundary is the resolver, not the bucket.** `resolveGuardianAccess`
  authorizes only on a non-empty `callerElationId === guardianElationId`; the
  null-fence regression test in `artifact-ownership.test.js` exists precisely so
  an email-only child can never resolve. Withholding ingest would be a second,
  weaker copy of a control we already prove under mutation.
- **A split ingest weakens the gate we built.** Option (b) makes the phase-1
  minor denominator 135 and requires a hand-maintained exclusion list; the gate
  then reads 100% of a number a human chose. Ingesting all 175 keeps the
  denominator machine-derived from `dependent.isMinor`, so a missing child is a
  red gate rather than a bookkeeping question.
- **Phase 2 becomes a flag flip, not a data migration.** The 40 need no backfill
  window, no second allowlist batch, no second audit convergence.

Cost of (a) is 40 children's PDFs at rest ahead of readability — accepted, and
recorded here as a deliberate decision.

### Making the 40 visible rather than hidden

Whichever option, the honest-denominator concern is real, so
`auditArtifactCoverage` now reports `bySegment.minor.byLinkage`:

```
bySegment.minor.byLinkage.chartBacked   // >= 1 ACTIVE guardian with guardianElationId
bySegment.minor.byLinkage.emailOnFile   // the 40 — no chart-backed active guardian
```

Split on readability, not age, and derived from the same patient doc read (no
extra cost). Under (a) both sub-splits must be 100 with non-zero `referenced` at
the join gate — expect ~135 / ~40. Had we taken (b), the exact same field
expresses it: gate on `chartBacked` only, and require
`emailOnFile.referenced === 0` so the deferral is asserted rather than assumed.
Either way the 40 are a printed line in the report.

Join-gate addendum (option (a)):

```
report.bySegment.minor.byLinkage.chartBacked.coveragePct === 100 && referenced > 0
report.bySegment.minor.byLinkage.emailOnFile.coveragePct === 100 && referenced > 0
```

## Open item 2 — completeness of the two portal-repo diffs

`MINOR-INGEST-CHANGES.md` is the **complete intended delta** for both functions:
the D-111 gate replacement in `ingestElationReports.js`, and in
`backfillElationReports.js` the `internalUid` re-key, the removal of the
`artifact-skip-unclaimed` / `hasArtifact:false` branch, and the same gate
exception on the row-loop early return. There is no additional hunk we are
holding back, and nothing else in either function needs to change for minor
ingest.

Caveat, stated plainly: those two files live in
`primecarevip/prime-care-vip-app-v2`, which is not in this bundle, so the hunks
were written against the code as documented — we cannot produce a
`git diff` against the real files or send the full functions from here. The
review that matters is against the actual file: apply the hunks in the portal
repo and check the three properties that carry the safety argument — the D-068
allowlist call still runs first and unchanged, `ingestEligibility` is the only
status gate left in each function, and no other `hasArtifact` write remains in
`backfillElationReports.js`. If your agent pastes the two current full files
here, we will return exact patched files rather than hunks.
