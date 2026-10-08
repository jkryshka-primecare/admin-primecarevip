# Fix Maria Ducker's portal email

## Answer: which system is the source of truth?
**Elation is the source of truth.** Each patient's Elation chart number is how we match them everywhere. The portal also takes its email from the chart. Hint is the source of truth only for **membership status** (active or not).

## What I found
- **Elation:** mariaducker@gmail.com
- **Hint:** mariaducker@gmail.com. Hint and Elation agree, so there's no mismatch between them.
- **Portal:** mduck602@ail.com. This looks like an old or mistyped address ("ail.com" is missing the "gm"). The portal saved a copy of the email when her portal account was first created, and it never updates by itself. That's the same issue we saw with Brian Weiner.

Her Oct 8 invite went to that bad address, which is why she never got in.

## Fix (staff can do this, no code changes needed)
Her account has never been claimed, so a care team member can fix it on her Portal tab:
1. Pick a reason, for example "Member changed their email".
2. Click **Refresh email from chart**. The confirm box should show mduck602@ail.com changing to mariaducker@gmail.com. Click OK.
3. Click **Resend invite**. The new link goes to mariaducker@gmail.com and the old link stops working.

Once you approve, I'll check her portal record afterward to confirm the email and the new invite went through.

## Optional follow-up
A report that lists every member whose portal email doesn't match their chart, so we can catch these before members get stuck. This only looks; it changes nothing.
