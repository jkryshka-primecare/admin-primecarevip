# Browser-agent runbook v2 — portal control plane go-live

Supersedes v1. v1 was wrong on the repo name, the `index.js` export style, and
— most importantly — told you to deploy by hand. **Do not deploy by hand.**
See `REVIEW-RESPONSE.md` for why each change was made.

Audience: an autonomous browser agent with Owner/Editor on the Firebase project
**`prive-care-vip`** and write access to **`primecarevip/prime-care-vip-app-v2`**.
Where a shell is needed, use **Google Cloud Shell**.

---

## Constants (use verbatim)

| Name | Value |
| --- | --- |
| GCP / Firebase project id | `prive-care-vip` (spelled "priv**e**") |
| Functions repo | `primecarevip/prime-care-vip-app-v2` (spelled "pri**me**") |
| Functions region | `us-central1` |
| Deploy mechanism | GitHub Actions `.github/workflows/deploy-production.yml`, on push to `main` |
| Control-plane service account | `portal-admin@prive-care-vip.iam.gserviceaccount.com` |
| Read-only bridge SA (already exists, leave alone) | `lovable-portal-readonly@prive-care-vip.iam.gserviceaccount.com` |
| Functions to add | `adminIssueInvite`, `adminRevokeInvite`, `adminSetPortalAccess`, `adminGetPortalAccess` |

## Hard rules

1. **Never run `firebase deploy` against production from a shell.** All
   production deploys go through merge to `main`. The pipeline writes
   `functions/.env.prive-care-vip` (which carries `ENFORCE_AUTH`), deploys
   Firestore/Storage rules first and fatally, runs `verifyAuth.test.js`, and
   applies the text-scan health gate. A manual deploy skips all of it and can
   bring PHI endpoints up with auth failing open.
2. Never delete, rename, or redeploy an existing function. The enforcement
   edits in Step 2 are additive guard clauses only.
3. Never touch Firestore data, Firebase Auth users, billing, or existing
   service accounts.
4. Never paste a service-account private key into chat, a doc, a commit, or any
   page other than the Prime Care OS secret form.
5. On any error: stop and report the exact text. Do not improvise commands or
   add IAM roles beyond those listed.

---

## Step 0 — Pre-flight (no changes)

1. Confirm the console project selector reads **prive-care-vip**.
2. Record the current Cloud Functions list with **Last deployed** timestamps.
   This is the rollback reference.
3. Confirm none of the four `admin*` names exist yet. If any does, stop.
4. Confirm Secret Manager has **`SENDGRID_API_KEY`** — `adminIssueInvite` reads
   it at runtime.
5. Open `.github/workflows/deploy-production.yml` and locate the `FUNCTIONS=( … )`
   array in **both** the pre-deploy snapshot step and the health gate.

---

## Step 1 — Land the four admin functions on a branch

### 1a. Get the six files

They live in the **Prime Care OS Lovable project** under
`firebase-handoff/portal-admin/functions/`. That is not a repo you can clone —
a human supplies them (export from the project, or connect it to GitHub and use
that URL). Target paths inside the app repo:

```
functions/adminIssueInvite.js
functions/adminRevokeInvite.js
functions/adminSetPortalAccess.js
functions/adminGetPortalAccess.js
functions/core/services/patient/portalAccess.js
functions/middleware/requireAdminCaller.js
```

```bash
cd ~ && rm -rf pcv-deploy && mkdir pcv-deploy && cd pcv-deploy
git clone https://github.com/primecarevip/prime-care-vip-app-v2.git app
cd app && git checkout -b portal-admin-functions
mkdir -p functions/core/services/patient functions/middleware
# copy the six files into place, then:
git status --short   # expect exactly 6 new files, 0 modified
```

Any **modified** file here means a path collided — stop.

### 1b. Allowed caller

In `functions/middleware/requireAdminCaller.js`, confirm
`portal-admin@prive-care-vip.iam.gserviceaccount.com` is in `ALLOWED_CALLERS`.
Change nothing else.

### 1c. Export them — matching the existing style

`functions/index.js` uses a single `module.exports = { … }` object. Adding
`exports.foo = …` lines after that assignment exports nothing. So:

Add alongside the other requires at the top:

```js
const { adminIssueInvite }     = require('./adminIssueInvite');
const { adminRevokeInvite }    = require('./adminRevokeInvite');
const { adminSetPortalAccess } = require('./adminSetPortalAccess');
const { adminGetPortalAccess } = require('./adminGetPortalAccess');
```

and add the four names **inside** the existing `module.exports = { … }` object.
Do not reorder or remove existing entries. Keep the `AGENTS.md` rule 13
trigger-wrapper test for `index.js` passing.

### 1d. Register them with the pipeline

Add the four names to the `FUNCTIONS=( … )` array in
`.github/workflows/deploy-production.yml` — **both** occurrences (pre-deploy
snapshot and health gate). A function missing from the gate deploys unwatched.

**Done when:** branch pushed, `git status` clean, no manual deploy attempted.

---

## Step 2 — Enforcement patches

Apply `ENFORCEMENT.md` (also revised) to: `getLabs`, `getImaging`,
`getMedications`, `getLetters`, `getMedicalRecords`, `getAppointments`,
`getProblems`, `getAllergies`, `getMyPatientRecord`.

- Resolver is `resolvePatientForCaller(uid)` — not `bindMember`.
- Insert the guard **after** `resolvePatientForCaller`, **after** the D-068
  `ELATION_READ_ALLOWLIST` gate, and **after** the audit-first `phi_access_log`
  write, so denials are still audited.
- Preserve both invariants: fail **open** on visibility, fail **closed** on
  suspension.
- One commit per handler so any single handler can be reverted alone.
- Do not refactor surrounding code.

