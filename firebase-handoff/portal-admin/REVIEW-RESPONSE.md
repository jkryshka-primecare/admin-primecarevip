# Response to `portalgolivefindings.md`

Short answer: **the review is right on every material point. Do not run the
original runbook.** `AGENT-RUNBOOK.md` has been rewritten (v2) and
`ENFORCEMENT.md` corrected. The plan itself does not change — only the
mechanics of getting it deployed.

Point-by-point:

| Finding | Verdict | Action |
| --- | --- | --- |
| 2.1 Repo name is `prime-care-vip-app-v2` | Correct, our typo | Fixed in v2 |
| 2.2 Source of the six files unresolved | Correct | The files live in the **Prime Care OS Lovable project**, not a GitHub repo the agent can clone. A human exports them (see below). Paths and contents are unchanged. |
| 2.3 `index.js` uses `module.exports = { … }` | Correct, and it would have silently broken the deploy | Fixed in v2: requires at top, names inside the object |
| 2.4 Manual `firebase deploy` bypasses CI, `ENFORCE_AUTH` fail-open risk | **Correct and the most important finding.** Adopted without reservation. | v2 deploys only via PR → merge to `main`; adds the four names to the `FUNCTIONS` array in `deploy-production.yml` (snapshot **and** gate). No laptop deploys. |
| 2.5 Step 2 acceptance proves nothing | Correct | v2 requires a staging run with real `portalAccess` docs before production |
| 3.1 Resolver is `resolvePatientForCaller(uid)`, not `bindMember` | Correct | Fixed in `ENFORCEMENT.md` |
| 3.2 Insertion point vs D-068 gate and audit-first write | Correct concern | Confirmed semantics: insert **after** `resolvePatientForCaller`, **after** the D-068 allowlist gate, and **after** the audit-first `phi_access_log` write. Every attempt stays audited, including denials. |
| 3.3 Fail-open on visibility not implemented | Already satisfied — please re-check the file | `getPortalAccess` in `core/services/patient/portalAccess.js` wraps its Firestore `get` in try/catch and returns the all-visible default on error; it never throws. `assertNotSuspended` deliberately does throw (fail closed). The snippet was right; the reviewer could not locate the file (see 2.2). |
| 3.4 `getMyPatientRecord` has a different shape | Correct | Noted explicitly in `ENFORCEMENT.md` |
| 4. Downloadable key contradicts keyless pattern | Correct in spirit; see below | Constrained, not eliminated |

## The credential question (§4)

The bridge is a **Supabase edge function running outside GCP**, so there is no
metadata server and no ambient identity to exchange. The two keyless options are:

1. **Workload Identity Federation** with Supabase's JWT issuer as an OIDC
   provider. Genuinely keyless, and the right end state — but it needs a new
   WIF pool, an issuer/audience mapping, and edge-function changes on our side.
2. **A downloadable JSON key for `portal-admin`** — what the runbook assumed.

Recommendation: ship with (2) under hard constraints, then migrate to (1) as a
follow-up. Constraints, all already true of our side:

- The key is entered **once**, by a human, into the Lovable Cloud secret store
  as `PORTAL_ADMIN_SERVICE_ACCOUNT`. It is never committed, never printed to
  chat, never written to a file in either repo — so trufflehog has nothing to
  find.
- `portal-admin` holds exactly one role: `roles/cloudfunctions.invoker`, bound
  **per function** on the four `admin*` functions. No project-level binding, no
  `datastore.user`, no `editor`. It cannot read or write Firestore directly;
  the functions do that with their own runtime identity.
- It is a **separate identity** from `lovable-portal-readonly`
  (`roles/datastore.viewer`), which stays exactly as provisioned and is used
  only by the read-only bridge. Do not merge or reuse them.
- Revocation is one click: delete the secret in Prime Care OS and the control
  plane goes dark instantly, with no effect on the member portal.

If you would rather not mint a key at all, say so and we will do WIF first —
it delays go-live by roughly one build cycle on this side.

## Getting the six files to the agent (§2.2)

They are not in a clonable GitHub repo. Either:

- a human downloads/copies them out of the Prime Care OS project from
  `firebase-handoff/portal-admin/functions/` and commits them onto the branch, or
- connect the Prime Care OS project to GitHub and give the agent that repo URL.

Paths inside `functions/` are unchanged:

```
functions/adminIssueInvite.js
functions/adminRevokeInvite.js
functions/adminSetPortalAccess.js
functions/adminGetPortalAccess.js
functions/core/services/patient/portalAccess.js
functions/middleware/requireAdminCaller.js
```

## Is it safe to proceed?

Safe to proceed with the **v2 runbook**, in this order: branch → fix
`index.js` → enforcement patches → add the four names to the CI `FUNCTIONS`
array → staging with real access docs → PR → human review → merge to `main`.
Not safe to proceed with v1's manual deploy path, for exactly the
`ENFORCE_AUTH` reason the review gives.
