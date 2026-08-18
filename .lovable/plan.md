# Release 2a — remaining items, sequenced

Storage re-key and the internal UUID move to 2b (they belong with the identity model). What stays in 2a is everything that makes today's artifacts provably reachable and every active member provisioned.

Order matters: measure first, then heal, then prove, then close the roster gap.

## A. Coverage audit (measure before fixing)

A read-only Firebase job that walks every document reference carrying `hasArtifact: true` and checks the object actually exists in Storage.

- Writes one report doc per run: total referenced, present, missing, plus the missing list (patient id, document id, expected path, first-seen).
- Runs on demand and nightly. No writes to patient data.
- Surfaced in this app as an **Artifact Coverage** card in Administration → Integrations: coverage percentage, missing count, last run, and a downloadable CSV of misses.

Exit: a hard number we trust, refreshed nightly.

## B. Self-heal — nightly sweep first

- **Nightly sweep** reads the audit's missing list, re-fetches each document from Elation, stores it at the current path, and marks the repair with an audit row.
- Bounded per run (fixed batch cap), single-flight lease so two runs never overlap, per-document idempotent marking so a re-run skips what already healed.
- A document that fails N times is parked and raises an integration-health alert instead of retrying forever.

## C. On-miss backstop (async, never blocking)

- A patient read that hits a missing object enqueues a repair and immediately returns a "preparing your document" state — no Elation round-trip on the hot path.
- Dedup on document id so a refresh-happy member cannot queue the same repair twice.
- Portal-side copy and state shipped as a patch under `firebase-handoff/`.

## D. Red-team suite (go/no-go gate)

A permanent test suite run in CI, not a one-off pass:

- cross-patient path guessing and direct object access on a private bucket
- stale and replayed signed URLs
- revoked grants, suspended patients, hidden items still hidden
- the repair queue cannot be used to fetch another patient's document

Green suite is required before 2a is called done.

## E. Close the member-coverage gap

- Re-run reconciliation to get today's exact set (fixture excluded).
- Provision in batches from the dialog that already exists: validate on 5, then adults-only batches.
- Review the ~42 portal records with no active Hint membership separately — no automatic action.

Exit for 2a: coverage 100%, sweep proven on a seeded miss, red-team green, zero active Hint members without a portal record.

## Technical notes

- Firebase repo work ships as patches under `firebase-handoff/portal-artifact-integrity/`: the audit job, the sweep job, the queue + on-miss handler, and the CI test suite.
- This app gets a read-only Artifact Coverage panel reading the audit report through the existing `firestore-bridge` (new whitelisted collection), plus an alert path through `integration-health-check`.
- Both jobs follow the background-job rules already used here: bounded batch, single-flight lease, idempotent progress, circuit breaker on repeated upstream failure.

## Not in scope

Internal UUID minting, artifact re-key to `artifacts/<internalPatientId>/…`, guardian links, minor policy — all 2b.
