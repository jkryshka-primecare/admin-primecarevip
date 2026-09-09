# One-step activation — additive `customToken` on claimAccount success

Tracking issue: **#505** — the backend PR must say `Closes #505`.

Joint item: changes the `claimAccount` success contract. Ryan sign-off required
before merge and before Lovable2 builds the hub side. Verify on care-preview
before care.primecarevip.com.

## Merge checklist (backend PR, all in the same PR)

- [ ] `Closes #505` in the PR body.
- [ ] `plans/INTEGRATION-CONTRACT.md` v1.52 entry (text in §4) merged in the same PR.
- [ ] `iamcredentials.googleapis.com` enabled in **prod** and **care-preview**.
- [ ] `roles/iam.serviceAccountTokenCreator` self-binding on the `claimAccount`
      runtime service account in **prod** and **care-preview** (§2).
- [ ] Ryan sign-off recorded before merge.
- [ ] care-preview verification run (§3) green.
- [ ] No failure reason strings changed.

Field name is **`customToken`** (supersedes the `loginToken` name used in the
earlier draft of `CLAIM-RESPONSE-CONTRACT.md`).

## 1. Backend change (functions/claimAccount.js)

Single insertion, immediately before the final success write. Both success
paths — freshly created user and adopted-orphan-then-bound — converge here and
both hold `userRecord`, so one insertion covers both.

```js
  log('claimAccount', 'ok', { elationPatientId, uid });

  // One-step activation: mint a short-lived custom token so the hub can call
  // signInWithCustomToken and land the member in the dashboard without a
  // second sign-in. MUST use userRecord.uid (TRUE CASE) — the `uid` in the
  // response is the D-016 lowercased Firestore-key form and does not resolve
  // to an Auth user. Fail-soft: a mint failure is not an activation failure.
  let customToken = null;
  try {
    customToken = await admin.auth().createCustomToken(userRecord.uid);
  } catch (err) {
    logError('claimAccount', 'custom-token-failed', err, { elationPatientId, uid });
  }
  return res.status(200).json({ uid, customToken });
```

Requirements honored:

1. **True-case uid** — `createCustomToken(userRecord.uid)`, never the lowercased
   response `uid`.
2. **Genuine-success path only** — the insertion is after the bind, at the sole
   final 200. Every `ALREADY_CLAIMED` / idempotent-rebind branch returns 409
   earlier and is untouched, so no token is ever minted for an account someone
   else already owns.
3. **No failure-reason strings changed.** Nothing else in the file moves.

Fail-soft semantics the hub must implement: `customToken` absent or `null`, or
`signInWithCustomToken` rejecting (expired/consumed), means **activation
succeeded** — route to sign-in with a success message, never an error.

Custom tokens are valid 1 hour, single-exchange. The hub exchanges immediately
and discards it. Activation awaits hydration (timeout budget 180s), so the hub
needs a submit spinner and no client timeout under ~120s.

## 2. IAM precondition

`createCustomToken` signs a JWT via the IAM Credentials API and throws at
runtime without token-creator on the function's own runtime service account.

Check (gen1 functions default to `<project>@appspot.gserviceaccount.com`;
confirm the actual value first):

```bash
PROJECT=prive-care-vip
gcloud functions describe claimAccount --project "$PROJECT" --region us-central1 \
  --format='value(serviceAccountEmail)'

SA="$(gcloud functions describe claimAccount --project "$PROJECT" --region us-central1 \
  --format='value(serviceAccountEmail)')"

# Does it already hold the role on itself?
gcloud iam service-accounts get-iam-policy "$SA" --project "$PROJECT" \
  --flatten='bindings[].members' \
  --filter="bindings.role:roles/iam.serviceAccountTokenCreator" \
  --format='table(bindings.role, bindings.members)'
```

Add if missing (self-binding — the SA signs as itself):

```bash
gcloud iam service-accounts add-iam-policy-binding "$SA" \
  --project "$PROJECT" \
  --member="serviceAccount:$SA" \
  --role="roles/iam.serviceAccountTokenCreator"
```

Also ensure `iamcredentials.googleapis.com` is enabled:

```bash
gcloud services enable iamcredentials.googleapis.com --project "$PROJECT"
```

Preview/staging project needs the same binding, or care-preview verification
fails with a signBlob permission error rather than a code bug.

## 3. Verification on care-preview

1. Fresh invite for a disposable fixture patient (never a real member).
2. Activate: response is 200 with a non-empty `customToken`; hub exchanges it
   and lands on the dashboard with no second sign-in.
3. Fixture Firestore doc shows `status: 'active'`, `firebaseUid` (lowercased),
   `hydrationStatus: 'complete'`.
4. Reopen the same link: still 401 `INVALID_TOKEN` (or 409 if the decision in
   §5 is taken) — and **no** `customToken` in the body.
5. Force-fail the mint (temporarily remove the IAM binding on preview): 200,
   `customToken: null`, hub routes to sign-in with a success message.

## 4. Contract entry (plans/INTEGRATION-CONTRACT.md, same PR)

