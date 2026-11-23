# DOB audit and Rhodes quarantine — execution status

**Owner approved the scoped quarantine plus create-only audit event on Nov 23; execution is permission-blocked.** The atomic two-write request was rejected with 403 PERMISSION_DENIED; read-back confirmed neither document changed. No retry or permission change. Owner reports #624 merged/deployed green; no independent deployment verification was requested/performed. Keep AUTOSEND off, nudges held, invites/sends off; do not start clean-run counting before the next clean live discovery run. No merge/deploy/arming.

## 1. Completed read-only DOB audit

Snapshot: **2026-11-22T23:59:47.843210Z**. Scanned all **1,625** `patients` documents, paginating to completion at one fixed readTime and projecting DOB only. Executed the actual current-main `evaluateDiscoveryAge`, not replacement arithmetic.

| DOB verdict | Count |
|---|---:|
| DOB_UNKNOWN | **0** |
| ADULT | 1,450 |
| MINOR | 175 |
| Total | 1,625 |

**Requested ID/DOB sample: none — zero DOB_UNKNOWN matches.** No DOB cleanup cohort was found. These are DOB verdicts, not membership/invite eligibility counts; missing/invalid DOB would not establish that someone is an adult. The audit does not inspect upstream-only Elation charts without patient documents.

Source: `functions/core/services/patient/rosterDiscovery.js:124–146`; blob `ad5c5bbc0cffcf5b9f465caf58ede68e6bb29b68`. Main head observed afterward: `a9f8d2dc034c6b1440633c53ec267194e73c5acf`. Only DOB values and requested Rhodes marker fields were read; no emails/names, patient/token/account/config edits or sends.

## 2. Rhodes: current read and purpose

- Exact patient path: `patients/1455085200211969`.
- DOB: **2026-01-04**; shared evaluator verdict **MINOR**.
- Projected `dependent.isMinor` and `dependent.minorHold` fields are absent. This does **not** mean the entire dependent map is absent.
- Document version: `2026-11-19T23:21:05.777222Z`.
- #624 already refuses invitation mint/send and pre-C1 claim for this DOB. The proposed stamp is marking/cleanup, **not a safety dependency**.

## 3. Approved change — one patient document plus one audit event

An authorized owner writer is required; current service credential cannot commit this operation.
1. Re-read this exact ID. Confirm DOB still exactly `2026-01-04`, evaluator still MINOR, and hold fields/version remain as reviewed. Use the freshly read updateTime. If anything changed, stop and return a revised proposal; do not silently refresh the precondition and continue.
2. Resolve `verifiedOperatorUid` from the executing administrator's verified identity. The attempted operation used `653aa1b8-8c54-49e4-9990-7afb065000ad`, independently verified through Prime Care OS hosted auth and protected super_admin role; do not reuse it to impersonate a different executor.
3. Atomically commit the conditional patient write below AND a create-only `portalAdminAudit` event. Change only `dependent.isMinor` and embedded hold/audit metadata; do not replace the dependent map. Audit action: minor_quarantine; same patient ID, reason, gateReason, dobAtHold, verified actorUid, ok:true and server timestamp; create precondition exists:false, never update/delete an event.
4. Read back patient and event. Verify server timestamps, DOB and every unrelated patient field; no invite/claim/reset test. On uncertain commit, inspect the exact event ID and patient version before any retry.

### Approved two-write shape (atomic attempt rejected)

The patient write below must be batched with the approved create-only audit event: **two writes, two documents, one atomic commit**. `verifiedOperatorUid` is the verified executor; `currentRhodesUpdateTime` comes from the immediately preceding re-read, never an unchecked literal. No write succeeded.

```js
const auditEventDocumentName =
  'projects/prive-care-vip/databases/(default)/documents/portalAdminAudit/' +
  'minor-quarantine-1455085200211969-' + crypto.randomUUID();
const proposedCommit = {
  writes: [{
    update: {
      name: 'projects/prive-care-vip/databases/(default)/documents/patients/1455085200211969',
      fields: {
        dependent: { mapValue: { fields: {
          isMinor: { booleanValue: true },
          minorHold: { mapValue: { fields: {
            reason: { stringValue: 'MINOR_ROSTER_DOB_QUARANTINE' },
            gateReason: { stringValue: 'MINOR' },
            dobAtHold: { stringValue: '2026-01-04' },
            source: { stringValue: 'owner_reviewed_rhodes_quarantine' },
            actorUid: { stringValue: verifiedOperatorUid }
          } } }
        } } }
      }
    },
    updateMask: { fieldPaths: [
      'dependent.isMinor',
      'dependent.minorHold.reason',
      'dependent.minorHold.gateReason',
      'dependent.minorHold.dobAtHold',
      'dependent.minorHold.source',
      'dependent.minorHold.actorUid'
    ] },
    currentDocument: { updateTime: currentRhodesUpdateTime },
    updateTransforms: [{
      fieldPath: 'dependent.minorHold.recordedAt',
      setToServerValue: 'REQUEST_TIME'
    }]
  }, {
    update: {
      name: auditEventDocumentName,
      fields: {
        action: { stringValue: 'minor_quarantine' },
        elationPatientId: { stringValue: '1455085200211969' },
        reason: { stringValue: 'MINOR_ROSTER_DOB_QUARANTINE' },
        gateReason: { stringValue: 'MINOR' },
        dobAtHold: { stringValue: '2026-01-04' },
        actorUid: { stringValue: verifiedOperatorUid },
        actorIdentitySource: { stringValue: 'prime_care_os_verified_auth' },
        ok: { booleanValue: true }
      }
    },
    currentDocument: { exists: false },
    updateTransforms: [{
      fieldPath: 'createdAt',
      setToServerValue: 'REQUEST_TIME'
    }]
  }]
};
```

**Audit addition approved:** reason, executor UID, original DOB, source and server timestamp are embedded on the patient; an append-only `portalAdminAudit` event must be created in the same operation. Existing client default-deny rules are unchanged. The denied attempt created neither hold nor event; immutable audit creation remains outstanding, not claimed complete.

Preserve status, DOB, all other dependent/guardian fields, consent/conversion dates, Auth/UID bindings, identityGeneration/accountWork, tokens, hydration jobs, membership and configuration. Do not create a guardian workflow, reset an account, revoke a token, provision anything or send email. No automatic rollback; a later correction/removal needs separate review and cannot erase unrelated dependent state.

## 4. Manual-list exclusion proposal

Preview completed: **zero exact target rows/cells in 12 available invitation/reissue/validation CSVs**; no removals needed and bytes unchanged. Repository tree has no manual cohort CSV inputs; externally held inputs are not certified. Future reviewed inputs must exclude only patient ID/MRN `1455085200211969`, never name/email, with before/after preview and no other row changes. No permission to send.

## 5. Release hold and next work

Owner-approved quarantine execution remains blocked on an authorized writer. Read-only follow-up at `2026-11-23T00:12:24.348873Z`: 175 minors, one account binding (`1189873388814337`, DOB `2023-07-28`), zero live tokens/both; no account/token remediation. Leave Cynthia (`1399946260185089`) and pipeline work entirely unstarted. No counter increment, discovery run, nudge, code/PR, merge, deployment, arming or invitation is included.
