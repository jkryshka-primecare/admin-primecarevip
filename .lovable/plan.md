# DOB audit and single-patient Rhodes quarantine — Claude review

**Read/plan only. No production writes or implementation code authorized.** Owner reports #624 merged/deployed green; no independent deployment verification was requested/performed. Keep AUTOSEND off, nudges held, invites/sends off; do not start clean-run counting before the next clean live discovery run. No merge/deploy/arming.

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

## 3. Proposed change — one patient document only

After Claude review and separate owner execution approval:
1. Re-read this exact ID. Confirm DOB still exactly `2026-01-04`, evaluator still MINOR, and hold fields/version remain as reviewed. If anything changed, stop and return a revised proposal; do not silently refresh the precondition and continue.
2. Resolve `verifiedOperatorUid` from the executing administrator's verified identity. Do not guess a UID, match by email, or accept unauthenticated caller text.
3. Apply the single conditional write below. It changes only `dependent.isMinor` and embedded hold/audit metadata; it does not replace the dependent map.
4. Read back those exact fields and server timestamp. Verify DOB and every unrelated field remain unchanged. Do not run an invite/claim/reset as a test.

### Exact write proposal (not executed)

The object below is the request body for Firestore `documents:commit`; **one write, one document**. `verifiedOperatorUid` is the verified executor value supplied at approved execution, not a fabricated literal.

```js
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
    currentDocument: { updateTime: '2026-11-19T23:21:05.777222Z' },
    updateTransforms: [{
      fieldPath: 'dependent.minorHold.recordedAt',
      setToServerValue: 'REQUEST_TIME'
    }]
  }]
};
```

**Audit scope:** reason, executor UID, original DOB, source and server timestamp are embedded on this same document. This does not claim a separate immutable `portalAdminAudit` event was written. Such an event would be a second-document write and requires expanding this single-doc proposal explicitly.

Preserve status, DOB, all other dependent/guardian fields, consent/conversion dates, Auth/UID bindings, identityGeneration/accountWork, tokens, hydration jobs, membership and configuration. Do not create a guardian workflow, reset an account, revoke a token, provision anything or send email. No automatic rollback; a later correction/removal needs separate review and cannot erase unrelated dependent state.

## 4. Manual-list exclusion proposal

At approved execution, remove **only patient ID/MRN `1455085200211969`** from each reviewed manual invitation input, regardless of its patient-ID column label. Match the exact ID, never name/email. Preview before/after counts and confirm no other rows change; confirm zero target-ID rows remain before any separately approved future run. No manual list or wave input has been changed now. This is an operational exclusion, not a new sender bypass or permission to send.

## 5. Release hold and next work

Return this proposal to Claude; execute neither the patient write nor list edits until separately approved. Leave Cynthia one-off provisioning (`1399946260185089`) and the deploy-pipeline reliability pass entirely unstarted. They come after this audit and Rhodes review. No counter increment, discovery run, nudge, code/PR, merge, deployment, arming or invitation is included.
