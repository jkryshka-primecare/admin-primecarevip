# Release 2a — remaining items, sequenced

Storage re-key and the internal UUID move to 2b (they belong with the identity model). What stays in 2a is everything that makes today's artifacts provably reachable and every active **adult** member provisioned.

Order matters: measure first, then heal, then prove, then close the roster gap.

**Revised after the review response.** The exit criterion now says *adult* members and treats minors and unresolved matches as tracked, intentional exceptions; ownership on the repair queue is derived server-side; bucket privacy and suppression-after-heal become asserted red-team cases; the coverage report is treated as PHI.

## A. Coverage audit (measure before fixing)

A read-only Firebase job that walks every document reference carrying `hasArtifact: true` and checks the object actually exists in Storage.

- **Scope, stated plainly:** this proves "no dangling 404s among referenced documents." It does **not** prove we hold everything Elation has — that is the Elation-exit question and belongs to 2b. The card labels the number "Referenced artifacts present" so 100% can never be misread as "safe to leave Elation."
- Writes one report doc per run: total referenced, present, missing, plus the missing list (patient id, document id, expected path, first-seen).
- Runs on demand and nightly. No writes to patient data.
- **The report is PHI.** Its collection is staff-only through the bridge whitelist, and the CSV export is authenticated and written to the PHI access log like every other patient read.
- Surfaced in this app as an **Artifact Coverage** card in Administration → Integrations: coverage percentage, missing count, last run, audited CSV download.

Exit: a hard number we trust, refreshed nightly.

## B. Self-heal — nightly sweep first

- **Nightly sweep** reads the audit's missing list, re-fetches each document from Elation, stores it at the current path, and marks the repair with an audit row.
- Bounded per run (fixed batch cap), single-flight lease so two runs never overlap, per-document idempotent marking so a re-run skips what already healed.
- A document that fails N times is parked and raises an integration-health alert instead of retrying forever.
- **Healing is storage-only.** It never touches `portalAccess`; hidden items stay hidden and suspended patients stay suspended after a repair. Proven by a red-team case, not by assertion.

## C. On-miss backstop (async, never blocking)

- A patient read that hits a missing object enqueues a repair and immediately returns a "preparing your document" state — no Elation round-trip on the hot path.
- **The owning patient id comes from the server-side authenticated read context, never from client input.** The enqueue accepts no caller-supplied patient id; this is the design rule that makes the "queue can't fetch another patient's document" test pass.
- Dedup on `(patientId, documentId)`, so a refresh-happy member cannot queue the same repair twice and no cross-patient collision is possible.
- Portal-side copy and state shipped as a patch under `firebase-handoff/`.

## D. Red-team suite (go/no-go gate)

A permanent CI suite, not a one-off pass:

- **Asserts bucket privacy as a test:** no `allUsers`, uniform bucket-level access, no public object ACLs. Privacy is verified every run, never assumed.
- cross-patient path guessing and direct object access
- stale and replayed signed URLs
- suspended patients get `403`; hidden items stay hidden — **including immediately after a heal**
- the repair queue cannot be pointed at another patient's document

Grant/guardian cases (revoked grant, guardian-expanded id sets) are written as **skipped forward scaffolding**, clearly marked pending 2b. They must not report green and must not gate 2a.

## E. Close the adult member-coverage gap

- Re-run reconciliation to get today's exact set (fixture excluded).
- Provision in batches from the existing dialog: validate on 5, then adults-only batches.
- **Held sets are enumerated, not assumed empty:** minors (held for 2b), `NO_MATCH` and `AMBIGUOUS_MATCH` resolver outcomes, and the ~42 portal records with no active Hint membership each get a named, reviewable list. They are tracked exceptions, not failures, and none get automatic action.

**Exit for 2a:** coverage 100% on the *referenced* set, sweep proven on a seeded miss, red-team green (privacy assertion and post-heal suppression included), and zero active **adult** Hint members without a portal record with every exception list published.

## Technical notes

- Firebase repo work ships as patches under `firebase-handoff/portal-artifact-integrity/`: the audit job, the sweep job, the queue + on-miss handler, and the CI test suite.
- This app gets a read-only Artifact Coverage panel reading the audit report through the existing `firestore-bridge` (new staff-only whitelisted collection), plus an alert path through `integration-health-check`.
- Both jobs follow the background-job rules already used here: bounded batch, single-flight lease, idempotent progress, circuit breaker on repeated upstream failure.

## Not in scope

Internal UUID minting, artifact re-key to `artifacts/<internalPatientId>/…`, guardian links, minor policy, and the "do we hold everything Elation has" completeness bar — all 2b.
