# 2b guardian read — Part B design (for review) then Part A + red-team

Per the prompt, Part B is a PHI data migration and must be reviewed before any code lands.
Below is the design. Part A and the red-team work are sequenced after approval.

## Why Part B exists

Today the shared read path addresses objects as
`elation-artifacts/<firebaseUid>/<reportId>/report.pdf`, with the uid taken from the caller's
verified token — ownership is proven by the path. Minors never log in, so they have no
`firebaseUid`. A guardian read on that scheme resolves to the *guardian's* prefix: the object
is missing (perpetual "preparing"), and the repair backstop would then write the child's PDF
under the guardian's prefix. That is a PHI mislocation, so storage must stop being keyed on
the auth uid.

## The internal patient UID

- New field `internalUid` on `patients/<elationPatientId>`: a v4 UUID, vendor-neutral and
  non-guessable, minted once per record for every patient — adult or minor, login or not.
- Immutable. Minting is idempotent (a record that has one is left untouched). Never
  regenerated, because regeneration orphans objects.
- Distinct from both Elation id and Firebase Auth uid. When an adult (or a now-18 minor)
  claims a login, `firebaseUid` is recorded as the *auth* mapping only; `internalUid` is the
  *storage* spine and does not move. Claiming a login never moves objects; an Elation exit
  never re-keys storage.
- Never accepted from client input — always resolved server-side from the authorized record.

## Storage key change

Object path becomes `elation-artifacts/<internalUid>/<reportId>/report.pdf`. The
`elation-artifacts/` prefix stays (renaming it is a separate cosmetic migration).

Every path-computing site resolves the owner record's `internalUid`:

| Site | Change |
| --- | --- |
| `readArtifact.js` → `objectPathFor` | takes `internalUid`, not token uid |
| artifact writer / ingest | lands new objects on the `internalUid` path |
| `auditArtifactCoverage.js` | resolves expected path via record `internalUid` |
| `sweepArtifactRepairs.js` | heals to the `internalUid` path |
| `repairQueue.js` | queue entry carries `internalUid` (plus `patientId`), never the caller uid |

## Migration sequence

1. **Backfill mint** (`backfillInternalUids`, admin-only, idempotent, dry-run default): walk
   `patients/*`, mint where absent. Reports minted / already-present / failed counts and lists
   any record that cannot be minted. Re-runnable safely.
2. **Dual-read window**: reads try the `internalUid` path first, fall back to the legacy
   `firebaseUid` path when the record has a `firebaseUid`. On a fallback hit, serve normally
   and enqueue a *copy* (not a move) to the new path. Proposed window: 14 days, or until
   audit is clean for 3 consecutive daily runs — whichever is later.
3. **Object backfill** (`backfillArtifactObjects`, batched, resumable): copy each existing
   object from `<firebaseUid>/` to `<internalUid>/`. Copy only; legacy objects are deleted in
   a separate, explicitly approved cleanup after the fallback is removed.
4. **Coverage proof**: `auditArtifactCoverage` runs against the `internalUid` key only and
   must report 100% coverage (no `MISSING_OBJECT`) before the `firebaseUid` fallback is
   deleted. Guardian reads stay flagged OFF for the whole window.
5. **Cleanup**: remove fallback branch, then (separate approval) delete legacy objects.

Invariants held throughout: UBLA + Public Access Prevention, no public object ACLs, v4
signing only, suppression evaluated before any Storage access, healer writes bytes only and
never grants access.

## Part A — after Part B is approved and merged

- Additive identity resolution in `handleArtifactRead`: `self = resolvePatientForCaller(uid)`
  (may be null for a guardian-only account), `targetElationId = requestedChildId || self?.id`,
  authorized as `self` when ids match, else `guardian` when `isActiveGuardian(targetElationId, uid)`
  passes, else the existing unauthorized/absence shape.
- Every record-scoped check re-points to `targetElationId`: D-068 allowlist, `assertNotSuspended`,
  `getPortalAccess` / `isModuleVisible` / `filterHidden`, and the reference-ownership lookup.
  Suppression and suspension are always the **child's** — a guardian never sees more than the
  child's own settings allow.
- `childElationId` is trusted only after `isActiveGuardian` passes: no `internalUid` resolution,
  no Storage touch, no signed URL, no repair enqueue before that. An unlinked / revoked /
  `pending_adult_consent` target returns the identical absence a stranger gets — no
  "not your child" error, no existence leak.
- `phi_access_log` gains `actingUid` + `subjectUid`/`subjectElationId` on every read; self-reads
  set acting == subject. No new PHI fields.
- Feature flag `GUARDIAN_READS_ENABLED`, default OFF, only flipped after Part B re-key is done
  and the red-team is green.

## Red-team (un-skip the 2b scaffolding)

Emulator/test-project only, under the existing `helpers/env.js` guard; the read-only
bucket-privacy suite is untouched. Required cases: active guardian reads child's artifact;
revoked guardian reads exactly like a stranger; `pending_adult_consent` denied; guardian of A
requesting B denied with no URL and no repair enqueued; entry-scoped binding (shared-email
Greg/Jill Goldstein revoke independently); child-record suppression identical for guardian and
self; both-uid logging asserted; all existing self-read cases still green; re-key cases —
authorized read resolves at the `internalUid` path, a guessed cross-subject path still 403s,
and a claimed login does not change the record's `internalUid`. Mutation check: short-circuit
the guardian gate, confirm red, revert, confirm green.

## Out of scope

No changes to `portalAccess` semantics, suspension, TTLs, or the member-UI contract. No
category segmentation — a guardian sees everything of their child; the levers are
`adminRevokeGuardian` and `hiddenItems` / module toggles. The order-response runbook gets
appended to the 2b README as part of Part A's doc change.

## Decision needed

Approve this Part B design (specifically: v4 UUID `internalUid`, copy-not-move backfill, and
the 14-day dual-read window) and I will implement Part B, then Part A, then the red-team.
