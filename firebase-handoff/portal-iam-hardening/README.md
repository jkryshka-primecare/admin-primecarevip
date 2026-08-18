# Portal IAM hardening — "admin endpoints are never public" as a pipeline guarantee

## Problem

1st-gen HTTP Cloud Functions are deployed with a public `allUsers`
`roles/cloudfunctions.invoker` binding. It has now happened twice and been
stripped by hand: Step 1's four `admin*` functions, and `adminProvisionPatients`.

`requireAdminCaller` blocks anonymous callers, so this was never an exploitable
data path — but the outer IAM gate being open defeats defense-in-depth and is a
finding in its own right.

## Why not an org policy

`constraints/iam.allowedPolicyMemberDomains` (or any blanket `allUsers` ban)
would break the member portal. The patient read CFs — `getLabs`, `getImaging`,
`getMedications`, `getLetters`, `getMedicalRecords`, `getAppointments`,
`getProblems`, `getAllergies`, `getMyPatientRecord` — are **intentionally
public at the IAM layer** and gated by `verifyPatientToken` inside. Do not add
an org policy. Fix the admin plane specifically.

## The fix

Add the step in [`lock-admin-invokers.yml`](./lock-admin-invokers.yml) to
`.github/workflows/deploy-production.yml`, in the deploy job, **after** the
`firebase deploy` step and before/alongside the existing health gate.

GitHub Actions does not carry auth or env across steps, so the step activates
gcloud itself from `secrets.GOOGLE_APPLICATION_CREDENTIALS_JSON_PRODUCTION`
(`gcloud auth activate-service-account` + `gcloud config set project`) before
touching IAM. Without that, every call fails with "no active account".

For each of `adminIssueInvite`, `adminRevokeInvite`, `adminSetPortalAccess`,
`adminGetPortalAccess`, `adminProvisionPatients` it:

1. `gcloud functions remove-iam-policy-binding <fn> --region=us-central1
   --member=allUsers --role=roles/cloudfunctions.invoker`, tolerating the
   `NOT_FOUND` that gcloud returns when the binding is already gone — so the
   step is idempotent and green on every subsequent deploy;
2. re-asserts `serviceAccount:portal-admin@prive-care-vip.iam.gserviceaccount.com`
   as invoker (`add-iam-policy-binding` is itself idempotent);
3. reads the resulting policy back and **fails the workflow** if `allUsers` or
   `allAuthenticatedUsers` is still present, or if the `portal-admin` binding is
   missing.

Step 3 is the actual guarantee. Steps 1–2 are remediation; without the readback
a silently failing gcloud call would leave the endpoint public and the deploy
green.

Note it never touches any function outside the five names, so the patient read
CFs keep their public binding.


## Deploy service account permissions — resolved

The production deploy SA is `firebase-adminsdk-fbsvc@`, which holds
`roles/cloudfunctions.admin` and therefore `getIamPolicy` / `setIamPolicy`. No
new grant was needed.

**`roles/cloudfunctions.developer` does NOT include
`cloudfunctions.functions.getIamPolicy` / `setIamPolicy`.** Only
`roles/cloudfunctions.admin`, `roles/cloudfunctions.editor`, or project
`roles/editor` / `roles/owner` carry them (Google Cloud — Cloud Functions IAM
roles reference).

This matters because the step runs *as the activated deploy service account*:
the remove, the add, and the step-3 read-back all need those permissions. If the
SA only holds `developer`, all three return `PERMISSION_DENIED`, the step exits
1, and every production deploy fails from then on. It fails safe (nothing goes
out public) but it wedges the pipeline.

If the deploy SA ever changes, re-confirm with:


```bash
gcloud projects get-iam-policy prive-care-vip \
  --flatten="bindings[].members" \
  --filter="bindings.members:<deploy-sa-email>" \
  --format="table(bindings.role)"
```

- Holds `roles/cloudfunctions.admin`, `roles/cloudfunctions.editor`, or project
  `roles/editor` / `roles/owner` → nothing to do, merge.
- Holds only `roles/cloudfunctions.developer` (or less) → grant
  **`roles/cloudfunctions.admin`**, the narrowest predefined role that includes
  `setIamPolicy` (a custom role with `cloudfunctions.functions.getIamPolicy` +
  `cloudfunctions.functions.setIamPolicy` also works):

```bash
gcloud projects add-iam-policy-binding prive-care-vip \
  --member="serviceAccount:<deploy-sa-email>" \
  --role="roles/cloudfunctions.admin"
```

Also ensure the deploy SA has `roles/iam.serviceAccountUser` on
`portal-admin@` if binding it as a member is rejected — normally not required
for `add-iam-policy-binding`, only for act-as during deploy.

## Verification after the first merge

```bash
for FN in adminIssueInvite adminRevokeInvite adminSetPortalAccess \
          adminGetPortalAccess adminProvisionPatients; do
  echo "== $FN"
  gcloud functions get-iam-policy "$FN" --region=us-central1 --format=json \
    | grep -E 'allUsers|portal-admin' || echo "  (no public member)"
  curl -s -o /dev/null -w "  unauth -> %{http_code}\n" \
    "https://us-central1-prive-care-vip.cloudfunctions.net/$FN"
done
```

Expect no `allUsers` anywhere, exactly one `portal-admin` invoker member each,
and `401`/`403` unauthenticated (never `200`, never `404`).

Then spot-check that a patient read CF is still public and working:

```bash
gcloud functions get-iam-policy getLabs --region=us-central1 | grep allUsers
```

That one **must** still show `allUsers`.

## Known limitations (accepted, non-blocking)

- **Third hardcoded admin list.** This array is a third place to keep in sync
  with the two health-gate `FUNCTIONS=( … )` arrays and the `index.js` exports.
  A new admin function forgotten here deploys public and is not covered. Worth
  collapsing to one shared source of truth for the admin-function names.
- **1st-gen only.** The `gcloud functions …` calls (no `--gen2`) are correct
  today. Migrating any admin function to 2nd-gen moves IAM onto the backing
  Cloud Run service and requires updating this step.
- **Brief public window on first deploy** of a newly added admin function,
  between `firebase deploy` finishing and this step running. `requireAdminCaller`
  covers it, so no data path is exposed — inherent to a post-deploy strip.

## Rollback

Remove the step from the workflow. Nothing else changes — the step only edits
IAM on the five admin functions, and the inner `requireAdminCaller` gate is
untouched.
