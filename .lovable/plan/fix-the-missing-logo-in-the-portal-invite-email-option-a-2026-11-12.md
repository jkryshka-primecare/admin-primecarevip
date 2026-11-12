# Fix the missing logo in the portal invite email (Option A)

## What's wrong
The invite email loads its logo from `https://care.primecarevip.com/email/prime-care-vip-email-logo-color.png`. That address shows "page not found" right now, so Gmail shows a broken image instead. The email itself doesn't change.

## What I'll do
1. Make an email-ready color logo PNG, about 440px wide (it displays at 220px), with a see-through background. I'll start from the brand logo already in this admin app.
2. Write a copy-paste brief for the My Health Hub project's agent:
   - add the file at `public/email/prime-care-vip-email-logo-color.png`
   - publish
   - confirm the address loads the image
3. Save the logo file and the brief in your Files so you can hand both to the Hub project. Changes made from here can't publish the Hub site.

## After the Hub publishes
- The logo address loads an image in the browser.
- Reopen the test invite at info@primecarevip.com. The logo appears, including in invites already sent.
- Send no real-patient invites.

## Technical details
- The current address returns 404 (text/html). The portal sender code stays the same.
- Nothing in this admin app changes.
