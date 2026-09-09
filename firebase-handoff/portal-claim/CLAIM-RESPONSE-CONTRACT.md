# claimAccount — one-step activation contract (answers from source @ origin/main)

Source: `functions/claimAccount.js` (read from GitHub, 2026-09-09).

> **Superseded in part:** the additive success field is named **`customToken`**,
> not `loginToken`, and it must be minted with the TRUE-CASE `userRecord.uid`.
> See `ONE-STEP-ACTIVATION.md` in this folder for the authoritative change,
> IAM precondition, contract entry, and issue body. The error table below is
> still current and unchanged.

## Q1 — Does the success response carry the email?

**No.** The only success write is:

```js
return res.status(200).json({ uid });
```

No email, no custom token, no session. A front-end-only sign-in is therefore
**not possible** without either (a) collecting the email in the form, or
(b) changing the response shape. There is no third option today.

## Q2 — Recommended path: additive custom token (Option 1)

Add, immediately before the final `res.status(200)`:

```js
let loginToken = null;
try {
  loginToken = await admin.auth().createCustomToken(userRecord.uid);
} catch (err) {
  logError('claimAccount', 'custom-token-failed', err, { elationPatientId, uid });
  // non-fatal: account is live and bound; hub falls back to the sign-in page.
}
return res.status(200).json({ uid, loginToken });
```

Properties:

- **Purely additive** — existing clients that read `{ uid }` are unaffected.
- **Minted only on the genuinely-new-bind path.** Every already-claimed /
  idempotent-rebind branch returns 409 earlier, so a custom token is never
  handed out for an account someone else owns.
- **Fail-soft.** If minting throws, the response still returns 200 with
  `loginToken: null`; the hub must treat a missing/expired token as "activation
  succeeded, go sign in" — never as a failure.
- Custom tokens are 1-hour-valid, single-exchange via
  `signInWithCustomToken`. The hub exchanges immediately and discards it.

Do **not** add an email field to the activation form: it weakens the
anti-enumeration posture (the form currently reveals nothing about who the token
belongs to) and adds a second thing the patient can get wrong.

## Q3 — Error reasons the hub can map (exact, from source)

| HTTP | `details.reason` | Meaning | Suggested member copy |
|---|---|---|---|
| 401 | `INVALID_TOKEN` | bad / expired / consumed / revoked / roster doc missing — **deliberately generic** | "This activation link is no longer valid. Please contact the office for a new one." |
| 409 | `ALREADY_CLAIMED` | already bound (incl. lost race, idempotent rebind, cross-doc uid) | "This account is already set up — please sign in." |
| 400 | `WEAK_PASSWORD` | <12 or >64 chars, missing letter or digit, email-derived, common | show the password rules |
| 400 | `PASSWORD_TOO_LONG` | >64 chars (`metadata.max`) | "Password must be 64 characters or fewer." |
| 403 | `DOB_MISMATCH` | DOB did not match the roster doc | "That date of birth doesn't match our records." |
| 403 | `DOB_UNAVAILABLE` | roster doc has no DOB — staff data gap | "We can't verify your identity right now. Please contact the practice." |
| 429 | `DOB_THROTTLED` | too many attempts (`metadata.retryAfter`, seconds) | "Too many attempts — try again in N minutes." |
| 429 | `DOB_LOCKED` | hard lock, `retryAfter: null` | "Too many attempts. Contact the practice to unlock." |
| 503 | `THROTTLE_UNAVAILABLE` | throttle store unreachable | "Temporarily unavailable, try again shortly." |
| 500 | `ACCOUNT_CREATE_ERROR` | createUser / bind failure — retryable, token not consumed | "Something went wrong, please try again." |
| 500 | `ADOPT_PASSWORD_RESET_FAILED` | bound but password not set — **patient is trapped, needs staff** | "Your account is linked but the password couldn't be set. Please contact support." |
| 500 | `READ_ERROR` / `LOG_WRITE_ERROR` | infra | generic retry |
| 405 | `METHOD_NOT_ALLOWED` | wrong verb | n/a |

The hub must stop collapsing all of these into one string. `DOB_MISMATCH`,
`ALREADY_CLAIMED`, and the two 429s are the ones members actually hit.

## Known sharp edge (unchanged, flagged not fixed)

A **revoked-but-not-expired** link and a genuinely dead link are both
`INVALID_TOKEN` by design (anti-enumeration). The hub cannot distinguish them,
so support cannot tell "I revoked it" from "it expired" without the admin panel.

## Confirmed side effects on success

`status: 'active'`, `firebaseUid` (lowercased, written solely by `bindMember`),
`hydrationStatus: 'complete' | 'failed'`, throttle cleared, token consumed.
With `claim-timestamps.patch` applied, also `claimedAt` and
`webAccessVerifiedAt`. Hydration is **awaited**, so a success response can take
several seconds (timeout budget 180s) — the hub needs a submit spinner and no
client timeout under ~120s.
