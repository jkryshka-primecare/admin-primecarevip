# Roadmap

## Nov 10 — #695 production function rollout timeout
- [ ] BLOCKED: root cause/build/operation/function log reads denied HTTP403; requires logging.viewer, cloudfunctions.viewer, cloudbuild.builds.viewer on investigation identity. Driver is gen1, not a gen2 Cloud Run revision.
- [x] Compared #595 against parent: no hydration driver, entrypoint, workflow, dependency manifest or lockfile changes. Pre-existing/rebuild-time cause remains unverified pending GCP.
- [x] Run logs show webhook and adminBatchReissue successful updates on retry; runner is a merged operator script, not a deployed function. No run performed.
- [ ] BLOCKED: live webhook/reissue last-deployed/source confirmation denied cloudfunctions.functions.get. Buffered Actions timestamps are not deployment timestamps.
- [ ] BLOCKED: any source repair awaits confirmed root cause; no blind rerun, sends, flag changes, IAM changes or trigger registration. Findings saved in portal-invite-waves/DEPLOY-695-INVESTIGATION.md.

## Nov 9 — B4 / #593 red-team stateful failures
- [x] Red-team fixtures seed true-case authUid (bindMember shape); positives 200; denials 404 RECORD_NOT_AVAILABLE no PHI
- [x] guardian-uid-case-d068 asserts exact-case caller contract + retired allowlist; mutation check red; pushed fbf2bb6c, Red-team CI green
- [x] Firestore-side prod audit: 0 drift / 0 duplicate across 305 login-bound; 2 active have authUid but no firebaseUid (pre-existing lockout)
- [x] Nov 9 17:36 UTC read-only live Auth rerun succeeded: 1,036 active Hint members, 269 login-bound; 0 stored authUids fail exact live Auth resolution. Broader audit flags 3 active records: 2 missing firebaseUid and 1 multiple live Auth UIDs sharing lowercase form. All 305 login-bound portal records have live exact authUid resolution.
- [x] Nov 9 17:46 UTC collision review: live firebaseUid query size=1; enabled exact-owner password account is bound and resolves under B4; enabled lowercase account has no exact authUid binding and fails AUTH_UID_MISMATCH. size>1 AMBIGUOUS_BINDING guard unchanged; no production sign-in or mutation performed.
- [ ] BLOCKED ON OWNER: authorize repair of 2 missing firebaseUid bindings before release; no merge/deploy or production mutation performed.

## Nov 9 — B4 Elation read-side allowlist retirement
- [x] Audited all nine reads plus shared artifact helper; preserved Bearer verification and added original token.uid exact patient.authUid validation after existing index lookup. No membership gate; guardian controls unchanged.
- [x] Removed read call-site containment only; shared accessGate and all non-read/provisioning/deploy/rules sources byte-unchanged. Exact committed CI runner 40 emulator + 15 focused tests PASS; existing guardian/no-blocker/discovery/roster/auto-invite/refill suites PASS.
- [x] Opened PR #593 at 8b6c4926 (Closes documented #403; Issues create/read 403). Published 20-file scope and critical source verified, complete review patch delivered; no merge/deploy. GitHub checks read 403; Actions status queried separately.

## Nov 9 — portal SendGrid receiver PR #559 / issue #362
- [x] Key correction published at 00e2b930: SENDGRID_PORTAL_WEBHOOK_SIGNING_KEY only, no CRM fallback. Recorded main-account portal vs CRM-subuser topology documented; 33 receiver + 29 real Firestore + 2 no-blocker tests PASS. No merge/deploy, secrets/settings unchanged.
- [x] #559 amended at 48dc6830 against current callable-only main; Closes #362. Existing SENDGRID_WEBHOOK_SIGNING_KEY reference, signed raw bytes, atomic event+suppression, admin-read/client-write-denied collections; CRM unchanged.
- [x] 32 receiver/retry + 29 real Firestore + 2 no-blocker entrypoint checks PASS; existing autosender suite PASS. Full review patch saved; PR body/comment updated; no merge/deploy or flag/trigger changes.
- Release prerequisite (not authorized): populate NEW SENDGRID_PORTAL_WEBHOOK_SIGNING_KEY with main-account portal Event Webhook public verification key and grant portal runtime access; leave CRM key unchanged, configure distinct webhook and verify recent authentic feed only after separate release approval. Live SendGrid settings not audited.

