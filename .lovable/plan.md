# Care team: set up portal access for members with no portal account

## What staff will see
When a patient has no portal account, the Portal tab shows a **"Set up portal access & send invite"** button. This is for Clinical, Pharmacy and admins.

1. Staff click the button. The system looks up this chart's name and date of birth and finds the matching active membership.
2. **One match.** A confirm box shows the member's name, date of birth and the email the invite goes to. Staff pick a reason and confirm. The portal account is created and the first invite is sent.
3. **Two or more matches (rare).** Staff are asked to type the member's email.
   - The email must exactly match the email on **this chart**, and also exactly one of the matching memberships.
   - If it does, the account is set up as in step 2. If not, staff see "We couldn't confirm which member this is — please ask an administrator."
   - The email is only used to choose between members who already match on name and birth date. It never finds a member on its own.
4. **No match, inactive membership, or no email on the chart.** Staff see a plain message saying what's missing and to ask an administrator. Nothing is created.

## Safety
- Name, date of birth and email always come from the chart and membership records, not from anything staff type. The only exception is the tie-break email, which must agree with both records.
- This only works when the member has no portal account at all. The server checks this every time.
- The same invite limits apply: one invite per member every 10 minutes, and 5 per staff member per hour. A reason is required, and each step shows in the member's Portal help history.
- No change to admin tools or the Admin menu.

## Technical details
- New `portal-admin` action `careProvision`, care-team tier, for a single member:
  1. Upstream `get` must return `NO_ROSTER_DOC`, or the request is refused.
  2. Fetch the Elation patient by chart ID with the existing Elation credentials: name, date of birth, email.
  3. Search Hint patients by last name and date of birth with the practice key. Narrow to case-insensitive exact first and last name, exact date of birth, and an active `membership_status`.
  4. One candidate means proceed. More than one requires `tieBreakEmail`, which must be lowercase-trimmed equal to the Elation email and to exactly one candidate's Hint email. Otherwise the request is refused with a reason code.
  5. Build the `ProvisionMember` on the server, passing `elationPatientId` explicitly so the roster key is the chart ID. Call upstream provision with `sendInvite:false`, then upstream invite.
  6. Apply the invite rate limit before step 5. Record audit rows for `careProvision` (including candidate count and whether a tie-break was used, but never the typed email) plus the invite. Log to `phi_access_log`.
- A preview mode (`dryRun:true`) returns the match result for the confirm box: name, date of birth, invite email, and whether a tie-break is needed. It writes nothing.
- UI: the no-account note in `PortalAdminPanel` gets the button, the confirm dialog, and an email field that only appears when a tie-break is needed. After success it refreshes the portal record.
- During build I'll check the Hint patient search parameters and the Elation fields. If Hint can't search by name and date of birth on the server, I'll stop and report back rather than switch methods.
- Record in project memory: email is allowed only as a tie-breaker between members who already match on name and birth date, and must agree with the chart.
