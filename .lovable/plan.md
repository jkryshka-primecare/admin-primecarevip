# Care team: help members who have never had portal access

## Recommendation
Your rule is sound: the care team helps only members who have **never** signed in to the portal. A member who has ever had working access can't be affected by staff. Only an admin can touch them, exactly as today.

## Who counts as "never had access"
The server checks this on every request. A button being hidden on screen isn't enough.
- Never had access means:
  - the member has no portal account yet, **or**
  - they have an account but have never claimed it or signed in.
- Already has or had access means:
  - the account was claimed, **or**
  - the member has ever completed a portal sign-in.

  These members are off-limits to the care team. Staff see "This member already has portal access — ask an administrator."

## What the care team can do

**1. Member has no portal account yet** (the note you're seeing now)
- A new button reads "Set up portal access & send invite".
- Their details (name, date of birth and email) come from the member's chart and membership record, not from anything staff type. A confirm box shows the email the invite will go to.
- It only works for members with an active membership. If there's no email on the chart, staff are told to update the chart first.
- It creates the account and sends the first invite in one step.

**2. Member has an account but never used it** (invite unopened or expired)
- Send or resend an invite. This only replaces a link the member never used, so nobody loses working access.

**3. Safety limits (already in place for invites)**
- Each member can get at most one invite every 10 minutes.
- Each staff member can send at most 5 invites an hour.
- A written reason is required, and every action shows in the member's Portal help history.

## What changes from today
- Today the care team can resend an invite to anyone. After this change, they can only do that for members who have never had access.
- Removing a member's access, resetting a login, and anything for members who have had access stays admin only. Nothing in the Admin menu changes.

## Technical details
- `portal-admin`: for care-team callers (anyone who isn't an admin) on `invite`, first run the upstream `get`. Refuse with 403 if the claim state is `claimed` or `webAccessVerifiedAt` is set. If the `get` fails, refuse rather than allow.
- New action `careProvision`, available to the care team, for a single member only:
  - The server checks that no portal record exists yet.
  - It looks up the Hint patient by Elation chart ID, using the existing chart link and never matching by email, and requires an active membership.
  - It builds the provision payload on the server from Hint and Elation data.
  - It calls the existing provision upstream with `sendInvite:false`, then the standard invite. Both steps are audited to `portal_admin_actions`, with the invite rate limits applied.
  - If any part is unclear, it refuses with a message to escalate to an admin: no Hint link, more than one match, inactive membership, or no email.
- UI: the "no portal account" note in `PortalAdminPanel` gains the set-up button for the care team. The invite button is disabled with an explanation when the member has had access. The checklist shows an "Already has access" state.
- I'll check exactly what the existing provision step needs before building `careProvision`, and change the approach if it can't build the account from chart data alone.