## Nov 6 — D-070 production Google audience wiring
- [x] PR #592 (e0bc4b89): exactly two additions in deploy-production.yml using SOCIAL_GOOGLE_CLIENT_IDS_PRODUCTION and project-scoped env output; references #585 because GitHub Issues read/create denied HTTP403. YAML, populated/empty env smoke checks and published PR one-file/two-addition scope PASS. No merge/deploy; Apple omitted, flags and triggers untouched.

## Nov 5 18:31 — production Google audience and Hub applied review
- [ ] Configure production social callable Google audience — BLOCKED: production metadata/update permissions unavailable (403); GitHub Actions secret listing also 403. Verified main workflow omits audience wiring; saved review-only durable wiring patch. No deployment or live config verification.
- [ ] Apply reviewed callable-only Google frontend in My Health Hub — BLOCKED: owning-project chat required; snapshot still cb2ef5ec, read-only. Patch dry-run against current source and 10 focused tests PASS; no applied native diff or live verification.
- No flag-on, trigger registration or canary authorized.

## Nov 5 — PR #589 callable-only deployment split
- [x] #589 amended at 3b6c8390: blocker require/exports removed, all five callables retained, contract/rollout updated. Required-check regression fails before/passes after; 15 nonce/no-mutation/deploy + 24 emulator PASS locally. Published entrypoint verified; owner review comment posted. No merge/deploy; flags off, triggers None.
- [x] Amended-head required CI run 41948865662 / social-signin-emulator SUCCESS. Owner re-verifies before Michael merges; no agent merge/deploy. Blocking audience repair/registered-hosted gate remains separate #588 work, not authorized by this amendment.

## Nov 5 — PR #589 required gate migration
- [x] Preserved social-signin-gate / social-signin-emulator; logical nonce/no-mutation (13) + Auth/Firestore/Functions (24) PASS locally and GitHub run 41944661028 SUCCESS. Removed duplicate workflow and two obsolete native-link files. #589 Ready for review at 5d1394a9; no merge/deploy, flags off, triggers None.

## Nov 4 — genuine Google hosted verification
- [x] Saved Google audience verified on all five ACTIVE isolated callables; test page published and browser-checked on both Firebase Hosting origins. Project-guarded testGoogleHarness ACTIVE; 12 nonce and 3 isolation tests pass.
- [x] Owner granted testgoogleharness public invoker. Corrected inherited FUNCTION_TARGET from socialLinkExisting to testGoogleHarness on disposable service only; live Prepare succeeds and Google button renders. Browser-check lease released. No genuine sessions/results yet.
- [ ] Owner A session failed after mapping/attempt completion; no success report. Deployed safe stage diagnostics to test harness; awaiting fresh A to isolate failure, then B/C. Test flags restored false. B adapters synthetic; no new-claim/hydration certification.
- [x] Native providers disabled and triggers None verified; production unchanged. Harness prepare never enables flags; completion enables test-only flags after genuine designated identity verification and restores off in finally.

