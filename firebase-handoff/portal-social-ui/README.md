# My Health Hub social frontend — REVIEW ONLY

Baseline: My Health Hub snapshot cb2ef5ec. This source and diff do not modify My Health Hub, its release, DNS, Firebase configuration or accounts. Apply only in that project's chat/branch after review; do not merge PR #588 as written.

## Dependency answer
The deployed functions/socialSignIn.js at 081627b uses provider-token validation, Admin provider linking and createCustomToken; it never calls the blocking handlers. Firebase's Identity Platform documentation explicitly says anonymous/custom authentication does not support blocking functions. The callable happy path can therefore work with both triggers None. The earlier description of custom-token “pass-through” was imprecise: custom authentication does not invoke those blocking hooks.

This is a functional dependency answer, NOT proof that an unblocked production canary is safe. Enabled Google/Apple providers still expose Identity Platform's direct provider authentication API, independently of the portal UI and Firestore flags. Removing direct-social-sign-in code from the UI does not prevent another client from bypassing the reviewed linking flow or creating/auto-linking accounts. Review that bypass and existing backend record-binding enforcement before approving staff; 267 CLEAN is prior preflight evidence, not a live canary or assurance against that bypass.

Reference: https://cloud.google.com/identity-platform/docs/blocking-functions

## What the diff does
- Provider-native Google credential button / Apple JS popup obtain provider ID tokens without Firebase social sign-in.
- Calls socialLinkExisting; path B asks name/DOB then socialStartVerification and socialConfirmVerification. Only a server-issued custom token reaches the existing signInWithToken. No UID reconstruction, token logging/storage, client member lookup by email, client OTP or destination fallback.
- Uses Firebase httpsCallable in us-central1; does not use the portal's HTTP/PHI client.
- Master/practice enforcement stays server-side. Frontend displayEnabled is hard-off; no query-parameter activation or anonymous patient/config reads.
- Reset awaits the send, exposes operational failures, preserves neutral unknown-account handling, clears notices and restores the button; same-origin /login continuation. No resets were sent while preparing this diff.
- Ten focused logic tests pass: 8 callable/state/serialization tests and 2 reset-error tests. These frontend tests do NOT replace real Firebase emulator UID-preservation tests or production verification.

## Nov 1 logical-linking revision — draft, not a completed release
The companion `portal-social-disabled` proposal removes native Auth provider links, adds server-bound nonce/proof attempts and a non-PHI staff availability callable. Updated frontend sources require this NEW callable protocol; they are not compatible with the deployed protocol. Native providers must be owner-confirmed disabled; no provider setting was changed here.

The initial availability design requires a signed-in, explicitly targeted staff session. It does not provide an anonymous canary login screen. Review placement/bootstrap in My Health Hub before activation. Automatic failed-claim Auth deletion is disabled pending cross-writer coordination; failures retain reconciliation metadata, never silently delete real logins.

## Remaining integration gates — not a completed frontend release
1. Apply diff in My Health Hub and review changed files before publishing; no cross-project write/PR is possible from this chat. Package/lock files and dependencies are unchanged.
2. Set the explicitly public `VITE_SOCIAL_GOOGLE_CLIENT_ID` to the approved Google web client ID matching the server audience list. The named secret reference has not been copied/exposed; owning-project configuration is still required.
3. Owner must confirm an authorized Apple JS popup return URL for the Services ID. Firebase's /__/auth/handler is for Firebase's OAuth flow; do not silently reuse it for a standalone Apple JS flow. appleRedirectUri is deliberately blank, Apple remains disabled. No Apple portal/domain settings changed. Apple SDK integration is unverified.
4. Draft nonce/proof and single-use attempt logic is locally tested with signed fixtures; hosted provider token validation and the full owning-repository suite remain required. The deployed validator is unchanged.
5. Draft `socialAvailability` returns booleans only and fails closed for anonymous/off/untargeted staff; no PHI lookup. New collections must deny client writes in the owning project. Keep frontend hard-off and review authenticated staff bootstrap/placement.
6. In the owning project run its checks, focused tests, and keyboard/mobile browser checks; real A/B/C flows, fresh password login, real custom-token login and true-case UID/password provider read-back remain unverified here. No screenshot or live provider flow has been verified.
7. Keep master flag off, triggers None, canary on hold. Future blocking hardening requires resource-only deployment that cannot mutate registrations and isolated Identity Platform project/tenant audience testing. No production registration window.

## Nov 1 13:07 approved integration follow-up
Portal implementation is now draft PR #589 with contract v1.82; not merged/deployed. Exact staged PR tests: 24 emulator and 13 nonce/no-mutation tests pass locally; 10 frontend logic tests pass. Existing native-link gate still needs migration; hosted gate is blocked on the owner-selected separate test project/access. GitHub checks are not certified green.

Public Google web client setting now has the approved main-config audience as its default. This is public OAuth identification, not a credential copied from the named secret. Runtime audience reads returned 403; deployed values remain unverified. Refreshed patch dry-run applies to the cb2ef5ec baseline. It has NOT been applied in My Health Hub and is not a project-native diff.

Initial staff use must be authenticated account linking after a fresh password sign-in; availability does not support signed-out bootstrap. Move/review controls in the authenticated Hub account view before activation. Targets use exact true-case Auth UIDs; flags/targets remain off/unwritten. See PR rollout notes for setup and five-callable-only deployment hold.

## Review commands (owning project)
Apply my-health-hub-social-controls-review.patch with path strip 1. Run bunx vitest run src/lib/social-flow.test.ts src/lib/reset-flow.test.ts. Keep social-config.ts displayEnabled false. Request a project-native diff/PR from the My Health Hub chat before any publish/staff test.