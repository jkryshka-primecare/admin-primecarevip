# Release 2a · item 4 — live read-path smoke (Cloud Shell)

`prod-read-path-smoke.js` is the last verification gate for 2a. It drives the **deployed**
`getLabs` / `getImaging` / `getMedicalRecords` endpoints as a real patient bearer token and
proves that a v4 signed URL minted in production actually serves PDF bytes.

## Run it

```bash
cd ~ && mkdir -p smoke && cd smoke
npm init -y >/dev/null && npm i firebase-admin@12
# copy prod-read-path-smoke.js here
export PROJECT_ID=prive-care-vip
export REGION=us-central1
export SMOKE_WEB_API_KEY=<Firebase Web API key>
export SMOKE_PATIENT_ID=816455979040769
export SMOKE_FIREBASE_UID=d8h7h6xc6axkq3k3tgnoz6ytxmx1
node prod-read-path-smoke.js
```

Node 18+ (Cloud Shell default) — uses built-in `fetch`.

## What it asserts

| # | Case | Expected |
|---|------|----------|
| 1 | Present lab | `200` + signed URL, and a real GET of that URL returns `%PDF-` bytes |
| 2 | `SMOKE-LAB-2` (reference with no object) | `200` `{ state: 'preparing' }` |
| 3 | Hidden lab item | `404 ARTIFACT_NOT_SYNCED` |
| 4 | Suspended member | `403 ACCESS_SUSPENDED` |
| 5 | Imaging + medical record | `200` + signed URL |

## Safety

- No member chart data is written. It flips `portalAccess/{patientId}` for cases 3 and 4 and
  restores the **original document verbatim** in a `finally` block — deleting it again if it
  did not exist before the run. The last line of output confirms the restore.
- Every read is audited by the functions themselves in `phi_access_log`. That is expected.
- Fixture report ids are auto-discovered from Firestore (`hasArtifact == true`), or pin them
  with `SMOKE_LAB_ID` / `SMOKE_IMAGING_ID` / `SMOKE_RECORD_ID`.

## Known failure modes, called out in the output

- **Custom token can't be minted** → the caller lacks signing rights. Grant
  `roles/iam.serviceAccountTokenCreator` to the Cloud Shell principal on the SA it impersonates.
- **Case 1 fails with `signBlob` / "could not sign"** → the *runtime* SA needs
  `roles/iam.serviceAccountTokenCreator` **on itself**. The script prints this explicitly.