## Nov 3 — mobile iOS Firestore certificate security patch
- [x] Inspected artifacts/mobile; opened draft PR #590 (f8a34d5): ios.env Firebase SDK 12.19.3 pin on all EAS profiles, post-pod-install lockfile gate/artifact, unchanged Expo54/RNFirebase24 dependencies. Only six mobile files changed.
- [x] Exact committed checker blob verified; 13 acceptance/rejection tests PASS, syntax PASS, Android no-op PASS. RNFBApp24 env override and EAS post-install ordering verified upstream; native compatibility still requires actual build.
- [ ] Open/link security issue — BLOCKED: GitHub connected token Issues write denied HTTP403 (PR creation worked).
- [ ] Run EAS iOS rebuild, inspect its actual Podfile.lock, and redistribute — BLOCKED: no Expo/EAS authentication available; current App Store build number/signing/release access unverified. No accepted remote lockfile or distribution yet.

## Nov 1 19:54 — genuine Google session setup
- [x] Owner clarified scope: real Google audience/nonce/signature; Apple deferred to synthetic/unit; Elation/Twilio synthetic/stubbed only, no production credentials.
- [ ] Obtain owner-operated Google test account and approved test web OAuth client; capture credentials through an interactive test-only browser session, never chat.
- [ ] Prepare isolated, clearly labeled Elation/Twilio adapters before full B; keep production unchanged and test flags off outside controlled runs.

## Nov 1 19:48 — runtime permission rerun
- [x] 18/18 hosted checks PASS with new runtime Auth/Firestore permissions; named synthetic staff availability and server-bound attempt creation now succeed. All earlier test permission blockers cleared.
- [ ] Full hosted A/B/C blocked on genuine nonce-bound provider sessions and approved synthetic-only Elation/Twilio integration, not permissions. Actual A mapping/mint, B classification/verification/claim/hydration, C classification and valid-session replay/concurrent completion remain unexecuted; no fixture substitution.
- [x] Test master/practice flags restored false, disabled providers/triggers None confirmed; sanitized results updated, production unchanged and canary held.

## Nov 1 19:14 — rerun after owner grants
- [x] All five test-only callable invoker policies verified allUsers; browser transport reaches application code. Five ACTIVE, audiences populated, native providers disabled, blockers None.
- [x] Fresh synthetic password and separately signed test-project custom-token exchange preserve true-case UID/password. Flag-off/anonymous guards pass; invalid-token direct-provider probes refused. Not A/B/C completion evidence.
- [ ] Hosted A/B/C blocked: runtime 30073293485-compute@developer.gserviceaccount.com cannot read Firebase Auth (INSUFFICIENT_PERMISSION) or Firestore (403). Only roles/cloudbuild.builds.builder observed; automation setIamPolicy repair denied 403. Needs test-project roles/firebaseauth.admin + roles/datastore.user on runtime.
- [ ] Genuine nonce-bound provider sessions and approved synthetic Elation/Twilio integration still unavailable; no signed-fixture substitution or production integration access.
- [x] Test master/practice flags restored off; sanitized report updated; production unchanged, canary held.

## Nov 1 18:54 — resume provisioned isolated test
- [x] Five #589 callables deployed and verified ACTIVE in pcvip-social-test/us-central1; audiences present, no blocking exports or production changes.
- [x] Native providers disabled, triggers None; direct refusal probes OPERATION_NOT_ALLOWED. Fresh password and independently signed test-project custom token preserve true-case synthetic UID; NOT path-A evidence.
- [ ] Hosted A/B/C BLOCKED: endpoint invoker policy missing (401/403); run.services.setIamPolicy denied. Genuine nonce-bound provider sessions and approved synthetic-only Elation/Twilio integration remain unavailable. No fixture substitution.
- [x] Sanitized report updated; test master/practice flags restored off; production canary held.

