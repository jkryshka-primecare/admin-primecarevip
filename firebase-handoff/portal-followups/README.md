# Step 1 sign-off follow-ups — Firebase-side patches

Two patches against `primecarevip/prime-care-vip-app-v2` @ `7af4a84`. The sandbox
cannot push, so each goes through the normal branch → PR → review → CI path.
They are independent and can ship as one PR or two.

Apply with:

```bash
git checkout -b fix/portal-step1-followups
git apply firebase-handoff/portal-followups/<patch>
```

## 1. `activate-form-autofill-and-revoked-link.patch` (follow-up #2 and #4)

`artifacts/web-member/src/auth/ClaimAccount.jsx` — display-only, no backend change.

- **Autofill fix.** Browser/password-manager autofill populated the DOB and
  password fields without firing React's change event, so `canSubmit` stayed
  false and **Activate account** was permanently disabled. The form now keeps
  refs on all three inputs and pulls their DOM values into state on mount (a
  short 0/120/350/800/1500 ms poll, since autofill can land after mount), on
  window focus, and on `input` / `blur` / `animationstart`. `handleActivate`
  re-reads the DOM immediately before submitting and validates those values, so
  validation can never disagree with what the patient sees on screen.
- **Revoked / dead link UX.** A revoked, expired, or used token returns the
  generic `INVALID_TOKEN` reason (anti-enumeration — unchanged). Instead of
  leaving the patient on a form with a silently disabled button, the form is
  now replaced by an explicit notice: "This invitation is no longer valid — it
  may have expired, already been used, or been withdrawn. Please contact the
  practice for a new invitation." `ALREADY_CLAIMED` gets its own "already set
  up, please sign in" copy. No new information is disclosed pre-submit.

## 2. `claim-timestamps.patch` (follow-up #5)

`functions/claimAccount.js` — the lifecycle write at step 9b now also stamps
`claimedAt` and `webAccessVerifiedAt` alongside `status: 'active'`. That block
only runs after a genuinely-new bind (an idempotent rebind returns 409 earlier),
so the plain merge preserves write-once semantics per claim. `boundAt` stays
owned by `bindMember`.

## Not in these patches

- Follow-up #1 (member-UI module-off / suspended states) is the already-reviewed
  `firebase-handoff/portal-member-ui/module-off-suspended-states.patch`.
- Follow-up #3 (reject unknown patch keys + atomic hide/unhide) is staged in
  `firebase-handoff/portal-admin/functions/`.
- Follow-up #6 (live-replay of the row-7 no-leak) needs no code.

## Teardown script re-pin (sign-off "Teardown / housekeeping")

`firebase-handoff/portal-admin/scripts/reset-test-fixture.js` now pins the
current claim (`d8h7h6xc6axkq3k3tgnoz6ytxmx1`, `info@primecarevip.com`) and keeps
the pre-smoke-test uid/email in `ACCEPTED_UIDS` / `ACCEPTED_EMAILS`, so it cleans
the fixture in either generation. It still refuses to touch anything outside
`patients/816455979040769` and those allowlists, and remains dry-run without
`--apply`.
