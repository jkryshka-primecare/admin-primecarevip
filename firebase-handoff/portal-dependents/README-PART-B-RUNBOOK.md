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
