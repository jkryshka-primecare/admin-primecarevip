# Portal admin Cloud Functions — handoff

Ready-to-commit source for the four admin-only HTTPS functions that let
**Prime Care OS** control the patient portal. Prime Care OS has read-only
access to `primecarevip/prime-care-vip-app-v2`, so these files are authored
here and committed/deployed on your side.

## Install

1. Copy the files into the Firebase repo:

   ```
   functions/adminIssueInvite.js
   functions/adminRevokeInvite.js
   functions/adminSetPortalAccess.js
   functions/adminGetPortalAccess.js
   functions/core/services/patient/portalAccess.js
   functions/middleware/requireAdminCaller.js
   ```

   (`portalAccess.js` and `requireAdminCaller.js` live in the subfolders shown;
   the four `admin*.js` files sit next to the existing `get*.js` handlers.)

2. Export them from `functions/index.js`, next to the existing exports:

   ```js
   exports.adminIssueInvite     = require('./adminIssueInvite').adminIssueInvite;
   exports.adminRevokeInvite    = require('./adminRevokeInvite').adminRevokeInvite;
   exports.adminSetPortalAccess = require('./adminSetPortalAccess').adminSetPortalAccess;
   exports.adminGetPortalAccess = require('./adminGetPortalAccess').adminGetPortalAccess;
   ```

3. Create the caller service account and grant it invoke rights **only** on
   these four functions:

   ```bash
   gcloud iam service-accounts create portal-admin \
     --display-name="Prime Care OS portal admin" --project=prive-care-vip

   for FN in adminIssueInvite adminRevokeInvite adminSetPortalAccess adminGetPortalAccess; do
     gcloud functions add-iam-policy-binding "$FN" \
       --region=us-central1 --project=prive-care-vip \
       --member="serviceAccount:portal-admin@prive-care-vip.iam.gserviceaccount.com" \
       --role="roles/cloudfunctions.invoker"
   done
   ```

   Also grant it `roles/datastore.user` (Firestore read/write) if the functions
   run as the default runtime SA and you prefer this SA as the runtime identity.

4. Download a JSON key for `portal-admin@prive-care-vip` and paste it into
   Prime Care OS as the secret `PORTAL_ADMIN_SERVICE_ACCOUNT`. It is used only
   to mint a Google **identity token**; it never reaches a browser.

5. Deploy:

   ```bash
   firebase deploy --only functions:adminIssueInvite,functions:adminRevokeInvite,functions:adminSetPortalAccess,functions:adminGetPortalAccess
   ```

## Authentication model

These functions are **not** patient-facing and accept no Firebase patient
token. Every request must carry:

```
Authorization: Bearer <Google OIDC identity token>
```

signed for the function's own URL as audience by
`portal-admin@prive-care-vip`. `requireAdminCaller` verifies the token against
Google's public keys, checks `aud` and `email_verified`, and rejects any
caller whose email is not in `ALLOWED_CALLERS`. Cloud Functions IAM is the
outer gate; this check is the inner one.

The acting human staff member is passed in the body as `actor` (email) and is
recorded on every write — the service account identifies the *system*, `actor`
identifies the *person*. Prime Care OS derives `actor` from the signed-in
session server-side; it is never client-supplied.

## Endpoints

| Function | Method | Body | Effect |
| --- | --- | --- | --- |
| `adminGetPortalAccess` | POST | `{ elationPatientId }` | Returns portal state: claim/invite status, access doc, roster summary. Read-only. |
| `adminIssueInvite` | POST | `{ elationPatientId, actor, reason?, reissue?, toOverride? }` | Mints a claim token and sends the invite email. |
| `adminRevokeInvite` | POST | `{ elationPatientId, actor, reason }` | Marks every live claim token for the patient as spent. |
| `adminSetPortalAccess` | POST | `{ elationPatientId, actor, reason, patch }` | Merges into `portalAccess/{id}`. |

All responses use the repo's existing error envelope:

```json
{ "error": { "code": 403, "status": "PERMISSION_DENIED",
             "message": "...", "details": { "reason": "..." } } }
```

## Data written

- `claimTokens/{sha256(rawToken)}` — via the existing `issueClaimToken`; raw
  token is never persisted or logged.
- `portalAccess/{elationPatientId}` — see `portalAccess.js` for the shape.
- `portalAdminAudit/{auto}` — one no-PHI line per mutating call.

Nothing else. There is no code path in these files that writes to `patients`,
Elation, or Hint.

## Still to apply: enforcement

Visibility is only real once the read endpoints honour it. See
`ENFORCEMENT.md` for the change to `getLabs`, `getImaging`, `getMedications`,
`getLetters`, `getMedicalRecords`, `getAppointments`, `getProblems`,
`getAllergies`, and `getMyPatientRecord`.
