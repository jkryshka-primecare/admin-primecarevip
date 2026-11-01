# pcvip-social-test: hosted verification results

Revision: PR #589, ab9341d08874b5e76c395985318603cb4d153458. Date: 2026-11-01 UTC.

## Latest rerun after 19:14 UTC request
This section supersedes prior deployment/invocation blockers below. **Full hosted gate remains NOT PASSED.**

- All five Cloud Run services now have roles/run.invoker for allUsers. Browser-callable requests reach the application, without a server authorization token. Automation still cannot set service/project IAM (403), but invoker access is already installed by the owner.
- Five callables ACTIVE; server Google audience populated and Apple audience com.primecarevip.portal.web; providers disabled; blocking triggers None.
- 14 of 16 harness checks pass: configuration, direct disabled-provider refusal probes, fresh synthetic password, independently signed custom-token exchange, flag-off/anonymous behavior, password-provider preservation and final flags/triggers. Named staff availability and begin fail closed: availability false; begin SOCIAL_SIGNIN_DISABLED. Custom-token exchange is NOT path A evidence.
- Confirmed root cause using a short-lived impersonated test-runtime access token: accounts:lookup for SyntheticStaffTrueCase02 returns INSUFFICIENT_PERMISSION; Firestore config/socialSignIn read returns HTTP 403 PERMISSION_DENIED. Runtime is 30073293485-compute@developer.gserviceaccount.com; the only observed project role binding for it is roles/cloudbuild.builds.builder. staffAccess deliberately masks these read failures as disabled access.
- Attempted narrowly test-scoped IAM repair was refused HTTP 403. Owner must grant that runtime account roles/firebaseauth.admin and roles/datastore.user on pcvip-social-test. Existing deployment/signing/invoker grants do not grant the Auth and Firestore access that the application requires.
- Genuine nonce-bound Google/Apple sessions and approved synthetic-only Elation/Twilio integration remain unavailable in the harness; no external provider sessions were fabricated, no verifier/JWKS substitutions deployed, no production credentials/charts accessed.
- Actual socialLinkExisting A mint, B verification/claim/hydration, C resolution, mapping/replay/concurrent completion remain unexecuted on hosted callables. No A/B/C success is claimed.
- Test master and synthetic practice flags restored false; providers disabled, triggers None, password provider preserved. Temporary automation credential removed after diagnostics. Production untouched; canary held.

## Resumed run after provisioning (18:54 UTC request)
- Successfully deployed exactly five reviewed callables to pcvip-social-test, all ACTIVE in us-central1: socialAvailability, socialBeginAttempt, socialLinkExisting, socialStartVerification, socialConfirmVerification. No blocking exports deployed. The staging index only selects these exports; implementation modules unchanged. The generated Bun lockfile was removed from staging to preserve the reviewed npm-based Cloud Build path.
- Google/Apple configurations remain absent; both blocking triggers remain None. Server environment metadata confirms a populated Google audience and Apple audience com.primecarevip.portal.web on all five functions.
- Direct Google and Apple endpoint probes again returned OPERATION_NOT_ALLOWED with intentionally invalid synthetic tokens. This is disabled-provider refusal evidence, not genuine external token validation.
- Fresh password authentication and a test-project-signed custom token both succeed; verifying the returned Firebase ID token confirms exact UID SyntheticStaffTrueCase02. Password provider remains intact. The custom token was independently signed with the test runtime account; it was NOT returned by socialLinkExisting and does not establish path A.
- Hosted callable requests cannot reach application logic: browser-style requests receive HTTP 401, and runtime-signed server authorization receives HTTP 403. Adding roles/run.invoker failed because run.services.setIamPolicy returned HTTP 403 for the automation account. Deployment succeeded but callable invocation permission was not installed.
- Owner action: in pcvip-social-test only, grant roles/run.invoker to allUsers on the five callable Cloud Run services (normal Firebase browser-callable transport; in-function authentication/staff gates still apply), or authorize automation to set that narrowly scoped service policy. No production policy changes.
- Full hosted A/B/C also still requires genuine nonce-bound Google/Apple sessions and an approved synthetic-only Elation/Twilio integration. Existing source hardcodes the production Elation host; inert sentinel secrets are not usable test credentials. No provider/JWKS substitutions or production integrations were introduced.
- Only synthetic test records used; test master and synthetic practice flags restored off after probes. Production not accessed or changed. Final test provider/blocking configuration unchanged.
- The Firebase CLI reported an artifact-cleanup-policy warning after five successful deployments; no --force used. Owner plans to delete the disposable project.
- **Gate remains NOT PASSED.** A/B/C application outcomes, replay/concurrent completion and full second-factor/hydration remain unverified on hosted callables. Earlier permission blockers for source build/secret binding/signing are cleared; callable transport permission and genuine-session/integration prerequisites remain.

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