## Nov 1 14:28 — pcvip-social-test hosted verification
- [x] Disposable Editor access/billing/password/Firestore verified; native providers absent and blockers None. Both direct-provider probes returned OPERATION_NOT_ALLOWED with intentionally invalid test tokens.
- [ ] Five-callable deployment BLOCKED: secret IAM administration denied; bootstrap two-callable Cloud Build failed with runtime/build account missing permissions. Two FAILED resources only, no hosted callable success.
- [x] Synthetic chart/account/staff fixture and disabled test flags seeded; password sign-in succeeded with true-case UID. No production data/credentials transferred to test runtime.
- [ ] Hosted A/B/C gate BLOCKED: project-local signing (foreign signer CREDENTIAL_MISMATCH; test signer signBlob 403), genuine nonce-bound provider sessions, and synthetic-only Elation/Twilio path-B setup required. No fixture-JWKS substitutes used.
- [x] Sanitized results/precise blockers recorded in firebase-handoff/portal-social-disabled/HOSTED-TEST-2026-11-01.md; production untouched, canary held.

## Nov 1 13:07 — approved logical-link production PR
- [x] Real draft portal PR #589, commit ab9341d: logical mapping/nonce/reconciliation/staff gates, exports, explicit denied client collections and INTEGRATION-CONTRACT v1.82. Exact PR-layout checks: 24 emulator + 13 signed-token/no-mutation pass; Hub 10 focused tests pass.
- [ ] Existing social-signin-gate still requires migration from native provider-link/deletion assertions; new logical gate added, CI not certified green. No merge until both gates and hosted test pass.
- [x] Named staff/config setup and five-callable-only deployment scope documented in PR. Existing automatic production workflow can re-arm blocking exports, so merge remains held pending safe deployment plumbing; CRM untouched.
- [ ] Live server audience confirmation blocked by Cloud Functions metadata HTTP 403 under lovable-portal-readonly. Main env source has correct Google web audience and Apple Services ID; public Google setting wired in Hub review source only.
- [ ] Apply/test v2 in My Health Hub and surface native diff — read-only cross-project tools cannot apply it. Refreshed patch dry-run applies to disposable cb2ef5ec copy; authenticated staff placement and browser flows remain unverified.
- [x] Owner chose separate disposable Identity Platform project, not production tenant.
- [ ] Hosted providers-disabled gate blocked on test project provisioning/access and genuine provider-token test sessions; not replaceable by emulators. Apple standalone return URL remains owner authorization prerequisite.
- Deployment conditional on green PR; flags off, triggers None; no canary or flag-on authorized.

## Nov 1 12:14 — disabled-provider bypass and remaining canary gates
- [x] Documented distinction: custom auth supports logical mapping with native providers disabled; current build performs native providerToLink whose disabled-provider production acceptance is unverified. Review in firebase-handoff/portal-social-ui/PROVIDERS-DISABLED-REVIEW.md. No provider/config/account changes.
- [x] Live us-central1 check: all three social callables return SOCIAL_SIGNIN_DISABLED; reviewed frontend tests 10/10 pass.
- [x] Review-only logical mapping/nonce/replay/staff availability proposal and updated Hub source prepared; no Auth update/delete or native linking. Claim failures retain reconciliation holds. Local signed-token, helper and Functions callable emulator checks run; no hosted certification.
- [ ] BLOCKED: owning portal repository integration/full existing suite and denied client-write rules; isolated hosted providers-disabled/custom-token verification needs an approved isolated project/tenant. Current production flow unchanged.
- [ ] BLOCKED: signed-out staff bootstrap/UI placement is not supplied by authenticated-only availability; apply and browser-verify in My Health Hub, whose cross-project access is read-only here.
- [ ] Google reference is present server-side but Hub public configuration remains unset; Apple standalone Services-ID return URL awaits owner authorization. Auth provider/account-link config reads returned 403, not verified.
- [ ] Apply approved frontend in My Health Hub and verify real A/B/C, fresh password/custom-token and true-case UID read-back — blocked here by read-only cross-project access and hard-off production flow.
- Flag off, both blocking triggers None, canary held. No provider-enable or re-registration authorization.

