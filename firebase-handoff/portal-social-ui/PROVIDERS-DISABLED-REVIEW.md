# Providers-disabled authentication review — 2026-11-01

Status: research and read-only checks only. No production provider configuration, flag, trigger, account, deployment or sending changes. The approved frontend remains a review-only patch, not a My Health Hub release.

## Decision boundary

Firebase custom authentication does not require native Google/Apple providers or native Auth provider linkage. A verified external identity can resolve through a server-owned Firestore mapping to the existing true-case Auth UID, followed by Admin `createCustomToken` and client `signInWithCustomToken`.

The CURRENT deployed flow is different: `functions/core/services/auth/socialSignIn.js::linkProvider` uses Admin `updateUser({ providerToLink })`, creating a native Firebase Auth provider association, followed by the separate `socialLinks` record and custom-token mint. It is not already a logical-mapping-only flow.

Admin SDK documentation/source does not conclusively establish whether the production backend accepts `providerToLink` for disabled providers. The SDK constructs `linkProviderUserInfo` without checking provider configuration, but that is not a production acceptance test. Do not certify the current build as providers-disabled compatible based on this alone.

Recommended target: logical mapping only, native Google/Apple providers disabled, blocking triggers None. This avoids reliance on undocumented disabled-provider Admin-link behavior. Google/Apple themselves must still have correctly configured OAuth applications; disabling their Firebase integration is not disabling Google Identity Services or Sign in with Apple.

Direct Firebase OAuth `accounts:signInWithIdp` documents `OPERATION_NOT_ALLOWED` when the corresponding provider is disabled. Provider disabling does not disable the Firebase user or password/custom-token sign-in, and must not be treated as revocation of existing sessions.

## Required backend change before certifying that target

- Replace native `providerToLink` on both existing-member and governed-claim paths with a server-owned transactional identity mapping, preserving password provider, login email and true-case UID.
- Resolve returning identities by verified issuer/provider + subject first; recheck the live Auth user and existing patient-ID/UID binding before minting. Email remains an Auth-account attribute, never a patient locator.
- Enforce unique identity ownership and conflicting provider-slot rejection in transactions. A mapping collision must never mint a custom token; repeated same-identity/same-UID attempts may be idempotent.
- Preserve claim lease, cleanup constraints and shared on-claim hydration. An existing bound UID must never be recreated or deleted. Do not silently migrate existing native associations or revoke accounts.
- Update the owning repository's INTEGRATION-CONTRACT in the same draft PR; record that Firebase providerData no longer defines logical external-identity membership. Existing CLEAN counts are binding evidence, not proof of this new auth contract.

## Server-bound nonce/replay closure

The deployed provider validator checks RS256, issuer, audience, expiry and subject; it does not check expected nonce. The frontend's random nonce alone does not close this gap.

Required joint protocol:

1. Server issues a bounded, unpredictable login-attempt ID plus nonce and separate browser-held proof. Persist only suitable digests, provider, creation/expiry and stage; never provider tokens, custom tokens or OTP values.
2. Google/Apple credential acquisition uses that server nonce; Apple also validates state. Server checks the signed token's nonce against that attempt before any identity resolution, linking, send, claim or mint.
3. Atomically bind the attempt to the verified issuer/subject and enforce stage progression. Path B reuses its identity only within its own bounded attempt/challenge, not as a fresh transferable login token.
4. Claim/mint completion is single-use under concurrency. A replay, missing/wrong nonce, expired attempt, provider/subject substitution or cross-attempt challenge must fail before side effects. Define safe retry behavior after a lost response without accepting replayed bearer credentials.
5. Keep DOB throttle/lock, Twilio Verify and chart-contact restrictions. Availability/attempt endpoints need abuse controls and must not enumerate patients or practices.

Tests must include actual signed-provider-token verification with nonce cases, concurrent attempt consumption, replay across A/B, challenge substitution and refusal before mint/send/write; real Auth/Firestore/Functions emulator UID/binding invariants; and isolated hosted checks with native providers disabled. Emulator results do not prove production disabled-provider enforcement.

## Configuration and availability

- `GOOGLE_OAUTH_CLIENT_ID` reference is set in this chat's environment. Its value was not printed, copied into a file or sent anywhere. The reviewed Hub frontend still has an empty client setting. The owning project needs an explicitly public Google web client setting matching the server audience; a server-only secret cannot simply be imported by a browser.
- Apple Services ID is `com.primecarevip.portal.web`. The standalone Apple popup requires an owner-authorized HTTPS return URL for that Services ID, not Firebase `/__/auth/handler`. No exact standalone return URL has been confirmed; do not invent authorization or substitute the Firebase handler.
- Non-PHI availability is not implemented. A fail-closed endpoint should return only provider availability booleans, never patient IDs, names, email, DOB, practice membership or staff lists. Anonymous requests should remain unavailable during staff-only rollout; server-verified staff authentication/authorization, master/practice flags and server targeting must gate availability and every social callable. Do not target staff using email, query parameters or client config.

## Read-only checks at 12:16 UTC

- `socialLinkExisting`, `socialStartVerification`, `socialConfirmVerification` all answered their `us-central1` URLs with `FAILED_PRECONDITION / SOCIAL_SIGNIN_DISABLED` using empty requests. This confirms live central-region endpoints and their current disabled guard; no provider tokens or member information were submitted.
- Auth/provider configuration and Cloud Functions metadata reads under `lovable-portal-readonly` returned 403. Actual provider state and `allowDuplicateEmails` were therefore NOT verified. No impersonation was attempted.
- Reviewed frontend test suite: 10/10 passing (8 callable/state safeguards, 2 reset error rules). Not a real provider or hosted sign-in test.
- Latest My Health Hub checkout is unchanged at cb2ef5ec. Cross-project snapshots are read-only; the approved diff has not been applied or released there.
- Real A/B/C, fresh password/custom-token login and true-case UID/password-provider read-back remain unverified. Flag off and triggers None must remain until separate authorization; a saved session does not substitute for fresh authentication.

## If native providers must instead remain enabled

Do not infer safety from UI controls, master flag, CLEAN counts or the existence of socialLinks. Read and verify the actual multiple-accounts-per-email setting, then independently prove all PHI readers deny unbound identities by UID/patient-ID authorization. An Auth token minted outside the callable must never inherit a member binding through email fallback. No orphan-only/no-PHI guarantee was established in this review.

## Sources

- https://firebase.google.com/docs/auth/admin/create-custom-tokens
- https://firebase.google.com/docs/reference/rest/auth (custom-token exchange and disabled-provider OAuth error)
- https://firebase.google.com/docs/reference/admin/node/firebase-admin.auth.updaterequest
- https://github.com/firebase/firebase-admin-node/blob/master/src/auth/auth-api-request.ts
- https://cloud.google.com/identity-platform/docs/link-accounts
- Owning repo main: functions/core/services/auth/socialSignIn.js, functions/core/services/auth/providerToken.js, functions/socialSignIn.js

## Holds

No native provider enable/disable action is authorized here. Provider configuration remains owner-operated. No #588 merge, resource deploy, trigger registration, staff/member canary or production flag change occurred. Resource-only blocking hardening and isolated audience verification remain separately deferred.