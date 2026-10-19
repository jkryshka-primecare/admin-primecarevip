# Move 1: Google + Apple sign-in for the member portal (build plan, no code yet)

Tracking: open a new GitHub issue "Portal social sign-in (Google + Apple) with UID-preserving linking". Every PR below says `Closes #N` (or a sub-issue). No direct commits to main. Claude reviews this plan and each diff. Greg signs off only if `deploy-production.yml` changes (not expected). Deploys stay scoped to `functions:portal-functions` (PR #583); never revert.

## Goal
Members can sign in with Google or Apple and land on their **existing** Firebase Auth UID and patient record. Email/password keeps working. Nobody signed in today is affected.

## Non-negotiables
1. **No new UIDs for existing members.** A social sign-in either attaches to an existing true-case Auth UID that is already bound (`firebaseUid`/`authUid`, D-016/D-125) to a roster doc, or it is refused. Never auto-create a member account from a social sign-in.
2. **Patients are never looked up by email.** Email is used only to find the *Auth account* that already owns that login email. The patient record is then found through that UID's existing binding, never through a roster email search. Shared family emails cannot cross records.
3. **Additive.** Password provider stays on every account. No forced migration, no session invalidation.

## Provider setup (Firebase project prive-care-vip)
- Enable Google and Apple providers in Firebase Auth. Keep Email/Password on.
- Keep "One account per email address" ON (it is what makes linking safe).
- Apple: Services ID, key, team ID in Secret Manager (values never in chat). Request `email` and `name` scopes. Register portal domains (care / care-preview) as return URLs.
- Authorized domains: care.primecarevip.com and care-preview only.

## Account-linking strategy
All decisions happen server-side in a **`beforeUserCreated` / `beforeUserSignedIn` blocking function pair** plus one callable, so the client cannot pick a UID.

```text
Member taps Google/Apple
  -> Firebase resolves provider email (verified)
     A. Auth user with that email exists AND is bound to exactly one roster doc
        -> link provider to that UID (path A, below)
     B. No Auth user owns that email, or Apple relay address
        -> beforeUserCreated BLOCKS creation
        -> client shows "Confirm it's you" (fallback, path B)
     C. Auth user exists but bound to 0 or 2+ roster docs, suspended, or a guardian/minor edge case
        -> refuse, show "Contact the practice", log reason
```

**Path A (email matches):** client gets `auth/account-exists-with-different-credential`. Instead of asking for the old password (the thing members lost), the client sends the provider ID token to callable `linkSocialIdentity`. It verifies the token with Google/Apple, confirms `email_verified`, resolves the Auth user by email, checks the UID's binding (exactly one roster doc, status not suspended), then calls Admin `updateUser(uid, { providerToLink })` and returns a custom token minted with the **true-case** `userRecord.uid`. Client calls `signInWithCustomToken`.
- Known Firebase hazard: signing in with Google onto an *unverified* password account can drop the password provider. The blocking function prevents this by never letting Firebase do automatic linking; only the callable links.

**Path B (DOB fallback, incl. Apple Hide My Email):** callable `confirmSocialIdentity` takes the verified provider token + date of birth + a second factor (see open decision). It finds the candidate roster doc, checks DOB against the **live Elation chart**, reuses the existing DOB throttle/lock (`DOB_THROTTLED`, `DOB_LOCKED`), then links the provider to the bound UID exactly like path A. One-time: once linked, the provider sign-in goes straight through next time. Apple relay addresses (`@privaterelay.appleid.com`) are stored only as the provider's email, never written over the portal email or chart email.
- Unclaimed members (no Auth UID yet): path B creates the Auth user via the existing `claimAccount` bind logic (same binding code, same audit), with the social provider attached instead of a password. No second binding code path.

## Open decision (needs your call before code)
DOB plus name alone lets anyone who knows those facts attach their Google account to someone's records. Recommend path B also require one of:
- a 6-digit code sent to the **existing portal account email**, or
- a code by SMS to the chart phone, or
- the member's still-valid invite link (covers most of the ~508).

## Audit and safety
- Every link/refusal writes an audit row (uid, elationPatientId, provider, path A/B/C, reason). No PHI or tokens in logs.
- Feature flag `SOCIAL_SIGNIN_ENABLED` (default false, plain env like the other flags) plus per-practice kill switch; buttons hidden when off.
- Admin console (this app) Portal tab later shows which sign-in methods a member has (read-only).

## Test and dry-run plan (before any real member is affected)
1. **Unit/emulator tests (CI):** path A links to existing UID; shared family email resolves only the UID owner; unverified-email account keeps password; 0/2+ bindings refused; suspended refused; Apple relay goes to path B; DOB mismatch/throttle/lock; no Auth user is ever created outside claim bind; custom token uses true-case uid.
2. **Dry-run report (read-only):** for all active members, predict which path each would hit (A / B / C) and count likely conflicts. No writes. Counts only in chat, list in a file.
3. **care-preview** with test fixtures (password member, unclaimed member, family-shared email, Apple relay).
4. **Production canary:** flag on for named staff test accounts only, then 10 members, then all.
5. Rollback = flag off. Linked providers stay harmless; password sign-in never touched.

## Later moves (direction only, not in this build)
- Move 2: retire the read allowlist after confirming per-patient scoping stands alone (separate plan).
- Move 3: Elation webhook to Firestore mirror. Linking uses only the UID binding, so it is unaffected.

## Technical notes
- Work lives in the portal Firebase repo (`portal-functions` codebase) and the member hub; this admin app needs no changes for move 1.
- Next deliverable after approval: open the issue, then a PR with the blocking functions + callables + emulator tests behind the flag, no deploy.
