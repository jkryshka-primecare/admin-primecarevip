# Member portal: moduleUnavailable + suspension states

Patch: `module-off-suspended-states.patch` (apply in `primecarevip/prime-care-vip-app-v2`).

```bash
git checkout -b fix/portal-module-off-suspended-states
git apply /path/to/module-off-suspended-states.patch
```

Backend unchanged. All edits are in `artifacts/web-member/src`.

## What it fixes

`getLabs` (and every sibling read handler) answers **HTTP 200 `{ moduleUnavailable: true }`** when the
care team toggles a module off. The client fell through to the 200-but-wrong-shape branch and rendered
red "Could not load … / Unexpected response." with a **Try again** button — reads as an outage.

## Changes

- **`services/api/clinicalApi.js`** — `callRead` and `fetchArtifact` now branch on
  `moduleUnavailable === true` **before** the shape check → `{ kind: 'moduleOff' }`, and on
  `403 ACCESS_SUSPENDED` → `{ kind: 'suspended' }`.
- **`services/api/patientApi.js`** — `getMyPatientRecord` 200 with `patient.portal.status === 'suspended'`
  (zero PHI) → `{ kind: 'suspended' }` instead of `READ_ERROR`; `moduleUnavailable` handled too.
- **`hooks/useClinicalData.js` / `hooks/usePatientRecord.js`** — new statuses `module_off` and `suspended`.
- **`components/clinical.jsx`** — `PortalNotice` + `ModuleOffNotice` / `AccessPausedNotice` (neutral card,
  concierge number, **no red, no retry button** — retrying cannot change the answer). `ClinicalScreen`
  renders them, so Conditions, Allergies, Medications and Appointments are covered by the shared path.
- **`components/ReportListPane.jsx`** — same states in the list pane (Labs, Imaging, Medical Records).
- **`screens/LabResults.jsx` / `screens/Imaging.jsx`** — when off/paused, the whole browser is replaced by
  the notice rather than an empty list beside a "select a report" viewer.
- **`screens/Dashboard.jsx`** — appointments widget shows "Turned off by your care team" / "Portal access is paused".
- **`App.jsx`** — `PatientGate` renders a full-screen **"Portal access is paused"** (with Sign out) for
  suspension, and a **"This section is turned off"** screen for the record-summary module.

Every read page reaches one of these three shared surfaces (`ClinicalScreen`, `ReportListPane`,
`PatientGate`), so any module behaves identically when toggled off, including read pages added later.

## Smoke-test expectations

- Row 5/6 (module off/on): the affected page shows the calm turned-off card; no red, no Try again.
- Row 9 (suspend): full-screen "Portal access is paused"; other handlers' 403 `ACCESS_SUSPENDED` land on
  the same copy inside each page. Restore returns to normal on reload.

## Cutover status (2026-08-21) — MERGED

**PR #437 merged to `main`** (`2540561`), branch `portal-cutover/member-artifact-contract`.
Both patches landed: module-off/suspension states + the Release 2a artifact contract
(300s TTL re-request, `preparing` polling, absence-never-forbidden), with the approved
revision `dc99165` making `module_off` byte-identical to a genuinely empty section.
Only `artifacts/web-member/src` changed; backend, IAM, indexes and workflows untouched.

## Smoke matrix result (2026-08-21) — ALL PASS

Deploy confirmed live on `care.primecarevip.com`; run against the Test Kieffer fixture
(`patient-test-1@primecarevip.com`, member `816455979040769`).

| Case | Expected member UI | Result |
| --- | --- | --- |
| Visible lab, open PDF | Renders; link silently re-requested before the 300s expiry | PASS |
| Reference present, object missing (`SMOKE-LAB-2`) | Calm "preparing" state, polls every 8s, no error/404 | PASS |
| Item hidden by admin | "Not available to view yet" — identical to never-synced; sibling lab unaffected | PASS |
| Unhide | Item returns to the list and opens normally | PASS |
| Module toggled off (Labs) | Section renders as a normal empty section, no notice | PASS |
| Account suspended | Full-screen "Portal access is paused" + concierge number + Sign out | PASS |
| Restore / re-enable | Normal content returns on reload | PASS |

Release 2a member-UI cutover is verified in production. No follow-up defects logged.


