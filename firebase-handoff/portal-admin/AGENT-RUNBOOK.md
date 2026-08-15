# Browser-agent runbook — portal control plane go-live

Written for an autonomous browser agent (Claude Chrome extension) operating a
signed-in Google account with Owner/Editor on the Firebase project
**`prive-care-vip`**, plus write access to the GitHub repo
**`primecarevip/prive-care-vip-app-v2`** (the repo holding `functions/`).

Everything below happens in the browser. Where a shell is needed, use
**Google Cloud Shell** (in-browser terminal) — do not require a local CLI.

---

## Constants (use verbatim)

| Name | Value |
| --- | --- |
| GCP / Firebase project id | `prive-care-vip` |
| Functions region | `us-central1` |
| Service account id | `portal-admin` |
| Service account email | `portal-admin@prive-care-vip.iam.gserviceaccount.com` |
| Functions to deploy | `adminIssueInvite`, `adminRevokeInvite`, `adminSetPortalAccess`, `adminGetPortalAccess` |
| Source of the new files | `firebase-handoff/portal-admin/functions/` in the Prime Care OS repo |

## Hard rules for the agent

1. **Never delete, rename, or redeploy an existing function** other than the
   enforcement edits in Step 2, which are additive guard clauses only.
2. **Never touch Firestore data.** No document creates, edits, or deletes in
   the console. The functions write their own docs at runtime.
3. **Never touch Firebase Auth users**, billing, or existing service accounts.
4. **Never paste a service-account private key into a chat, a doc, a commit,
   or any page other than the Prime Care OS secret form.**
5. If a command errors, **stop and report the exact error text**. Do not
   improvise alternate commands, do not add IAM roles beyond those listed, and
   do not grant project-level `roles/cloudfunctions.invoker`.
6. Deploy only during a low-traffic window and only after Step 0 passes.

---

## Step 0 — Pre-flight (5 min, no changes)

1. Open <https://console.cloud.google.com/home/dashboard?project=prive-care-vip>.
   Confirm the project selector reads **prive-care-vip**. If it reads anything
   else, stop.
2. Open <https://console.cloud.google.com/functions/list?project=prive-care-vip>.
   Record the current list of function names and their **"Last deployed"**
   timestamps into a note. This is the rollback reference.
3. Confirm none of the four `admin*` names already exist. If any exists,
   stop and report — it means a partial run already happened.
4. Open <https://console.cloud.google.com/security/secret-manager?project=prive-care-vip>
   and confirm a secret named **`SENDGRID_API_KEY`** exists. `adminIssueInvite`
   reads it at runtime; without it, invite sending fails.

**Done when:** all four checks pass and the function inventory is recorded.

---

## Step 1 — Deploy the four admin functions

### 1a. Get the files into the repo

The six new files live in the Prime Care OS repo under
`firebase-handoff/portal-admin/functions/`. Copy them into the Firebase repo at
these exact paths:

```
functions/adminIssueInvite.js
functions/adminRevokeInvite.js
functions/adminSetPortalAccess.js
functions/adminGetPortalAccess.js
functions/core/services/patient/portalAccess.js
functions/middleware/requireAdminCaller.js
```

