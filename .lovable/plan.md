# Where the portal gets a member's email, and how to fix Brian

## Short answer

Hint and Elation are both correct. The portal keeps **its own copies**, and they don't update themselves:

```text
Hint / Elation (updated)  --copied once-->  Portal member record  --copied once-->  Portal login
bweiner@familyofficegp.com                  bweiner@excelgfo.com                   bweiner@excelgfo.com
```

1. **Portal member record.** Created once when the member was added to the portal, using the email on file then. It is only ever created, never overwritten, so later chart changes don't reach it. Invites always go to this email.
2. **Portal login.** Created when Brian activated his account, using the member record's email at the time. His sign-in name stays fixed after that, even if the member record changes later.

So the source of truth is Elation (the patient ID is the key everywhere), but the portal copies the email once and never refreshes it. Anyone who changes their email after activating will hit the same wall.

## Plan

### Step 1: Fix Brian (after you confirm)
- Copy the email from his Elation chart (patient ID 848936747073537) onto his portal member record. It is read from the chart and never typed in by hand.
- Start his login over and send a fresh 30-day activation link to bweiner@familyofficegp.com.
- Confirm the email went out and check it shows as delivered.

### Step 2: Fix it for everyone
- Add a staff action to Prime Care OS called "Refresh email from chart". It works by patient ID only and shows the old and new email before saving.
- If the member already has a login, it also updates their sign-in email, so they aren't locked out and don't lose their account.
- Every change is recorded in the audit trail.
- Later option: a nightly check that flags anyone whose portal email differs from their chart.

## Technical details
- The member record is written only by the provisioning step (create-if-absent). No field-update path exists today. The admin access endpoint only accepts status, modules and hidden items.
- The new portal endpoint (e.g. `adminSyncMemberEmail`) needs the patient ID. It reads the chart email, updates the member record, and if a login exists, updates that login's email via the Firebase Admin SDK. It then writes an audit row. Wire it through the portal admin backend function behind the admin role check.
- Deploying it goes through the portal repo's normal PR and merge (merge = deploy). Step 1 for Brian can be done straight away by someone with portal access, or after that PR ships.
- With a sign-in email update, Brian's existing password would keep working, so the start-over reset becomes optional.
