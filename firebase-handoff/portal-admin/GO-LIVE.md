# Go-live runbook — portal control plane

The member portal at care.primecarevip.com keeps running throughout. This is
not a cutover: no member-facing URL, app, or design changes. The only new
behaviour a member can ever notice is a deliberate staff action (a section
marked unavailable, an item hidden, or an account paused).

Everything on the Prime Care OS side is already built and deployed:
the `portal-admin` edge function, the `usePortalAdmin` hook, the **Portal** tab
in each patient's sheet, and the `portal_admin_actions` audit table. Until the
service account key exists, the tab reports "not configured" and takes no action.

The four steps below all happen in the Firebase repo / Google Cloud console.

---

## 1. Deploy the four admin functions

Copy from `firebase-handoff/portal-admin/functions/` into the Firebase repo:

```
functions/adminIssueInvite.js
functions/adminRevokeInvite.js
functions/adminSetPortalAccess.js
functions/adminGetPortalAccess.js
functions/core/services/patient/portalAccess.js
functions/middleware/requireAdminCaller.js
```

Export them from `functions/index.js` (see `README.md`), then:

```bash
firebase deploy --only functions:adminIssueInvite,functions:adminRevokeInvite,functions:adminSetPortalAccess,functions:adminGetPortalAccess
```

These are new endpoints. They are not on any member-facing code path and
cannot affect the live portal.

**Done when:** all four functions appear in the Cloud Functions list and an
unauthenticated `curl` to each returns 401/403 rather than 404.

---

## 2. Apply the enforcement patches

Follow `ENFORCEMENT.md` for `getLabs`, `getImaging`, `getMedications`,
`getLetters`, `getMedicalRecords`, `getAppointments`, `getProblems`,
`getAllergies`, and `getMyPatientRecord`.

This is the only step that touches live member reads. Two invariants make it
safe:

- **Fail open on visibility** — a Firestore error never blanks a real chart.
- **Fail closed on suspension** — a suspended account gets nothing.

With no `portalAccess` doc written for anyone, behaviour is identical to today.

**Done when:** a test member signs into the live portal and every section
loads exactly as before the deploy.

---

## 3. Create the caller identity

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

Download a JSON key and paste it into Prime Care OS as the secret
`PORTAL_ADMIN_SERVICE_ACCOUNT`. The key is used only to mint a Google identity
token server-side; it never reaches a browser.

Also add the caller's service-account email to `ALLOWED_CALLERS` in
`requireAdminCaller.js` if it is not already there.

**Done when:** the Portal tab stops saying "not configured" and shows real
state for a patient.

---

## 4. Prove it on one test member

Run these in order on a single non-production-critical member, checking the
live portal after each:

| Step | Action in Prime Care OS | Expected on care.primecarevip.com |
| --- | --- | --- |
| 4a | Open Portal tab | Correct invite/claim state, no error |
| 4b | Send invite | Same SendGrid email as the CLI script sent |
| 4c | Toggle Labs off | Labs section reads "unavailable", not "no results" |
| 4d | Toggle Labs back on | Labs render exactly as before |
| 4e | Hide one lab item | That item gone; the rest unchanged |
| 4f | Unhide it | Item returns |
| 4g | Suspend | Portal returns the paused-access message |
| 4h | Restore | Normal access resumes |

Then confirm every one of those eight actions has a row in
`portal_admin_actions` with the acting staff email and the reason text.

**Do not send bulk invite waves until 4a–4h all pass.**

---

## Rollback

Each step reverses on its own, with no data to unwind:

- **Enforcement misbehaving** → redeploy the previous functions build. Access
  docs stay in Firestore and are simply ignored again.
- **Control plane misbehaving** → delete the `PORTAL_ADMIN_SERVICE_ACCOUNT`
  secret in Prime Care OS. The Portal tab returns to "not configured"
  immediately; nothing else in the app is affected.
- **Harder stop** → remove the invoker IAM bindings. The four functions then
  reject every call regardless of what this app does.

---

## Not part of this go-live

- The My Health Hub portal rebuild. Members see it only on the day
  `care.primecarevip.com` is repointed, after a parity review and your sign-off.
- Any write to Elation. Demographics remain view-and-flag only.
- Bulk invite waves. Single invites must be proven first.

### Two audit trails, two names

Both exist by design and both must show the action:

- **`portalAdminAudit`** (Firestore, written by the Cloud Functions) — the
  portal-side record of what was actually mutated.
- **`portal_admin_actions`** (Prime Care OS database, written by the
  `portal-admin` edge function) — the staff-side record of who clicked what and
  why, tied to a verified staff session.

When verifying go-live, check both. A row in one and not the other means the
call failed partway and should be investigated.
