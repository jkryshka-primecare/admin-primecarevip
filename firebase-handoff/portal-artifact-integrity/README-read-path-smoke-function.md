# Release 2a · item 4 — read-path smoke as a deployed admin function

`functions/adminRunReadPathSmoke.js` replaces the Cloud Shell script
(`scripts/prod-read-path-smoke.js`). Staff run it from the admin OS:
**Admin → Artifact Coverage → Run read-path smoke**.

Flow: admin OS → `portal-admin` edge function (`action: "smoke"`, admin-only,
audited in `portal_admin_actions` + `phi_access_log`) → WIF identity token →
`adminRunReadPathSmoke` → deployed `getLabs` / `getImaging` / `getMedicalRecords`.

## Deploy checklist (Firebase repo)

1. Copy `functions/adminRunReadPathSmoke.js` into `functions/`.
2. Export it **inside** `module.exports` in `functions/index.js`:
   ```js
   ...require('./adminRunReadPathSmoke'),
   ```
3. `lock-admin-invokers.yml` — already lists `adminRunReadPathSmoke`
   (see `portal-iam-hardening/`).
4. `deploy-production.yml` — exclude `adminRunReadPathSmoke` from **both**
   health-gate `FUNCTIONS` arrays: it is IAM-restricted, so an anonymous probe
   returns 403 and would fail the gate.
5. Set the runtime config the token exchange needs:
   ```bash
   gcloud functions deploy adminRunReadPathSmoke ... \
     --set-env-vars SMOKE_WEB_API_KEY=<Firebase Web API key>
   ```
   Optional overrides: `SMOKE_PATIENT_ID` (default `816455979040769`),
   `SMOKE_FIREBASE_UID` (default `d8h7h6xc6axkq3k3tgnoz6ytxmx1`),
   `SMOKE_MISSING_ID` (default `SMOKE-LAB-2`).

## Cases asserted

| # | Case | Expected |
|---|------|----------|
| 1 | Present lab | `200` + signed URL, and a real GET of it returns `%PDF-` bytes |
| 2 | `SMOKE-LAB-2` | `200` `{ state: 'preparing' }` |
| 3 | Hidden lab item | `404 ARTIFACT_NOT_SYNCED` |
| 4 | Suspended member | `403 ACCESS_SUSPENDED` |
| 5 | Imaging + medical record | `200` + signed URL |
| — | `portalAccess` restored byte-for-byte | PASS line of its own |

## Safety

- Admin-only via `requireAdminCaller`; the edge function additionally requires
  the `is_hr_admin` role and writes an audit row before returning.
- The function **refuses** any `patientId` other than the configured fixture,
  so it can never toggle a real member's access.
- No chart data is written. `portalAccess/{fixture}` is snapshotted and
  restored in a `finally`, including deletion if it did not exist.
- If case 1 fails with a signing error, the runtime SA needs
  `roles/iam.serviceAccountTokenCreator` **on itself**.
