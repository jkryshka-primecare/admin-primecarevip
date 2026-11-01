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

## Remaining integration gates — not a completed frontend release
1. Apply diff in My Health Hub and review changed files before publishing; no cross-project write/PR is possible from this chat. Package/lock files and dependencies are unchanged.
2. Supply the public Google web client ID already wired server-side; Google config here is deliberately blank.
3. Owner must confirm an authorized Apple JS popup return URL for the Services ID. Firebase's /__/auth/handler is for Firebase's OAuth flow; do not silently reuse it for a standalone Apple JS flow. appleRedirectUri is deliberately blank, Apple remains disabled. No Apple portal/domain settings changed. Apple SDK integration is unverified.
4. Review provider state/nonce/replay requirements and server verification together before enabling; current deployed provider validator checks signature/issuer/audience/expiry, but does not validate an expected nonce. This proposal generates provider nonces but does not claim server-bound nonce coverage.
5. No safe anonymous display-flag reader exists in the reviewed Hub sources. Hard-off UI is suitable for review, not dynamic staff targeting. Decide/review a non-PHI read-only availability endpoint or approved UI gating before activation; do not infer the Firestore master flag from client config.
6. In the owning project run its checks, focused tests, and keyboard/mobile browser checks; real A/B/C flows, fresh password login, real custom-token login and true-case UID/password provider read-back remain unverified here. No screenshot or live provider flow has been verified.
7. Keep master flag off, triggers None, canary on hold. Future blocking hardening requires resource-only deployment that cannot mutate registrations and isolated Identity Platform project/tenant audience testing. No production registration window.

## Review commands (owning project)
Apply my-health-hub-social-controls-review.patch with path strip 1. Run bunx vitest run src/lib/social-flow.test.ts src/lib/reset-flow.test.ts. Keep social-config.ts displayEnabled false. Request a project-native diff/PR from the My Health Hub chat before any publish/staff test.