> Version: 1.52 — 2026-09-09 (`claimAccount` success shape is now
> `200 { uid, customToken }` — ADDITIVE, one-step activation. `uid` is unchanged
> (D-016 lowercased Firestore-key form). NEW `customToken` is a Firebase custom
> token minted with `admin.auth().createCustomToken(userRecord.uid)` — TRUE-CASE
> Auth uid per D-112 (`authUid` semantics); minting with the lowercased `uid`
> targets a non-existent Auth user and is FORBIDDEN. Minted ONLY on the genuine
> final-success path (fresh create AND adopted-orphan-then-bound, both after a
> successful `bindMember`); NEVER on any 409 ALREADY_CLAIMED / idempotent-rebind
> branch — those return before the mint. FAIL-SOFT: a mint failure logs
> `custom-token-failed` and still returns 200 with `customToken: null`; callers
> MUST treat absent/null/expired token as ACTIVATION SUCCEEDED and route to
> sign-in, never as a failure. Token is 1-hour, single-exchange via
> `signInWithCustomToken`; the client exchanges immediately and discards it.
> Existing clients reading only `{ uid }` are unaffected. No error reason
> strings changed. RUNTIME PRECONDITION: the function's runtime service account
> holds `roles/iam.serviceAccountTokenCreator` on itself and
> `iamcredentials.googleapis.com` is enabled, or `createCustomToken` throws.
> Response still WAITS on first-claim hydration (v1.40, 180s budget). — #N)

## 5. Decision for Ryan — consumed token + already-bound patient

Today `validateClaimToken` runs first, so a member who reopens their link after
completing activation gets the generic 401 `INVALID_TOKEN`
("link invalid or expired") and never reaches the `firebaseUid`-present 409
`ALREADY_CLAIMED` check. It reads as lockout when the correct action is simply
"sign in".

**Recommendation: take the narrow version.** On a token that fails validation
*because it was consumed* (not unknown, not malformed, not expired), resolve the
token's own patient doc; if that doc has a `firebaseUid`, return 409
`ALREADY_CLAIMED` instead of 401. Otherwise keep the generic 401.

Why this is a small posture trade, not a big one:

- The disclosure is scoped to the holder of a token we ourselves issued and that
  was consumed by a successful activation. An attacker with that token learns
  only "this link was used", which the 401 already implies.
- Unknown / malformed / expired-unused tokens stay generic, so the enumeration
  oracle over guessed tokens is unchanged.
- DOB throttling is unaffected — the branch returns before any DOB compare.

Do **not** take the broad version (409 for any invalid token whose patient is
bound), which would turn arbitrary token guesses into a bind oracle.

If Ryan prefers zero posture change, the fallback is hub-side copy only: soften
the dead-link message to "This activation link is no longer valid — if you've
already set up your account, please sign in", with a sign-in button. No backend
change, no disclosure, most of the UX win.

Ship this as a **separate PR** from the `customToken` change; it touches error
mapping and the hub maps reasons as-is today.

## 6. GitHub issue body (filed as #505)

Title: `claimAccount: return additive customToken for one-step activation`

> **Problem.** Activation is two-step: `claimAccount` creates the account and
> binds the patient, but the success body is `{ uid }` only, so the hub cannot
> establish a session and sends the member to `/login` to sign in a second time
> immediately after choosing a password. This is a measurable drop-off point and
> was a contributing factor in the 2026-09-09 activation incident.
>
> **Change (additive, success path only).** Return a Firebase custom token
> alongside `uid` so the hub can call `signInWithCustomToken` and land the member
> in the dashboard.
>
> ```js
> const customToken = await admin.auth().createCustomToken(userRecord.uid);
> return res.status(200).json({ uid, customToken });
> ```
>
> **Requirements**
> - Mint with `userRecord.uid` (true case). The response `uid` is the D-016
>   lowercased Firestore-key form and resolves to no Auth user.
> - Genuine-success path only. Both the fresh-create and adopted-orphan-then-bound
>   paths reach the final 200 and both carry `userRecord`. No token on any 409
>   `ALREADY_CLAIMED` / idempotent-rebind path.
> - Fail-soft: mint failure logs `custom-token-failed` and still returns 200 with
>   `customToken: null`. The hub treats null/expired as success → sign-in.
> - IAM: runtime SA needs `roles/iam.serviceAccountTokenCreator` on itself and
>   `iamcredentials.googleapis.com` enabled, in production **and** preview.
> - Do not touch any failure reason string — the hub maps them as-is.
>
> **Also in this PR:** document `customToken` in `plans/INTEGRATION-CONTRACT.md`
> (v1.52 entry drafted in
> `firebase-handoff/portal-claim/ONE-STEP-ACTIVATION.md`).
>
> **Acceptance**
> - [ ] care-preview: fixture activation returns non-empty `customToken`; hub
>       exchanges it and reaches the dashboard with no second sign-in.
> - [ ] Reopened link: no `customToken` in the body.
> - [ ] IAM binding removed on preview → 200 with `customToken: null`, hub routes
>       to sign-in with a success message.
> - [ ] Contract v1.52 merged in the same PR.
> - [ ] Ryan sign-off recorded before the hub build starts.
>
> Out of scope, tracked separately: consumed-token + already-bound →
> `ALREADY_CLAIMED` (§5 of the handoff doc).
