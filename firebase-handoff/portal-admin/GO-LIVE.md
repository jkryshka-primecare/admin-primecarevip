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

## Appending an id to `ELATION_READ_ALLOWLIST_PRODUCTION`

The secret is masked everywhere in GitHub, so never reconstruct it by hand.
Ground truth is the env file on the deployed function.

1. Read the deployed value and snapshot it to **`~/allow-deployed.txt`**
   (not `/tmp` — Cloud Shell wipes `/tmp` between sessions, and this file is
   the rollback artifact).
2. Dup-check the id against that snapshot; stop if already present.
3. Build the new value with `printf '%s'` (no trailing newline) as
   `<old>,<new-id>`, and confirm the last character is the id's last digit.
4. Set it with `gh secret set ELATION_READ_ALLOWLIST_PRODUCTION < file`.
   `gh` must be authenticated in Cloud Shell with secret-write scope
   (`gh auth login` first). The web UI works but risks a stray newline.
5. **Redeploy by re-running the last "Deploy to Production" run from the
   Actions tab — not an empty commit.** `main` is branch-protected with
   no-bypass, so any direct push is rejected. A re-run re-reads secrets at
   execution time and rewrites `functions/.env.prive-care-vip`.

### Verification after the redeploy (content-based, not CI-green)

- `sorted diff` of old vs new deployed allowlist: exactly one `>` line, the new
  id, and N → N+1. A count alone can mask a swapped id; the diff is the proof.
- Repeat the diff against a **different** function (e.g. `claimAccount`) and
  confirm its `updateTime` advanced — the D-071 silent no-op trap.
- Re-run the `get-iam-policy` loop over the four `admin*` functions and confirm
  each lists only `portal-admin`. Firebase adds `allUsers` on create, not
  update, so it should stay stripped — but verify, don't assume.

## Smoke-test fixtures (rows 1–10)

Two members are needed, because a claimed account cannot be re-invited
(`adminIssueInvite` returns 409 `ALREADY_CLAIMED` whenever `firebaseUid` is set)
and an unclaimed one cannot exercise the module/visibility rows.

| Fixture | State | Rows |
| --- | --- | --- |
| Test Kieffer — `816455979040769` | claimed (`firebaseUid` present) | 1, 4–10 (module off/on, hide/unhide, suspend/restore) |
| Second test member — id TBD | genuinely unclaimed, no `firebaseUid` | 2–3 (invite → email → claim) |

Do **not** reset the claimed fixture by clearing `firebaseUid`/`boundAt`/
`webAccessVerifiedAt` and deleting the Auth user. That is a destructive write to
production Firestore and Firebase Auth, it destroys the only claimed fixture,
and it leaves rows 2–3 unrepeatable. Use a second member instead.

Before rows 2–3 the new member's Elation id must be appended to
`ELATION_READ_ALLOWLIST_PRODUCTION` using the procedure above (production is in
allowlist mode, not full sync), and its roster doc must carry a deliverable
`email` — the invite is sent to `patients/<id>.email`, not to anything typed in
the admin panel.
