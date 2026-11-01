# pcvip-social-test: hosted verification results

Revision: PR #589, ab9341d08874b5e76c395985318603cb4d153458. Date: 2026-11-01 UTC.

## Observed
- Automation Editor access, billing, Email/Password and default Firestore confirmed. Google/Apple configurations absent; blocking triggers empty before/after.
- Direct accounts:signInWithIdp probes for google.com and apple.com each returned HTTP 400 `OPERATION_NOT_ALLOWED : The identity provider configuration is not found.` Inputs used intentionally invalid synthetic tokens. This proves disabled-provider endpoint refusal, NOT successful genuine external token validation.
- Synthetic account `SyntheticStaffTrueCase01`, chart `synthetic-chart-A`, target and disabled master/practice flags seeded only in test. Fresh password exchange succeeded with exact-case UID.
- Admin custom-token exchange failed `CREDENTIAL_MISMATCH`: signing credential belongs to production project, not test project. No token or credential was disclosed. Test-runtime signBlob permission probe returned 403. Custom-token success is NOT certified.
- Deployment used unchanged #589 modules with a test-only index exporting exactly the five callables, no blocking exports; audience values match the source Google web client ID and Apple Services ID. No production environment/credentials copied to runtime.
- Six inert sentinel secret versions created solely in test. They are NOT valid Elation/Twilio credentials and cannot certify full path B. Production Elation/Twilio secrets were not read or transferred.
- Full deployment stopped at secretmanager.secrets.setIamPolicy 403. A two-callable bootstrap deployment also failed in Cloud Build. socialAvailability and socialBeginAttempt are FAILED resources, not usable endpoints. Other three not deployed.

## Remaining requirements
1. Owner grants deployment account temporary Secret Manager Admin in test only (or grants runtime Secret Accessor individually to the six synthetic secrets). Editor does not include secret IAM administration.
2. Owner grants `30073293485-compute@developer.gserviceaccount.com` Cloud Functions Builder (`roles/cloudfunctions.builder`) in test only. Cloud Build identifies this account as build account; it has no project role binding. Build failures occurred at source-fetch step.
3. Enable test-project signing: runtime account needs Service Account Token Creator scoped to itself for Admin SDK signing; automation account needs the same role scoped to that test service account for the isolated primitive check, or supply an authorized dedicated test signer. No broader production grants.
4. Genuine nonce-bound Google/Apple test sessions are required. Fixture RSA/JWKS overrides cannot replace them. No provider login passwords or tokens should be pasted in chat.
5. Full path B needs approved synthetic-only Elation/Twilio test integration. Current PR Elation client hardcodes production host; do not supply production credentials or use production charts to make this test pass. An explicitly reviewed isolated adapter can test orchestration but must be labeled adapter-backed, not real Elation/Twilio E2E.

## Gate
NOT PASSED. Actual #589 logical mapping plus custom-token path A, B/C, nonce/replay and concurrent completion have not been exercised on hosted callables. No mocked results promoted to hosted evidence. Synthetic data/resources left for owner-authorized continuation/project deletion. Production unchanged by this work; no flag-on, provider enablement, blocking registration, production deploy or canary performed.