# Option A — one PR, assembled against the real repo

The design and the gate are approved. This bundle is now written against the
**actual** `primecarevip/prime-care-vip-app-v2` `functions/` tree (read from
`main`), not against an assumed layout. Two findings changed the shape of the
change — read these first, they affect review.

## Finding 1 — it is three handlers, not nine

Only `getLabs`, `getImaging` and `getMedicalRecords` have an artifact mode
(`reportId` present in the POST body switches list → artifact). `getLetters`,
`getMedications`, `getAppointments`, `getProblems` and `getAllergies` are
**list-only** — `getLetters` explicitly documents that letters have no PDF.
There is nothing in them to delegate, so touching them would be churn with
regression risk and no security gain. The refactor is three files.

## Finding 2 — ownership is uid-keyed storage, plus a reference check

Production stores artifacts at:

```
elation-artifacts/<firebaseUid>/<reportId>/report.pdf
```

and every artifact-bearing document lives in the patient's **`labs`**
subcollection, discriminated by `category` (`lab` | `imaging` |
`medical_records`). The earlier draft of `readArtifact.js` assumed a
per-collection subcollection with an `artifactPath` field; that module has been
rewritten to match reality and now enforces ownership twice:

- **reference**: `patients/<elationPatientId>/labs/<reportId>` must exist and
  not be tombstoned — otherwise 404 **and no repair is queued** (this is what
  stops the healer being steered at someone else's PHI);
- **object**: the bytes are read from the caller's own uid prefix.

## What ships in this bundle

```
functions/core/services/artifacts/readArtifact.js   NEW — handleArtifactRead (rewritten to repo reality)
functions/core/services/artifacts/repairQueue.js    C — server-derived on-miss enqueue
functions/auditArtifactCoverage.js                  A — coverage audit
functions/sweepArtifactRepairs.js                   B — nightly self-heal
functions/getLabs.js                                REFACTORED — delegates artifact mode
functions/getImaging.js                             REFACTORED — delegates artifact mode
functions/getMedicalRecords.js                      REFACTORED — delegates artifact mode
test/redteam/**                                     the gate (both test files + helpers)
```

The three refactored handlers are **complete files generated from the current
`main` copies**, so the diff is exactly the artifact branch plus two lines.
`refactor-read-path.patch` in this folder is the same change as a `git apply`-able
patch.

## `handleArtifactRead(req, { reportId, module, ttlSeconds })`

Order of operations, each step depending on the one above:

1. `verifyPatientToken(req.headers.authorization)` + Guard B — uid only.
2. `resolvePatientForCaller(uid)` → `elationPatientId`, **server-derived**.
   `req.body.patientId` is read by nothing.
3. D-068 allowlist gate — fail closed (403 `NOT_IN_ALLOWLIST`).
4. `assertNotSuspended` — fails **closed** (403 `ACCESS_SUSPENDED`, 503 on error).
5. Suppression — module off or item hidden → **404 `ARTIFACT_NOT_SYNCED`**,
   before any Storage access, identical to "not synced yet".
6. Reference ownership (above) → 404 with no enqueue if it is not this
   patient's report.
7. Object present → v4 signed URL. Missing → `enqueueRepair` (server-scoped)
   and return `{ state: 'preparing' }` — no Elation round-trip on the read path.

Errors carry `.status`, `.code`, `.reason`, so each wrapper maps them straight
into its existing `jsonError(res, status, code, reason, message)` envelope.

### Behavior changes to call out in the PR

- **TTL 30 min → 300s default, 900s hard cap.** The wrappers hardcode `300`;
  the client cannot ask for longer. Portal PDF viewers that cache a link for
  half an hour will now re-request — worth a UI check in the smoke test.
- **Module-off during an artifact request** used to return
  `200 { moduleUnavailable: true }`; it now returns 404 `ARTIFACT_NOT_SYNCED`.
  List mode is unchanged — the wrapper's `moduleUnavailable` early-return is now
  guarded with `!wantArtifact`.
- A missing object used to be a flat 404; it now returns `{ state: 'preparing' }`
  and queues a repair. The member-facing UI should render "preparing" rather
  than an error.

## Rules kept in the wrappers

- **Audit-first**: the `phi_access_log` write stays in each handler, before the
  delegate call, so denials remain audited.
- No caller-supplied patient id anywhere — no "belt and braces" local check.
- `ttlSeconds: 300` is hardcoded in the wrapper, never read from the client.
- List filtering (`filterHidden`) stays in the handlers; the shared module owns
  the single-artifact read only.
- `getMyPatientRecord` keeps its documented payload exception.

## Registration

- `index.js`: add the `require` and put `adminRunArtifactAudit` **inside** the
  `module.exports = { … }` object.
- `deploy-production.yml`: add `adminRunArtifactAudit` to the `ADMIN_FUNCTIONS`
  array in the IAM-hardening step (the copy on `main` still lists five), and
  leave it out of both health-gate `FUNCTIONS=( … )` arrays.
- Wire `npm run test:redteam` into the workflow so the gate runs on every PR.

## The gate drives the handler the way production does

`test/redteam/helpers/portalRead.js` models the three artifact wrappers:

```js
const WRAPPERS = { getLabs: 'labs', getImaging: 'imaging', getMedicalRecords: 'records' };
```

`readArtifact({ as, doc })` resolves the wrapper from the seeded document's
module and calls through `callWrapper`, which pins `module` and the 300s TTL
exactly as the deployed function does. `seedDocument(patient, { module })`
writes the reference into `patients/<id>/labs/<reportId>` with the right
`category` and puts the object under the patient's **uid** prefix; `hideItem`
suppresses by module key. Cross-patient and steering cases assert **404**
(absence), never 403 and never content.

## Opening the PR

Lovable's GitHub token on this project is **read-only**, so the branch is
created from your side. From a clone of the repo, with this bundle at
`~/portal-artifact-integrity`:

```bash
git checkout -b release-2a/centralize-artifact-read
mkdir -p functions/core/services/artifacts test/redteam/helpers
cp -r ~/portal-artifact-integrity/functions/* functions/
cp -r ~/portal-artifact-integrity/test/redteam/* test/redteam/
# or, for the three handlers only:  git apply ~/portal-artifact-integrity/refactor-read-path.patch
git add -A && git commit -m "Release 2a: centralize the artifact read path (Option A)"
git push -u origin release-2a/centralize-artifact-read
gh pr create --fill --base main
```

## Run evidence to paste into the PR

1. `npm run test:redteam` against the emulator / test project — **green**.
2. **Mutation check, actually performed**: short-circuit the reference
   ownership check in `readArtifact.js` step 6a (or make the test bucket
   public) → suite goes **RED** → revert → **green**. Paste both runs.

## Post-merge, before this is "done"

- `adminRunArtifactAudit` is private: no `allUsers`, `portal-admin` invoker
  only, 403 unauthenticated.
- Live read-path smoke test on the Test Kieffer fixture: a real lab PDF opens
  (200 + signed URL), a hidden item returns 404, a suspended patient returns
  403, and an imaging + medical-record artifact each open too (three wrappers,
  three checks).
