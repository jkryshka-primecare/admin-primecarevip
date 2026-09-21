# Fix the silent "Activate account" button + find everyone stuck

## What's actually wrong (confirmed from the live page)

I pulled the live activation page at care.primecarevip.com/claim and read its code. The button is not ignoring clicks — it is **disabled**, and nothing on screen says why.

The button only turns on when all of these are true: date of birth filled in, both password boxes filled, the two passwords match, **and the password passes the rules**. The first four have visible feedback ("Passwords match" in green). The fifth has none. So a member like Holly types a password that is too short, sees green "Passwords match", and gets a button that will not respond — with no explanation anywhere.

Two smaller findings from the same read:

- The "not your email address" rule is printed in the grey helper text but is never actually checked on the page — it is only enforced when the form is submitted, so it can't be the thing blocking Holly.
- The "not a common password" rule is likewise only enforced on submit.

So the only silent blockers are: under 12 characters, over 64, no letter, or no number.

## Important: this page is not in our repo

The live activation page is served by the separate member app (the other front-end team's build), not by the activation page in our main repo — I compared the deployed code against ours and they are different pages with different wording. **We cannot change it from here.** What this plan produces is the exact specification for that team, plus everything we own on our side.

## What to do

### 1. Spec for the member-app team (deliverable: a written spec + issue)

Under the "Create password" box, replace the static grey sentence with a **live checklist** that updates as the member types, each line showing a tick or a cross:

- At least 12 characters
- No more than 64 characters
- Contains a letter
- Contains a number
- Not your email address
- Not a common password

Plus two rules that close the trap for good:

- If the button stays off, the reason must always be visible on screen. No disabled state without a stated cause.
- Add the missing email-address check to the live validation, so the page's own helper text matches what it actually enforces. The wording of the rules must stay exactly as the server enforces them — 12 to 64 characters, at least one letter and one number, not the email address, not a common password. No extra rules, no fewer.

### 2. Answer on the reset question (Phil, Kelly, Holly)

Wiping the account and sending a fresh link is **not** the recommended first move, and in all three cases it made things worse rather than better.

- If the member has **never finished activating** (which is true of everyone affected here), their link is still perfectly good. Deleting anything is unnecessary — and Holly's record now carries a wipe that removed her account while leaving her marked "active", a half-finished state that has caused its own confusion.
- The correct first step is simply: **send a fresh link** (this revokes the old one and issues a new 30-day one). That fixes an expired or already-used link and touches nothing else.
- The destructive wipe should be reserved for one case only: the member genuinely has an account but cannot get into it and cannot reset the password.

Going forward, once the checklist above ships, most of these calls stop being "the link is broken" and become "your password was too short."

### 3. The list you asked for

A one-off report, pulled read-only, of every member currently in one of these states:

- **Half-reset** — a wipe was performed, the account was removed, but the record still reads active (Holly's, Phil's and Kelly's shape). These need cleaning up.
- **Invited, link still live, never activated** — the large group who simply have not finished, and who are the ones hitting the silent button.
- **Invited but no email on file** — they can never receive a link at all.

For each: name, email, date of birth on file, current state, when their link was sent and when it expires, and whether a reset was performed on them and by whom. Delivered as a table here and as a CSV you can work from.

## Technical notes

- Root cause in the deployed bundle: the submit button's enabled condition includes a password-policy predicate, but that predicate's result is never rendered; the only rendered validation state is the password-match line.
- Server policy (the contract, unchanged): 12–64 characters, at least one letter and one number, not in the common-password set, must not contain the email local part. The server deliberately returns one generic `WEAK_PASSWORD` reason for all five failures, which is exactly why the client has to state the rules up front.
- The spec change is client-side presentation only. No change to the password policy, the claim endpoint, tokens, or anything on our side.
- The stuck-member report is a read-only query against the member records through the existing read bridge. No writes, no emails, no links issued.