## Nov 1 — callable-only My Health Hub frontend and deferred blocking hardening
- [x] Owner request recorded: keep My Health Hub, provider tokens -> reviewed callables -> custom token; review diff before staff. #588 deferred; future resource-only deployment and isolated Identity Platform audience verification only.
- [x] Deployed socialSignIn.js at 081627b confirms linking/minting has no blocking-handler dependency; official Identity Platform docs exclude custom authentication from blocking functions.
- [x] Deferral/registration hold posted to PR #588; no merge/deploy/registration/flag/account changes.
- [x] Review-only frontend source/diff prepared from Hub cb2ef5ec; 10 callable/reset logic tests pass. Includes hard-off controls, custom-token-only flow, reset failure propagation. NOT applied or live; project-native diff/PR and browser checks require My Health Hub chat (cross-project writes unsupported).
- [ ] BLOCKED: actual provider popup integration needs public Google client ID and owner-authorized Apple popup return URL/config; no configuration guessed or changed.
- [ ] BLOCKED: before canary, review direct social sign-in bypass risk with providers enabled and triggers None; UI/server flags do not constrain Identity Platform's direct provider endpoint.
- [ ] BLOCKED: server-bound provider nonce/replay review and safe frontend availability gating are needed before activating this review-only patch; current provider validator does not validate an expected nonce.
- Flag off, triggers None, canary hold remain unchanged.

## Oct 31 17:11 — Hub compatibility and controlled registration
- [x] Live Hub firebase-Dw9gVZYY.js confirms prive-care-vip Auth and us-central1 functions; existing signInWithToken accepts linking callables' true-case custom token. Frontend integration, not rearchitecture; 267 CLEAN remains prior preflight evidence, not live social verification.
- [x] PR #588 remains open at fc29f2e; current main/retry deployments create/update blocking endpoints and Firebase CLI registers triggers. It does NOT support deploy-without-arming. Registration checker only validates an exported config; signed fixtures are not production-issued blocking tokens.
- [ ] BLOCKED: #588 needs a reviewed resource-only deployment path with no Identity Platform config mutation, fail-closed permissions and pre/post None checks before merge; genuine production blocking event testing cannot occur with both project triggers None without an separately approved isolated testing arrangement.
- [ ] BLOCKED: social controls/reset repair must be made in My Health Hub itself; this project's cross-project snapshot is read-only.
- Keep custom domain unchanged, flag off, triggers None, canary held; no production changes authorized.

## Oct 31 — deployed social sign-in health and owner login
- [x] Incident audience repair drafted in issue #587 / PR #588 (fc29f2e): version-locked exact-URI SDK backport, explicit us-east1, registration checker; 19 signed-token/registration tests + 19 real emulator tests + 29 quick tests pass. Original SDK fails six regression cases. Clean install/postinstall validated. Required gate updated; GitHub runs still in progress. Reviewer root-path concern disproved with actual providers/identity.js resolution.
- [ ] BLOCKED: My Health Hub frontend must be edited in its own Lovable chat (cross-project checkout is read-only); owner chose KEEP it at care.primecarevip.com. Add reviewed provider-token/callable social flow, keep display flag off, and stop masking reset-send errors. Do not repoint DNS to Firebase web-member.
- Owner mitigation at 16:50 UTC: both blocking triggers set to None; sign-ins restored. Keep triggers unregistered, flag off, and canary held until fixes and fresh sign-ins are verified.
- [x] Temporary reader roles worked; read-only capture completed Oct 31 16:40 UTC. Since 16:09:03: beforeSocialSignIn 4 requests, all HTTP 500 (SDK blocking-token audience mismatch: expected run.app, received cloudfunctions.net URL). beforeSocialCreate no requests observed. No password-attempt audit records or usable success-rate baseline available; canary health gate FAILED.
- [x] Owner Auth verified enabled, password-only, exact email and true-case authUid; deployed resolver recheck CLEAN/path A/eligible. Failed attempt cannot be tied to an individual from available logs; blocking SDK errors are proven, wrong password is not.
- [x] Public member login inspected: Forgot password clickable with empty email, notice displayed, no page JavaScript errors; populated-email/send path not exercised.
- [x] Public login masks all sign-in errors and reset failures; public asset bundle differs from artifacts/web-member source at 081627b. No frontend edits made.
- [x] Hosting provenance: #690 built index-SVIkYpg8.js and released care-primecarevip at 16:03:57; care-primecarevip.web.app serves that exact entry. care.primecarevip.com serves separate index-DRMfWF7U.js + login-DHi2AFTy.js through Cloudflare. Custom-address serving source remains unidentified; not a skipped #690 Hosting deployment.
- [ ] BLOCKED: separate owner approval to merge/deploy/re-register PR #588; broad portal-functions deployment would re-register triggers. Keep both None. Validate fresh password/custom-token sign-ins after authorized registration before canary.
- [x] Custom-address provenance resolved: live login implementation matches My Health Hub snapshot cb2ef5ec, not Firebase web-member. Repair handoff recorded in PR #588 plans/MY-HEALTH-HUB-SOCIAL-REPAIR.md; UI remains blocked on work in that project.
- [x] Deploy #690 verified green: Oct 31 16:02:36–16:09:03 UTC; deployed blocking source preserves password/custom-token no-I/O pass-through (source evidence only).
- Rollout flag remains off; no canary or deployment authorized.

