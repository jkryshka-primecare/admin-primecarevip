# Option A — centralize the artifact read path

Decision taken: build one shared handler and route every member-facing artifact
read through it. The red-team suite then guards the code that actually serves
members, instead of a phantom module.

## What ships in this bundle

```
functions/core/services/artifacts/readArtifact.js   NEW — handleArtifactRead
functions/core/services/artifacts/repairQueue.js    C — server-derived on-miss enqueue
functions/auditArtifactCoverage.js                  A — coverage audit
functions/sweepArtifactRepairs.js                   B — nightly self-heal
test/redteam/*                                      D — the gate
```

`handleArtifactRead(req, params)` performs, in this order:

1. `verifyPatientToken` on the bearer — uid is the only identity accepted.
2. `resolvePatientForCaller(uid)` — the elation patient id is **server-derived**.
   `req.body.patientId` is read by nothing; supplying it changes nothing.
3. `assertNotSuspended` — fails **closed** (403 on suspension, 503 on a read error).
4. Ownership — the document reference must exist under that patient's
   subcollection. A guessed path for another member resolves to nothing → 403,
   before Storage is touched.
5. Suppression — module off or item hidden → **404**, never "forbidden" and
   never content. Healing writes bytes only; it never grants access.
6. Object present → signed URL (default 300s, hard cap 900s).
   Object missing → `enqueueRepair({ patientId }, ...)` and return
   `{ state: 'preparing' }` immediately; no Elation round-trip on the read path.

Errors carry `.status` (400/401/403/404/503) so HTTP wrappers map them directly.

## Required refactor of the nine read functions

These handlers currently each implement their own ownership + suppression +
signing. They must stop doing that and delegate. Per handler:

| Handler | pass `collection` | module key (derived) |
| --- | --- | --- |
| `getLabs` | `labs` | labs |
| `getImaging` | `imaging` | imaging |
| `getMedications` | `medications` | medications |
| `getLetters` | `letters` | records |
| `getMedicalRecords` | `documents` | records |
| `getAppointments` | `appointments` | appointments |
| `getProblems` | `problems` | conditions |
| `getAllergies` | `allergies` | allergies |
| `getMyPatientRecord` | n/a — list/payload only | see ENFORCEMENT.md |

Replace the per-handler artifact branch with:

```js
const { handleArtifactRead } = require('./core/services/artifacts/readArtifact');

// inside the handler, for the "give me this one artifact" request shape:
try {
  const out = await handleArtifactRead(req, {
    documentId: req.query.documentId || (req.body && req.body.documentId),
    collection: 'labs',
    ttlSeconds: 300,
  });
  return res.status(200).json(out);
} catch (err) {
  return res.status(err.status || 500).json({ error: err.message });
}
```

Rules while refactoring:

- Keep the existing **audit-first** write to `phi_access_log` in the handler,
  before calling `handleArtifactRead`, so denials are still audited.
- Do **not** keep a local ownership check "as a belt and braces" that reads a
  caller-supplied patient id — that is exactly the hole this removes.
- List filtering (`filterHidden`) stays in the handlers; this module owns the
  single-artifact read only.
- `getMyPatientRecord` keeps its documented exception; it returns a payload, not
  `{ items }`.

## Before this is a real gate

1. Land `readArtifact.js` plus the nine-handler refactor in one reviewed PR.
2. Run `npm run test:redteam` against the emulator / test project — green.
3. **Mutation check**: short-circuit the ownership check in step 4 (or make the
   bucket public) → confirm the suite goes RED → revert → confirm green. Paste
   both runs into the PR.
4. Confirm `adminRunArtifactAudit` is required **and** exported inside
   `module.exports` in `index.js`, and is in `ADMIN_FUNCTIONS` in
   `lock-admin-invokers.yml`.

## Helper guard fix included this round

`test/redteam/helpers/env.js` no longer short-circuits on
`FIRESTORE_EMULATOR_HOST`. The emulator branch now also requires
`STORAGE_EMULATOR_HOST` and applies the production project/bucket refusal, so a
Firestore-emulated run can never drop `redteam-` objects into production
Storage.
