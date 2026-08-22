# Release 2b · Part B — internal patient UID + artifact storage re-key

Prerequisite for guardian reads. **Do not enable guardian reads on the
`firebaseUid`-keyed path.**

## Why

Artifacts were addressed as `elation-artifacts/<firebaseUid>/<reportId>/report.pdf`,
with the uid taken from the *caller's* token — ownership proven by the path.
Minors never log in and have no `firebaseUid`, so a guardian read resolved to
the **guardian's** prefix: object missing → perpetual `preparing`, and the
on-miss repair would have written the **child's** PDF under the **guardian's**
prefix. That is a PHI mislocation. Storage is therefore re-keyed onto an id that
belongs to the record.

## The id

`patients/<elationPatientId>.internalUid` — a v4 UUID.

- Minted once for **every** patient, adult or minor, login or not.
- **Immutable**; minting is idempotent (a record that has one is untouched).
  Regenerating orphans objects.
- Not an Elation id, not a Firebase Auth uid. Claiming a login records
  `firebaseUid` as the **auth** mapping only — storage never moves. An Elation
  exit never re-keys storage.
- Never accepted from client input; always resolved server-side from the
  authorized record.

Model: `functions/core/services/patient/internalUid.js`
(shipped in `portal-artifact-integrity/functions/core/services/patient/`,
same repo path — copy both handoff folders into `functions/`).

## Object path

```
elation-artifacts/<internalUid>/<reportId>/report.pdf
```

The `elation-artifacts/` prefix stays; renaming it is a separate cosmetic
migration. Every path-computing site resolves the owner record's `internalUid`:
`readArtifact.js`, `auditArtifactCoverage.js`, `sweepArtifactRepairs.js`
(via the queued `path`), `repairQueue.js`, and the ingest writer.

## Migration order

1. **Mint** — `backfillInternalUids` (admin-only, dry-run default, resumable).
   `{"apply":true}` to write. Reports scanned / alreadyPresent / minted / failed.
2. **Dual-read window** — a read that misses the `internalUid` path falls back to
   the legacy `firebaseUid` path. Controlled by `ARTIFACT_LEGACY_UID_FALLBACK`
   (default on; set `false` to disable). Minors have no legacy uid, so a guardian
   read is only ever served re-keyed. Window: 14 days, or until the audit is
   clean 3 consecutive days — whichever is later.
3. **Copy objects** — `backfillArtifactObjects` (admin-only, dry-run default,
   `limit` + `cursor` for resumability). **Copy, never move.** Legacy objects are
   deleted only in a separate, explicitly approved cleanup.
4. **Prove coverage** — run `auditArtifactCoverage` with
   `ARTIFACT_LEGACY_UID_FALLBACK=false`; it must report 100% (no `MISSING_OBJECT`,
   no `unpathed`) before the fallback branch is deleted from the read path.
5. **Cleanup** — remove the fallback branch, then delete legacy objects.

Invariants held throughout: UBLA + Public Access Prevention, no public object
ACLs, v4 signing only, suppression checked before any Storage access, the healer
writes bytes only and never grants access.

## Part A — guardian identity in `readArtifact.js`

- `self = resolvePatientForCaller(uid)` (may be absent for a guardian-only
  account); `targetElationId = childElationId || self.id`.
- Authorized as `self` when the ids match, else `guardian` when
  `resolveGuardianAccess(targetElationId, { uid, callerElationId: self?.id })`
  passes, else the stranger answer. That resolver fails closed and authorizes on
  either (a) an active entry already bound to this uid, or (b) phase-1
  chart-backing: `callerElationId` and the entry's `guardianElationId` both
  non-empty and strictly equal, `status === 'active'`. A falsy `callerElationId`
  denies **before any comparison**, so a future guardian-only account can never
  match a null-`guardianElationId` (`email_on_file`) entry. On (b) it lazily
  binds that single entry's `guardianUid`, best-effort — a bind failure never
  blocks or errors the read. `pending_adult_consent` and `revoked` neither
  authorize nor bind.
- `childElationId` is **untrusted until that check passes** — no `internalUid`
  resolution, no Storage touch, no signed URL, no repair enqueue before it.
- Every record-scoped check runs on the **child's** record: allowlist,
  `assertNotSuspended`, `getPortalAccess` / `isModuleVisible` / `filterHidden`,
  and the `patients/<child>/labs/<reportId>` reference lookup. A guardian never
  sees more than the child's own settings allow.
- Unlinked / revoked / `pending_adult_consent` all return the identical
  `ARTIFACT_NOT_SYNCED` absence — never "not your child" (absence-never-forbidden).
- `phi_access_log` carries `actingUid` + `subjectUid` (the internalUid) +
  `subjectElationId` on every read; self-reads set acting == subject.
- Behind `GUARDIAN_READS_ENABLED` (**default OFF**). Flip only after Part B is
  complete and the red-team is green.

## Red-team

`test/redteam/artifact-ownership.test.js`, `[2b] guardian proxy access` and
`[2b] internal-UID storage re-key` — emulator / test-project only, under the
existing `helpers/env.js` guard; the read-only bucket-privacy suite is unchanged.
Covers: active guardian read; revoked reads exactly like a stranger; pending
consent denied; guardian of A requesting B denied with no URL and no repair
queued; shared-email entries revoke independently; child suppression and
module-off identical for the guardian; both-uid logging; the object resolves at
the `internalUid` path; a guessed cross-subject path still 403s; a claimed login
does not change `internalUid`. Existing self-read cases stay green.

Run the mutation check before trusting the gate: short-circuit the guardian gate,
confirm RED, revert, confirm GREEN.

## Install

```
functions/backfillInternalUids.js
functions/backfillArtifactObjects.js
functions/core/services/patient/internalUid.js
```

```js
exports.backfillInternalUids     = require('./backfillInternalUids').backfillInternalUids;
exports.backfillArtifactObjects  = require('./backfillArtifactObjects').backfillArtifactObjects;
```

Both are already listed in `lock-admin-invokers.yml`, so the post-deploy step
strips the public `allUsers` invoker. Call them as `portal-admin` (impersonated
ADC); a plain user ADC gets 403 at IAM before `requireAdminCaller` runs.

## Out of scope

No changes to `portalAccess` semantics, suspension, TTLs, or the member-UI
contract. No category segmentation — see the order-response runbook in
`README-GUARDIANS.md`.