---

## Step 3 — Prove it on staging (new, mandatory)

The repo has `.env.staging`. Deploy the branch to the staging target and run a
real matrix — v1's "behaviour is byte-identical because no access doc exists"
tested nothing, because it exercises none of the new paths.

For at least one staging member, per module: **suspend / restore**,
**module off / on**, **hide one item / unhide**. Confirm:

- suspended → `403 ACCESS_SUSPENDED` on every one of the nine handlers;
- module off → `200` with `moduleUnavailable: true`, not an empty "no results";
- hidden item → that item absent, siblings unchanged;
- restore/unhide → byte-identical to the pre-change response;
- `getMyPatientRecord` returns `portal.status` + `portal.modules` and **no**
  `hiddenItems`.

**Done when:** every cell passes on staging.

---

## Step 4 — PR, review, merge (this is the production deploy)

Open a PR titled `Add portal admin functions + visibility enforcement`. A human
reviews, then merges to `main`. The pipeline deploys with the env file, the
rules-first HIPAA guard, the `verifyAuth` test, and the health gate intact.

**Done when:** the four new names appear in Cloud Functions with fresh
timestamps, every pre-existing function keeps its Step 0 timestamp, and each of
the four returns `401`/`403` unauthenticated (never `404`, never `200`):

```bash
for FN in adminIssueInvite adminRevokeInvite adminSetPortalAccess adminGetPortalAccess; do
  echo -n "$FN -> "
  curl -s -o /dev/null -w "%{http_code}\n" \
    "https://us-central1-prive-care-vip.cloudfunctions.net/$FN"
done
```

Then a human signs into <https://care.primecarevip.com> as a test member and
confirms every section loads as before. No `portalAccess` doc exists in
production yet, so any visible change is a bug — revert immediately.

---

## Step 5 — The caller identity

`portal-admin` is a **different identity** from `lovable-portal-readonly`
(`roles/datastore.viewer`, already provisioned for the read-only bridge). Do
not reuse or modify the read-only one.

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

Grant **no other role** — no `datastore.user`, no `editor`, no project-wide
invoker binding. The functions do their own Firestore work with their own
runtime identity.

On the key: the bridge is a Supabase edge function outside GCP, so there is no
metadata server and no ambient identity. Workload Identity Federation is the
preferred end state and is planned as a follow-up; until then a single
downloadable key is required. A **human** runs the mint step and handles the
JSON — the agent does not:

```bash
gcloud iam service-accounts keys create ~/portal-admin-key.json \
  --iam-account=portal-admin@prive-care-vip.iam.gserviceaccount.com
```

The human copies the JSON straight into the Prime Care OS secret form as
**`PORTAL_ADMIN_SERVICE_ACCOUNT`**, then `shred -u ~/portal-admin-key.json`. It
is never committed, echoed, or pasted anywhere else, so trufflehog has nothing
to find.

Verify the binding scope:

```bash
gcloud functions get-iam-policy adminIssueInvite --region=us-central1
```

Expect exactly one `roles/cloudfunctions.invoker` member: `portal-admin`.

**Done when:** in Prime Care OS, any patient → **Portal** tab no longer says
"not configured" and shows real invite/claim state.

---

## Step 6 — One production test member

A human runs each row in Prime Care OS and checks the live portal after each.
The agent records results only.

| # | Action | Expected on the live portal |
| --- | --- | --- |
| 6a | Open Portal tab | Correct invite/claim state, no error |
| 6b | Send invite | The same SendGrid email the CLI script sent |
| 6c | Toggle Labs off | "unavailable", not "no results" |
| 6d | Toggle Labs on | Labs render exactly as before |
| 6e | Hide one lab item | That item gone, rest unchanged |
| 6f | Unhide it | Item returns |
| 6g | Suspend | Paused-access message |
| 6h | Restore | Normal access resumes |

Then confirm all eight appear in `portal_admin_actions` with the acting staff
email and reason. **No bulk invite waves until 6a–6h pass.**

---

## Rollback

| Symptom | Action |
| --- | --- |
| A member-facing section misbehaves after the merge | Revert the offending handler's commit and merge — the pipeline redeploys. For an emergency, Cloud Functions console → handler → **Revisions** → redeploy the Step 0 revision, then land the revert so CI and prod agree. |
| Control plane misbehaving | A human deletes `PORTAL_ADMIN_SERVICE_ACCOUNT` in Prime Care OS. The Portal tab reverts to "not configured" instantly; the member portal is unaffected. |
| Hard stop on invocation | `gcloud functions remove-iam-policy-binding <FN> --region=us-central1 --member="serviceAccount:portal-admin@prive-care-vip.iam.gserviceaccount.com" --role="roles/cloudfunctions.invoker"` for each of the four. |
| Full undo | Revert the branch merge; the four `admin*` functions are on no member path. |

## Stop-and-report conditions

- The project selector shows anything other than `prive-care-vip`.
- Anyone proposes a manual `firebase deploy` against production.
- CI proposes deleting or updating a function outside the intended set.
- `SENDGRID_API_KEY` is missing from Secret Manager.
- A curl to a new function returns `200` unauthenticated.
- An existing function's "Last deployed" timestamp changes unexpectedly.
- Any step needs a permission broader than those listed.

### Two audit trails, two names

Both exist by design and both must show the action:

- **`portalAdminAudit`** (Firestore, written by the Cloud Functions) — the
  portal-side record of what was actually mutated.
- **`portal_admin_actions`** (Prime Care OS database, written by the
  `portal-admin` edge function) — the staff-side record of who clicked what and
  why, tied to a verified staff session.

When verifying go-live, check both. A row in one and not the other means the
call failed partway and should be investigated.