## D-317 — durable slow-chart hydration recovery (in progress)
- [x] Issue number attempt — GitHub Issues API still 403; MK must file (proposed #530 designator) (API has been 403; propose designator if blocked)
- [x] Shared terminal-status helper (`hydrationStatus` write out of `claimAccount.js`)
- [x] Claim-time soft budget ~120s → `deferred` + `hydrationRunId` + enqueue on recovery run doc
- [x] Hydration recovery driver (deferred + stale pending, armed/opt-in, reports + letters)
- [x] Letters HTTP/bridge wrapper for `backfillElationLetters`
- [x] Token settlement for stranded tokens on completion
- [x] INTEGRATION-CONTRACT.md v1.59 (`deferred` status + letters surface) + D-023 heads-up
- [x] Unit tests (16 passing): soft-budget deferral, driver pickup, shared status helper
- [x] Report issue number, contract diff, run plan. No deploy / no run until MK approves.

## Open (blocked)
- Real-member activation recheck after a member re-clicks their old link (waiting on MK signal)

- [ ] BLOCKED ON MK: file the D-317 issue, approve deploy, then dry-run + cap:1 for 1370412230508545

## Guardian model — Phase A (non-patient guardian accounts + proxy reads) — BUILT, PR #560, parked
- [x] Guardian account record + chartless activation path
- [x] Guardian link keyed on guardian account (not chart); explicit positive authorization check
- [x] Replace "caller must own a chart" fence; explicit empty/missing id rejection
- [x] Wire medications/allergies/problems/appointments through the shared subject resolver
- [x] Read-time age-18 gate (moved from Phase C)
- [x] Negative tests: no links; linked to X requesting Y; null/empty ids both sides (26 tests green)
- [x] DECISION-LOG D-409 (legal approved 2026-09-21) + INTEGRATION-CONTRACT v1.69
- [ ] BLOCKED: named-test-account walkthrough needs a deploy (emulator/staging) — not authorized yet
- [ ] Arming gated on A + B together; master switch off, allowlist empty
- [ ] Phase B policy filter (allow-all default, state/age/category)
- [ ] Phase C approaching-18 operator report only
- [ ] Phase D transition: DOB second factor + verified OTP contact before account/access

- [ ] CRM crmdb Firestore target — draft PR #565 built + verified. HOLDS: (1) Greg confirms CRM frontend is callable-only, else scoped rules; (2) move ci-staged/*.yml into .github/workflows (token lacks workflow scope); (3) Greg: 26 vs 27 indexes

## Refresh-email-from-chart (PR #574) — code approved 2026-10-08
- [ ] BLOCKED ON RYAN: review + confirm main is deploy-safe, then merge/deploy
- [ ] At go-live: confirm the Portal tab "Refresh email from chart" button works end to end (re-enable if greyed out)
- [ ] Future ticket: store true-case authUid on claimed records (removes email fallback; firebaseUid-only partial failures currently need manual reconcile after 409)

## Member auto-provisioning rollout (#557 discovery, #558 auto-invite)
- [x] Dale Hershman set up + invited manually (2026-10-13)
- [x] Safeguard gaps closed, shared email helper, emulator tests + CI (#557 8/8, #558 9/9)
- [x] #557 conflicts resolved; #558 rebased on #557
- [x] Backlog backfill PR #575 (stacked on #558, 5/5 tests)
- [x] #557 fails closed on missing/empty Hint key (13/13); #559 merged with main + renumbered v1.76; all CI green
- [x] #576 status fix (invites persist "invited") + reconcile script; #577 lockfile issue filed for Greg
- [ ] BLOCKED ON TEAM: review #576, #557 → #558 → #575; Greg confirms main deploy-safe; Michael merges in order
- [ ] BLOCKED: #559 needs a named owner for merge → deploy → confirmed events; #558 can't send until then
- [ ] Before arming #557: create `HINT_PRACTICE_API_KEY` secret + grant runtime access; 1 week report-only, then creation-only
- [ ] Dale: after #576 deploys, run reconcile for his chart, then confirm record reads "invited"

- [ ] Scope portal functions deploy to `functions:portal-functions` (draft PR + issue) — blocked: GitHub token rejected (401), user checking via Chrome agent

## Move 1 — Google + Apple portal sign-in (#585, draft PR #586)
- [x] Issue #585 + draft PR #586: callables, linking core, blocking functions (unexported), 24 unit tests, Firestore flag
- [x] Identity Platform enabled (IDENTITY_PLATFORM), confirmed by owner
- [x] Twilio Verify replaces hand-rolled codes (commit b8351cf)
- [ ] BLOCKED ON OWNER: lift COMPLIANCE_HOLD + bind Twilio secrets only after BAA (Verify) + A2P 10DLC confirmed
- [x] Full path A/B flow, blocking handlers exported default-off, governed claim, exclusions, phone rules (b8351cf)
- [x] Emulator merge gate: 17/17 real Auth+Firestore+Functions tests; unit 29/29
- [ ] BLOCKED ON OWNER: add workflow file + required check `social-signin-emulator`
- [x] Provider/domain checklist delivered; owner configuring Google/Apple/Twilio
- [x] Google support email care@primecarevip.com; no care-preview (localhost + firebaseapp.com test, canary on care.primecarevip.com)
- [x] Review PR #586 against updated owner requirements (2026-10-19); report and owner checklist delivered, sign-in code unchanged
- [ ] Hub UI remains unfinished; do not expose social buttons before reviewed linking flow is ready
- [x] Dry-run produced 2026-10-29 (992 active); per-member ID-only file in Files
- [x] Dry-run approved 2026-10-29; canary staff first, then small member group
- [ ] BLOCKED ON OWNER: confirm ~270 existing logins valid before real-member test
- [ ] BLOCKED ON OWNER: separate sign-off to deploy blocking functions (watch existing sign-ins)
- [x] Invite list email pre-check (free MX + syntax check, read-only; review import files produced 2026-11-10)
- [ ] Team reviews and applies the inviteEmailCorrections import (2 rows); suppression import is empty (blocked on: team review)
- [x] Invite wave runner (issue #594) built report-only; waiting on domain prep + wave 1 approval
- [ ] Hold: 64 no-account adults (account creation gated), 194 minors (guardian policy pending)
- [ ] Review: 1 under-18 with portal access, 2 under-18 with expired direct invites
