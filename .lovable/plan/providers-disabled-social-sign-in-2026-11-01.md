# Providers-disabled social sign-in

## Answer and current limit

**Yes: a logical external-identity mapping plus Firebase custom-token login can run with Firebase's native Google/Apple providers disabled.** The Google and Apple OAuth applications still need correct configuration.

The deployed build is **not yet that flow**: it calls Admin `providerToLink`, creating a native Auth provider association, then writes `socialLinks` and mints a custom token. Documentation does not conclusively guarantee that native Admin linking succeeds with the provider disabled. Do not certify the current canary on that assumption.

Use logical mapping only so the canary does not depend on native provider linking or armed blocking triggers. Native Firebase OAuth rejects disabled providers; disabling them is owner-operated and not authorized by this plan. No production settings change during implementation.

## Build and review

1. **Backend draft in portal-functions only:** replace native provider-link mutations with transactional issuer/provider/subject → existing true-case Auth UID mapping. Recheck live Auth user, eligibility, patient-ID/UID binding and mapping conflicts before minting. Preserve password provider, account email, governed claim cleanup and shared hydration. Resolve returning identities through the mapping, not social email as a patient locator. Update INTEGRATION-CONTRACT in the same draft; no merge or auto-deploy.
2. **Server-bound nonce and replay:** introduce a bounded login attempt with server nonce and browser-held proof; validate signed-token nonce before identity resolution or side effects. Bind attempt to provider/subject, preserve staged path-B progression, reject challenge substitution and atomically enforce single-use completion. Maintain DOB throttle/lock and Twilio Verify safeguards.
3. **Staff availability:** add a fail-closed non-PHI endpoint returning provider availability only. Anonymous requests stay unavailable during staff-only rollout. Use server-verified staff authorization and master/practice flags; enforce the same targeting on every social callable. Never return roster information or staff lists.
4. **My Health Hub frontend:** consume server attempts, use provider-native token acquisition → callables → server custom token → existing signInWithToken. Keep controls hard-off and truthful reset/error handling. Surface a revised diff before applying or publishing.
5. **Configuration:** wire the Google client through an explicitly public frontend setting matching the server audience, without publishing a secret reference's contents. Owner confirms/authorizes an exact standalone Apple HTTPS return URL for the Services ID—not Firebase's handler. No URL or authorization will be guessed.

## Verification gates

- Signed-token tests: missing/wrong nonce, expiry, issuer/audience/signature, provider/subject substitution, replay and cross-attempt challenges fail before mint/send/link.
- Auth + Firestore + Functions emulator tests: true-case UID preservation, password preservation, mapping ownership/collision, returning identity, A/B/C, concurrent completion, claim cleanup and no real-member deletion.
- Isolated hosted project/tenant: native Google/Apple providers disabled; valid direct OAuth attempt refused; logical mapping/custom-token flow succeeds. Emulator results alone do not certify production provider-disable behavior.
- Owning My Health Hub project: apply reviewed frontend, then verify real A/B/C, fresh password and custom-token login plus true-case UID and binding read-back, only in an approved isolated test environment. Production remains hard-off until separately authorized.
- Final production canary gate requires owner-confirmed native providers disabled and an approved rollout; no production test or re-registration is implied.

## Verified now

- All three live callables respond in `us-central1` with `SOCIAL_SIGNIN_DISABLED`.
- Existing review-only frontend safeguards: 10/10 tests pass.
- Google reference is present in this chat's environment; Hub frontend setting is still empty.
- My Health Hub snapshot remains cb2ef5ec; approved diff is not applied or live.
- Provider configuration / multiple-accounts-per-email reads returned 403. No enabled-provider orphan/no-PHI guarantee is established.

## Execution boundaries and blockers

My Health Hub cannot be written from this chat: its checkout is read-only. Applying the frontend and verifying its release must happen in the My Health Hub project. Apple standalone return authorization and a suitable isolated hosted test environment remain prerequisites for those checks. No production provider, account, flag, trigger, send, deploy or canary change is authorized.

Keep My Health Hub at care.primecarevip.com. CRM untouched, #588 deferred, master flag off, both blocking triggers None and canary held.