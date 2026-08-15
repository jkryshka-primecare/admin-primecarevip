# Phase 3 — Portal control plane in Prime Care OS

Give staff a Portal section inside this admin app that can invite members to the patient portal, control what each member sees, and manage their access — without anyone touching a CLI script again.

## What exists today

- Invites are a human-run script (`scripts/issueInvites.cjs`) that mints `claimTokens/{sha256(token)}` and emails `care.primecarevip.com/claim?t=...` via SendGrid. Not reachable from any UI.
- `claimAccount` validates the token, checks DOB, creates the Firebase Auth user, and stamps the roster doc at `patients/{elationPatientId}`.
- Elation is the source of truth for demographics; the roster doc is written by the Elation sync.
- This admin app has **no write path** into Firebase — `firestore-bridge` implements only `get` and `runQuery`, with a read-only token scope.

## Shape of the solution

Three layers, in order:

```text
Prime Care OS (staff UI)
        |  authed staff request
        v
 portal-admin  (new edge function here)   -- role check, audit log, Google OIDC token
        |  HTTPS + identity token
        v
 admin-only Cloud Functions (your Firebase repo)  -- the only thing that writes
        |
        v
 Firestore: claimTokens, patients, portalAccess
```

All writes live in your audited Google codebase. This app never writes to Firestore directly, and the read-only service account stays read-only.

### Layer 1 — New Cloud Functions (Firebase repo, deployed by you)

Written to match the existing conventions in `functions/` (same error envelope, CORS allowlist, PHI-safe logging). Four endpoints, each requiring a Google identity token from a dedicated admin service account, never a patient token:

- `adminIssueInvite` — reuses `issueClaimToken` + the existing SendGrid template. Handles the `LIVE_TOKEN_EXISTS` case by offering revoke-and-reissue rather than silently minting a duplicate.
- `adminRevokeInvite` — marks the live claim token spent so a leaked link dies.
- `adminSetPortalAccess` — writes `portalAccess/{elationPatientId}`: per-module visibility, hidden item ids, and account state.
- `adminGetPortalAccess` — reads back the current state for the UI.

### Layer 2 — Enforcement (Firebase repo)

Hiding has to be real, not cosmetic. The existing `getLabs`, `getImaging`, `getMedications`, `getLetters`, `getMedicalRecords`, `getAppointments`, `getProblems`, `getAllergies` each read `portalAccess` for the caller and:

- return a "section unavailable" response when that module is off for the member
- filter out any item whose id is in `hiddenItems`
- return the existing 403 shape when the account is suspended

`getMyPatientRecord` returns the module map so the portal can hide navigation for sections the member can't open.

Data contract:

```text
portalAccess/{elationPatientId}
  status        : 'active' | 'suspended'
  modules       : { labs, imaging, medications, records, appointments,
                    conditions, allergies }   -> bool, default true
  hiddenItems   : { labs: [id], imaging: [id], records: [id], ... }
  updatedAt     : Timestamp
  updatedBy     : string   (staff email from this app)
  reason        : string   (free text, shown in the audit trail)
```

Absent doc = everything visible. Fail-open on visibility, fail-closed on suspension.

### Layer 3 — Prime Care OS (built here)

New `portal-admin` edge function: `requireStaff()` gate, admin-only for destructive actions, mints a Google OIDC identity token for the admin service account, calls the Cloud Functions, logs every action to `phi_access_log` plus a new `portal_admin_actions` table.

New **Portal** tab on the patient detail view in `/patients`:

- **Invite** — current state (not invited / invited, link live until date / claimed on date), Send invite, Resend, Revoke. Every send shows a confirmation naming the member and email before it fires.
- **Visibility** — a toggle per module and a per-item hide control on labs, imaging, and records lists, with a required reason on each change.
- **Access** — suspend / restore portal access, reset the DOB gate.
- **Demographics** — side-by-side Elation vs. portal roster values with a drift badge, plus a "flag for review" action. Read-only: no edit path to Elation or to the roster doc.
- **History** — who changed what, when, and why, pulled from `portal_admin_actions`.

A bulk invite view (filter the roster, select, send capped waves with a typed confirmation) mirrors the safety rails already in the CLI script: explicit cap, confirmation, audit line.

## Safety rules

- Only these four admin endpoints may write; the whitelist stays closed and `firestore-bridge` stays read-only.
- No writes to Elation, ever, in this phase. Demographics are view-and-flag only.
- Every invite send and every visibility change requires an in-app confirmation and records the acting staff member.
- Nothing here can read or expose a raw claim token — the app only ever sees whether a live token exists and when it expires.

## Technical notes

- This app authenticates to the Cloud Functions with a Google-signed OIDC identity token, so a new service account (`portal-admin@prive-care-vip`) with Cloud Functions Invoker on the four admin functions is needed, stored here as a new secret. The existing read-only `FIREBASE_SERVICE_ACCOUNT` is untouched.
- New Postgres table `portal_admin_actions` (staff user, member Elation id, action, before/after, reason) with admin-read RLS and no client writes.
- The Cloud Function source will be authored here as ready-to-commit files under a handoff folder, since this app has read-only access to the Firebase repo — you or the repo's agent commits and deploys them.

## Sequencing

1. Cloud Function source + enforcement patches authored and handed off; you deploy and grant the invoker role.
2. `portal-admin` edge function and the `portal_admin_actions` table here.
3. Portal tab in `/patients`, starting with invite + access, then visibility, then demographics drift.
4. Bulk invite waves, once single invites are proven on a test member.

Note: the visibility controls and the module map need matching support in the rebuilt portal in My Health Hub. Until that portal ships, module toggles and item hiding take effect through the Cloud Function responses, which the current live portal already consumes — so they work on the existing portal too.
