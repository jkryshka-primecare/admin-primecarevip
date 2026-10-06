# Make team invite buttons always open the real login page

## What's happening now
The "Accept invitation" button goes to the address of whatever screen the admin was on when they clicked Send. If the invite was sent from inside the Lovable editor preview, the link points to the private preview address. That address asks the person to sign in to Lovable and request permission, which is what Shayna saw. The domain being down was not the cause.

## Change
- Team invite links will always use `https://admin.primecarevip.com/auth?invite=...`, no matter where the invite was sent from. This covers new invites, resent invites and the "copy link" option.
- After the change, resend Shayna's invite from Administration → Users & Invitations. Her new email will open the real sign-in page, with her email already filled in.

## Technical details
- `supabase/functions/admin-invite-user/index.ts`: stop using the request `origin` header. Use `PUBLIC_APP_URL` if it is set, otherwise the fixed `https://admin.primecarevip.com`. Then redeploy the function.
- Check that `admin.primecarevip.com` is live again. The domain currently shows "drifted", so we'll confirm it serves the app before you resend.
