# Rhodes quarantine attempt and read-only minor audit — 2026-11-23

## Quarantine: blocked, not applied

The owner-approved two-write atomic operation was attempted once. Firestore rejected it with **HTTP 403 PERMISSION_DENIED**. No automatic retry, new permissions, alternate credential, deployment or production code change was attempted.

Preflight confirmed:
- Exact patient ID `1455085200211969`, DOB `2026-01-04`, actual #615 verdict MINOR.
- Freshly read updateTime `2026-11-19T23:21:05.777222Z`; matched the earlier review. The conditional write used this current read, not an unchecked stale literal.
- Executor UID `653aa1b8-8c54-49e4-9990-7afb065000ad`, verified through Prime Care OS hosted auth and its protected live super_admin role. This is a Prime Care OS administrator UID, not a claimed Firebase patient UID. The existing service account was transport authority, not substituted as the human actor.
- Scoped patient updateMask: dependent.isMinor and minorHold.reason/gateReason/dobAtHold/source/actorUid; recordedAt as a server transform.
- Second write: create-only portalAdminAudit event, action minor_quarantine, exact patient ID/DOB/reason/gateReason, same verified actorUid, ok:true and server timestamp; exists:false precondition prevents overwriting an event.

Read-back after rejection confirmed **patient updateTime unchanged, minor flag absent, minorHold absent, audit event absent**. No partial application. No unrelated patient field changed.

Attempted event ID (not created): `minor-quarantine-1455085200211969-08bbc27e-e508-44dd-8281-b44245290883`.

**Blocker/next step:** an authorized owner executor with Firestore write access must execute the approved patient-update + create-only audit batch. Owner approval does not add IAM permission to the current read credential. Before any later attempt, re-read and re-verify DOB/MINOR/hold state/current version and the actual executing administrator identity; stop if review facts changed. No broad Auth/provisioning/IAM grant is requested here.

## Read-only audit of current minors

Snapshot **2026-11-23T00:12:24.348873Z**; complete scans of 1,625 patients and 2,475 claim-token documents. Actual unchanged #615 evaluator; DOB and UID-presence fields only for patient classification, no names/emails.

| Measure | Count |
|---|---:|
| Minors | 175 |
| Minors with authUid or firebaseUid set | **1** |
| Minors with unused, unexpired claim token | **0** |
| Both account binding and live token | **0** |
| Either | **1** |
| Unused minor tokens with unclassifiable expiry | **0** |

| Patient ID | DOB | Account vs token |
|---|---|---|
| 1189873388814337 | 2023-07-28 | Account binding only; no live token |

Account count follows the requested UID-field definition. It does not independently certify Auth-user existence, account enablement, sign-in history or direct minor ownership versus guardian linkage. No account or token remediation performed. DOB_UNKNOWN remains 0; 1,450 records have adult DOBs.

## Manual invitation exclusions

Previewed 12 available invitation/reissue/validation CSVs. Rhodes had **zero exact target-ID rows and zero exact target cells** in every file. No removal was necessary; all files remained byte-for-byte unchanged. Current repository tree had no CSV/manual-cohort inputs. This does not certify files held outside this workspace/repository.

| Available input | Before | Removed | After |
|---|---:|---:|---:|
| adult-portal-reissue-2026-11-12-engagement.csv | 497 | 0 | 497 |
| adult-portal-reissue-2026-11-12.csv | 497 | 0 | 497 |
| unclaimed-group-a-email-review.csv | 241 | 0 | 241 |
| unclaimed-group-a-never-engaged.csv | 609 | 0 | 609 |
| unclaimed-group-b-engaged.csv | 0 | 0 | 0 |
| invite-validation-2026-11-10/IMPORT_emailSuppression_review.csv | 0 | 0 | 0 |
| invite-validation-2026-11-10/IMPORT_inviteEmailCorrections_review.csv | 2 | 0 | 2 |
| invite-validation-2026-11-10/send_eligible_by_member_id.csv | 566 | 0 | 566 |
| invite-validation-2026-11-11/IMPORT_emailSuppression_review.csv | 0 | 0 | 0 |
| invite-validation-2026-11-11/IMPORT_inviteEmailCorrections_review.csv | 2 | 0 | 2 |
| invite-validation-2026-11-11/member_segments_review.csv | 764 | 0 | 764 |
| invite-validation-2026-11-11/send_eligible_by_member_id.csv | 500 | 0 | 500 |

## Guardrails

No invitations/sends, tokens revoked, account reset/suspend/provisioning, nudge, readiness-counter start, config change, merge/deploy/arming. AUTOSEND and nudge holds untouched. Cynthia `1399946260185089` and pipeline-reliability work remain unstarted; quarantine execution remains blocked on an authorized writer.