Do it in Cloud Shell (open <https://shell.cloud.google.com/?project=prive-care-vip>):

```bash
cd ~ && rm -rf pcv-deploy && mkdir pcv-deploy && cd pcv-deploy
git clone https://github.com/primecarevip/prive-care-vip-app-v2.git app
git clone https://github.com/<PRIME_CARE_OS_REPO>.git os     # source of the handoff files
cd app
git checkout -b portal-admin-functions
mkdir -p functions/core/services/patient functions/middleware
cp ../os/firebase-handoff/portal-admin/functions/admin*.js functions/
cp ../os/firebase-handoff/portal-admin/functions/core/services/patient/portalAccess.js functions/core/services/patient/
cp ../os/firebase-handoff/portal-admin/functions/middleware/requireAdminCaller.js functions/middleware/
git status --short    # expect exactly 6 new files, 0 modified
```

If `git status` shows any **modified** file at this point, stop — a path
collided with an existing file.

### 1b. Set the allowed caller

Open `functions/middleware/requireAdminCaller.js` and confirm
`portal-admin@prive-care-vip.iam.gserviceaccount.com` is present in the
`ALLOWED_CALLERS` list. Add it if missing. Change nothing else in that file.

### 1c. Export the functions

Append these four lines to `functions/index.js`, alongside the existing
`exports.` lines. Do not reorder or remove any existing export.

```js
exports.adminIssueInvite     = require('./adminIssueInvite').adminIssueInvite;
exports.adminRevokeInvite    = require('./adminRevokeInvite').adminRevokeInvite;
exports.adminSetPortalAccess = require('./adminSetPortalAccess').adminSetPortalAccess;
exports.adminGetPortalAccess = require('./adminGetPortalAccess').adminGetPortalAccess;
```

### 1d. Deploy — only the four new names

```bash
cd ~/pcv-deploy/app/functions && npm ci && cd ..
npx firebase-tools@latest deploy --project=prive-care-vip \
  --only functions:adminIssueInvite,functions:adminRevokeInvite,functions:adminSetPortalAccess,functions:adminGetPortalAccess
```

The `--only` flag is mandatory. A bare `firebase deploy` would redeploy every
member-facing function and is forbidden.

If the CLI prompts to **delete** any function, answer **No** and stop.

### 1e. Verify

```bash
for FN in adminIssueInvite adminRevokeInvite adminSetPortalAccess adminGetPortalAccess; do
  echo -n "$FN -> "
  curl -s -o /dev/null -w "%{http_code}\n" \
    "https://us-central1-prive-care-vip.cloudfunctions.net/$FN"
done
```

**Done when:** each prints `401` or `403` (never `404`, never `200`), and the
Cloud Functions list shows the four new names with fresh timestamps while every
pre-existing function keeps the timestamp recorded in Step 0.

Commit and push the branch, then open a PR titled
`Add portal admin functions (no member-facing changes)`.

---

## Step 2 — Apply the enforcement patches

This is the only step that touches code members actually hit. Follow
`firebase-handoff/portal-admin/ENFORCEMENT.md` exactly for these handlers:

`getLabs`, `getImaging`, `getMedications`, `getLetters`, `getMedicalRecords`,
`getAppointments`, `getProblems`, `getAllergies`, `getMyPatientRecord`.

Rules the agent must not deviate from:

- Insert the guard clause **only** where `ENFORCEMENT.md` shows it. Do not
  refactor, reformat, or "improve" surrounding code.
- Preserve the two invariants: **fail open on visibility** (a Firestore read
  error must never blank a real chart) and **fail closed on suspension**.
- One commit per handler, so any single handler can be reverted alone.

Deploy with an explicit `--only` list of just the handlers you changed:

```bash
npx firebase-tools@latest deploy --project=prive-care-vip \
  --only functions:getLabs,functions:getImaging,functions:getMedications,functions:getLetters,functions:getMedicalRecords,functions:getAppointments,functions:getProblems,functions:getAllergies,functions:getMyPatientRecord
```

**Done when:** a human signs into <https://care.primecarevip.com> as a test
member and every section loads exactly as it did before the deploy. Because no
`portalAccess` document exists yet for anyone, behaviour must be byte-identical.
Any change in what the member sees at this point is a bug — revert immediately
(see Rollback).

---

## Step 3 — Create the caller identity

In Cloud Shell:

```bash
gcloud config set project prive-care-vip

gcloud iam service-accounts create portal-admin \
  --display-name="Prime Care OS portal admin"

for FN in adminIssueInvite adminRevokeInvite adminSetPortalAccess adminGetPortalAccess; do
  gcloud functions add-iam-policy-binding "$FN" \
    --region=us-central1 \
    --member="serviceAccount:portal-admin@prive-care-vip.iam.gserviceaccount.com" \
    --role="roles/cloudfunctions.invoker"
done
```

Grant **no other role**. In particular do not grant `roles/datastore.user`,
`roles/editor`, or any project-wide invoker binding — the functions do their own
Firestore work with their own runtime identity.

Then mint the key:

```bash
gcloud iam service-accounts keys create ~/portal-admin-key.json \
  --iam-account=portal-admin@prive-care-vip.iam.gserviceaccount.com
cat ~/portal-admin-key.json
```

Handling the key:

1. Copy the full JSON (starts `{` and ends `}`, single object).
2. In Prime Care OS, a human opens the secret form and saves it as
   **`PORTAL_ADMIN_SERVICE_ACCOUNT`**. The agent must not post the JSON into
   chat, a ticket, a commit, or any other page.
3. Back in Cloud Shell: `shred -u ~/portal-admin-key.json`.

**Done when:** in Prime Care OS, open any patient → **Portal** tab. It no longer
says "not configured" and shows real invite/claim state.

Verify the binding scope:

```bash
gcloud functions get-iam-policy adminIssueInvite --region=us-central1
```

Expect exactly one `roles/cloudfunctions.invoker` member: the `portal-admin`
service account.

---

## Step 4 — Prove it on one test member

Pick a single non-critical member. A human runs each row in Prime Care OS and
checks <https://care.primecarevip.com> after each. The agent's job here is to
record results, not to click through the portal on a member's behalf.

| # | Action in Prime Care OS | Expected on the live portal |
| --- | --- | --- |
| 4a | Open Portal tab | Correct invite/claim state, no error |
| 4b | Send invite | The same SendGrid email the CLI script sent |
| 4c | Toggle Labs off | Labs section says "unavailable", not "no results" |
| 4d | Toggle Labs back on | Labs render exactly as before |
| 4e | Hide one lab item | That item is gone; the rest unchanged |
| 4f | Unhide it | Item returns |
| 4g | Suspend | Paused-access message |
| 4h | Restore | Normal access resumes |

Then confirm all eight actions appear in the `portal_admin_actions` audit table
with the acting staff email and the reason text.

**No bulk invite waves until 4a–4h all pass.**

---

## Rollback

| Symptom | Action |
| --- | --- |
| A member-facing section misbehaves after Step 2 | In the Cloud Functions console, open the handler → **Revisions** → redeploy the revision timestamped in Step 0. Access docs stay in Firestore and are simply ignored. |
| Control plane misbehaving | A human deletes the `PORTAL_ADMIN_SERVICE_ACCOUNT` secret in Prime Care OS. The Portal tab reverts to "not configured" instantly. |
| Hard stop | `gcloud functions remove-iam-policy-binding <FN> --region=us-central1 --member="serviceAccount:portal-admin@prive-care-vip.iam.gserviceaccount.com" --role="roles/cloudfunctions.invoker"` for each of the four. |
| Full undo of Step 1 | `gcloud functions delete adminIssueInvite adminRevokeInvite adminSetPortalAccess adminGetPortalAccess --region=us-central1`. These are not on any member path. |

## Stop-and-report conditions

Halt and report immediately if any of these occur:

- The project selector shows a project other than `prive-care-vip`.
- The deploy CLI proposes deleting or updating a function not in the explicit
  `--only` list.
- `SENDGRID_API_KEY` is missing from Secret Manager.
- A curl to a new function returns `200` unauthenticated.
- Any existing function's "Last deployed" timestamp changes unexpectedly.
- Any step requires a permission broader than those listed above.
