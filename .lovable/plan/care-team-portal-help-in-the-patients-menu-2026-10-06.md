# Care team portal help in the Patients menu

## Goal
Let Clinical and Pharmacy staff fix the most common member sign-in problems from a patient's page, without touching the Admin menu. Everything stays tied to the patient's chart ID. Nothing is matched by email.

## What exists today
- Patients → open a patient → **Portal** tab already shows the member's portal record.
- Anyone on staff can view it. Every action (invite, update email, revoke, reset) is Admin or Super Admin only, so the care team sees buttons they can't use.

## What the care team gets

1. **Send / resend portal invite**
   - The button sits on the Portal tab and in the patient list row menu.
   - A confirmation shows the exact email the invite will go to, pulled from the saved portal record.
   - It requires a short reason, picked from a list such as "Member never got it", "Link expired" or "Other".
   - Limits: one invite per member every 10 minutes, and 5 per staff member per hour. This stops repeated sends from knocking out a member's link, like what happened with Ivan.
   - If sending fails, the message says so in plain words, says the old link no longer works, and suggests telling an admin.

2. **Fix an out-of-date email**
   - When the chart email and the portal email don't match, a warning appears, as in Brian Weiner's case.
   - One button copies the chart email into the portal record, and you must pick a reason. A new invite can follow right after.

3. **"Why can't they log in?" checklist**
   - This plain-language panel goes at the top of the Portal tab. It covers:
     - Is there an active membership?
     - Has the account been claimed?
     - When was the last invite sent, and has the link expired?
     - Does the email match the chart?
     - Is a duplicate chart suspected (same name and date of birth)?
   - Each item shows a green check or a next-step hint.

4. **Portal help history**
   - A short timeline on the Portal tab shows who sent invites or changed emails, when, and why.
   - It reads from the activity log that is already being recorded.

## Stays Admin / Super Admin only (unchanged)
Removing portal access, resetting a login, linking guardians, bulk and backfill tools, and everything in the Admin menu.

## Who gets the new care team actions
Clinical and Pharmacy, plus Admin and Super Admin as today. HR, Billing and Staff won't see them.

## Technical details
- `portal-admin` function: add a "care team" tier (`super_admin`, `admin`, `clinical`, `pharmacy`) for the `invite` and `syncEmail` actions only. All other mutations keep the current admin and super-admin checks. Reason stays required, and every action is still written to `portal_admin_actions` and `phi_access_log`.
- Rate limits run on the server using `portal_admin_actions`, counting by patient ID and by actor within a time window. If the limit is hit, the function returns 429 with a friendly message.
- The checklist uses the existing `get` response plus Hint membership and the chart email. Duplicate detection is a name + date-of-birth lookup in Elation, shown as a warning only.
- UI: `PortalAdminPanel.tsx` shows the invite and email-sync buttons based on the user's role, and adds the checklist and history components. The patient list row menu gets "Send portal invite". All of this goes through `invokeAuthed`.
- No database schema changes are expected, and no changes to the Admin menu.
