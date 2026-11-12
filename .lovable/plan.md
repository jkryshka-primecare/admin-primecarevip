# Fix the missing logo in the portal invite email

## What's wrong
This isn't a setting you can switch on. The invite email loads the logo from a web address on the patient portal site:

`https://care.primecarevip.com/email/prime-care-vip-email-logo-color.png`

That address shows "page not found" right now. No logo file is published there, so Gmail shows a broken image with the "Prime Care VIP" label. The email itself is fine.

## Fix options (choose one)

**Option A — Put the logo on the patient portal site (recommended, no email change)**
- In the My Health Hub project, add the color logo PNG (about 440px wide, see-through or white background) at `public/email/prime-care-vip-email-logo-color.png`, then publish.
- The existing email will start showing the logo, including in invites already sent, because email apps load the image each time it's opened.
- I'll write a copy-paste brief for the Hub project's agent and include the logo file it needs.

**Option B — Point the email at a logo that already works**
- A Prime Care VIP logo is already public at our admin backend's email-assets address, and it loads correctly. It's a JPG on a white background.
- To switch, change one image address in the portal's invite sender (`sendInviteEmail.js` and the copy in `adminIssueInvite.js`), then redeploy the portal functions. That's a portal-repo change. I'll prepare it as a review-only patch, the same way earlier portal changes were handed off.

## Check
- Confirm the logo address loads an image in the browser.
- Reopen the test invite at info@primecarevip.com and confirm the logo appears.
- Don't send any real-patient invites for this check.

## Technical details
- Current image address: `care.primecarevip.com/email/prime-care-vip-email-logo-color.png` returns 404 (text/html).
- Working alternative: Supabase public bucket `email-assets/primecare-logo.jpg` returns 200 image/jpeg.
- Nothing in this admin app changes for either option.
