# Portal provisioning (Release 2a) — handoff

One new admin-only HTTPS function: **`adminProvisionPatients`**. It creates
portal roster records in bulk for active Hint members who have none — the 254
members the Membership roster in Prime Care OS currently flags as
"Member · no portal record".

## What it does and does not do

- Creates a `patients/{elationPatientId}` doc with `status: 'not_invited'`.
- **Sends nothing.** No email, no claim token. Inviting stays `adminIssueInvite`,
  one patient at a time. The endpoint returns 400 if a caller passes
  `sendInvite: true`.
- **Never overwrites.** Writes use `create()`; an existing record is reported as
  `skipped: ALREADY_EXISTS`. The only write to an existing doc is backfilling a
  missing `hintPatientId`.
- Caps a run at 300 members and requires an `actor` plus a written `reason`.
  Prime Care OS writes one audit row per member on its side; this function
  writes one batch line to `portalAdminAudit` with ids only, no PHI.

## Install

1. Copy `functions/adminProvisionPatients.js` next to the existing `admin*.js`
   handlers.
2. Export it from `functions/index.js`:

   ```js
   exports.adminProvisionPatients = require('./adminProvisionPatients').adminProvisionPatients;
   ```

3. Grant the existing caller service account invoke rights on it:

   ```bash
   gcloud functions add-iam-policy-binding adminProvisionPatients \
     --region=us-central1 --project=prive-care-vip \
     --member="serviceAccount:portal-admin@prive-care-vip.iam.gserviceaccount.com" \
     --role="roles/cloudfunctions.invoker"
   ```

4. Deploy: `firebase deploy --only functions:adminProvisionPatients`

## The one open dependency: Elation resolution

A roster doc id **is** the Elation patient id, and Hint carries no Elation id.
The function optionally requires:

```
functions/core/services/elation/resolvePatient.js
  → module.exports = { resolvePatient }   // ({firstName,lastName,dob,email}) => {id, confident}
```

Rules that resolver must follow:

- `confident: true` only for a **single** chart matching last name + date of
  birth (email may narrow further). Two candidates means `confident: false`.
- Never fuzzy-match on email alone — families in this practice share one.

Until it exists, the function still runs and returns every member as
`unresolved: ELATION_RESOLVER_UNAVAILABLE` — nothing is written. If Prime Care
OS supplies `elationPatientId` per member, those are provisioned directly and
the resolver is not consulted.

## Dry run first

Run one batch of 5 with a reason like `2a dry run`, confirm the 5 docs, then
run the remainder in batches of 300.
