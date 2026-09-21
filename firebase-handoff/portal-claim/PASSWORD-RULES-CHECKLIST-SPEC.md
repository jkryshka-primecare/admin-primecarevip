# Activation page — live password-requirements checklist

Owner: member-app front end (the build serving `care.primecarevip.com/claim`).
Not in this repo — this file is the specification, not the change.

## The bug

On the deployed claim page the submit button's enabled condition is:

```
enabled = /^\d{4}-\d{2}-\d{2}$/.test(dob)
       && password.length > 0
       && confirm.length > 0
       && password === confirm
       && passwordPassesPolicy(password)   // <-- never rendered
```

Four of those five conditions have visible feedback; the fifth has none. A member
who types an 11-character password sees the green "Passwords match" line and a
button that does not respond, with nothing on screen explaining why. Three
members have called the office about this; at least three more were given a
destructive account reset for what was almost certainly this.

Two secondary defects in the same component:

- The static helper text advertises "not your email address" and "not a common
  password", but the policy predicate is invoked as `E(password)` with the email
  argument omitted, so the email rule is never applied client-side. It fires
  server-side as a generic `WEAK_PASSWORD`.
- There is no common-password check client-side at all; same generic
  server-side failure.

## Required change

Replace the static grey helper sentence under **Create password** with a live
checklist that re-evaluates on every keystroke. Each row renders a pass/fail
indicator plus the rule text:

| Rule | Predicate |
|---|---|
| At least 12 characters | `pw.length >= 12` |
| No more than 64 characters | `pw.length <= 64` |
| Contains a letter | `/[A-Za-z]/.test(pw)` |
| Contains a number | `/[0-9]/.test(pw)` |
| Not your email address | email local part (lowercased, length >= 3) not contained in `pw.toLowerCase()` |
| Not a common password | `pw.toLowerCase()` not in the common-password set |

Rules:

1. **No silent disabled state.** If the submit button is disabled, the reason must
   be visible on screen. The checklist satisfies this for password failures; the
   DOB field needs the same treatment if it can block submission.
2. **Pass the email into the policy check.** The claim page knows the invited
   address; wire it into the predicate so the advertised rule is actually the
   enforced rule.
3. **Match the server exactly — no stricter, no looser.** No uppercase, symbol or
   mixed-case requirement may be added or advertised. `PW_MIN = 12`,
   `PW_MAX = 64`.
4. Checklist rows should be `aria-live="polite"` so screen readers announce state
   changes, and must not echo the password itself anywhere.
5. Presentation only. No change to the claim endpoint, the token, the DOB check
   or the password policy.

## Server contract (unchanged — INTEGRATION-CONTRACT v1.57, D-315)

`claimAccount` → `validatePassword` enforces, in order:

1. non-string → `WEAK_PASSWORD`
2. `length > 64` → `400 PASSWORD_TOO_LONG`, `details.metadata.max = 64`
3. `length < 12` → `400 WEAK_PASSWORD`, `details.metadata = { min: 12, max: 64 }`
4. must contain `[A-Za-z]` and `[0-9]` → else `WEAK_PASSWORD`
5. must not be in `COMMON_PASSWORDS` (lowercased compare)
6. must not contain the email local part (lowercased, when >= 3 chars)

`WEAK_PASSWORD` is deliberately generic — one reason for five distinct failures,
for anti-enumeration. That is precisely why the client must state the rules up
front and evaluate them live.

## Acceptance

- Typing an 11-character password shows "At least 12 characters" failing, and
  the button stays disabled with that reason on screen.
- Typing the member's own email address as the password shows the email rule
  failing before submission, not after.
- A 12-character password with a letter and a number passes every row and the
  button enables.
- No new rule appears that the server does not enforce.
