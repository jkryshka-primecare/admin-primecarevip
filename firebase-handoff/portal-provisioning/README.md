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
2. Export it from `functions/index.js` **inside** the existing
   `module.exports = { … }` object, alongside the four Step 1 admin
   functions. A trailing `exports.adminProvisionPatients = …` appended after
   `module.exports = { … }` exports nothing:

   ```js
   module.exports = {
     // …existing Step 1 admin functions…
     adminProvisionPatients: require('./adminProvisionPatients').adminProvisionPatients,
   };
   ```

3. Grant the existing caller service account invoke rights on it (human step):

   ```bash
   gcloud functions add-iam-policy-binding adminProvisionPatients \
     --region=us-central1 --project=prive-care-vip \
     --member="serviceAccount:portal-admin@prive-care-vip.iam.gserviceaccount.com" \
     --role="roles/cloudfunctions.invoker"
   ```

4. Deploy via **PR → merge → CI**, not `firebase deploy --only …`.
   Like the other IAM-restricted admin functions, leave
   `adminProvisionPatients` **out of both** `FUNCTIONS=( … )` arrays
   (snapshot + health gate) — the gate's unauthenticated curl would 403.

5. Secrets: the resolver reads `ELATION_CLIENT_ID`, `ELATION_CLIENT_SECRET`,
   `ELATION_API_USERNAME`, `ELATION_API_PASSWORD` from Secret Manager at runtime.
   Confirm all four exist and that the functions runtime SA holds
   `secretmanager.secretAccessor` on each. If a grant is missing it fails
   safe: every member comes back unresolved with `ELATION_CREDENTIALS_MISSING`.


## The one open dependency: Elation resolution

A roster doc id **is** the Elation patient id, and Hint carries no Elation id.
The function optionally requires:

```
functions/core/services/elation/resolvePatient.js
  → module.exports = { resolvePatient }   // ({firstName,lastName,dob,email}) => {id, confident}
```

Rules that resolver must follow:

- `confident: true` only for a **single** chart matching first name + last name
  + date of birth (email may narrow further). Two candidates means
  `confident: false`.
- Never fuzzy-match on email alone — families in this practice share one.

Until it exists, the function still runs and returns every member as
`unresolved: ELATION_RESOLVER_UNAVAILABLE` — nothing is written. If Prime Care
OS supplies `elationPatientId` per member, those are provisioned directly and
the resolver is not consulted.

## Dry run first

Run one batch of 5 with a reason like `2a dry run`, confirm the 5 docs, then
run the remainder in batches of 300.

## The resolver, drafted

`functions/core/services/elation/resolvePatient.js` is now included in this
handoff — copy it to the same path in the Firebase repo and the open dependency
above is closed. No wiring is needed; `adminProvisionPatients` picks it up via
`require` and falls back to `unresolved` if the file is absent.

It exports both names so either import style works:

```js
const { resolvePatient, resolveElationPatient } = require('./core/services/elation/resolvePatient');
```

**Behaviour**

- `GET /patients/?last_name=&dob=` only. Read-only; it never writes to Elation.
- Every result is re-verified locally on first name + last name + DOB — the API
  filter is not trusted on its own, and a last name + DOB hit alone is never
  accepted (that is how a twin or same-DOB sibling would land on the wrong
  chart). Identical first+last+DOB on two charts is `AMBIGUOUS_MATCH`.
- Email may only narrow an already-matched set. It never matches alone
  (families share one) and never widens the set.
- Returns `{ id, confident, reason, candidates }`. `confident: true` only for a
  single surviving chart. `NO_MATCH`, `AMBIGUOUS_MATCH`, `ELATION_AUTH_FAILED`
  and `ELATION_LOOKUP_FAILED` all return `confident: false`, which the caller
  reports as `unresolved` — nothing is written.
- Deleted charts (`deleted_date`) are excluded.

**Credentials** — Secret Manager secrets in `prive-care-vip`, falling back to
`process.env` under the emulator:

```
ELATION_CLIENT_ID   ELATION_CLIENT_SECRET   ELATION_API_USERNAME   ELATION_API_PASSWORD
ELATION_BASE_URL    # optional, defaults to https://app.elationemr.com/api/2.0
```

Grant the function's runtime service account `roles/secretmanager.secretAccessor`
on those four secrets. One OAuth token is minted per batch and cached (refreshed
a minute early, re-minted once on a 401), so a 300-member run is one auth call.

**Sanity check before the dry run** — confirm a known member resolves and a
known family email does not over-match:

```bash
node -e "require('./core/services/elation/resolvePatient').resolvePatient({firstName:'Jane',lastName:'Doe',dob:'1980-04-02',email:'jane@example.com'}).then(console.log)"
```

Expect `AMBIGUOUS_MATCH` (not a guess) for any parent/child pair sharing a name
prefix, and `SINGLE_MATCH` for a distinct adult.
