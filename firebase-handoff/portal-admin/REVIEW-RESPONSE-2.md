# Response to the final review — all items closed

Every must-fix and should-fix from the final review is now resolved in this
handoff folder. Nothing is left as "decide later."

## Must-fix

**2.1 `getMyPatientRecord` suspension path — decided: option (a).**
`ENFORCEMENT.md` now states it explicitly. `getMyPatientRecord` does **not**
call `assertNotSuspended`; it returns `200` with
`payload.portal.status = 'suspended'` and **no clinical payload**, so the portal
can render the paused screen instead of a bare error. Every other handler keeps
`assertNotSuspended` and its `403`. The contradiction is gone: one endpoint
reports state, all PHI endpoints fail closed.

**2.2 `adminIssueInvite.toOverride` — removed.**
The recipient now comes only from the roster doc, so the header comment's
invariant is true as written. A wrong roster email is fixed in the roster, then
invited. The audit line also records `sentTo` verbatim — the destination was
the one thing worth logging and it now is, on both the success and the
send-failure path.

## Should-fix

**3.1 Audit collection names — both are intentional, now documented.**
`portalAdminAudit` (Firestore, portal side) and `portal_admin_actions`
(Prime Care OS, staff side) are two independent trails. `README.md`,
`GO-LIVE.md` and `AGENT-RUNBOOK.md` now say to check both, and that a row in
one without the other means a partly-failed call.

**3.2 SendGrid secret access — grant added to the runbook.**
`WIF.md` includes the `secretmanager.secretAccessor` binding for the functions'
runtime service account. Kept the direct Secret Manager read rather than
`runWith({secrets})` so the send path matches the CLI script it replaces.

**3.3 Audience check — now fails closed.**
`requireAdminCaller` returns `500 AUDIENCE_NOT_CONFIGURED` when no expected
audience is passed. A future handler cannot silently skip the check.

## Polish

- Malformed string bodies now return a clean `400 MALFORMED_BODY` in all four
  functions instead of an unhandled 500.
- `assertNotSuspended` has the same empty-id guard as `getPortalAccess`, and
  fails closed on it.
- The double read of `portalAccess/{id}` is documented in `ENFORCEMENT.md` with
  the single-read alternative and its trade-off, rather than changed silently.
- Self-asserted `actor`: acknowledged and unchanged — it is inherent to the
  machine-to-machine design. Prime Care OS derives it from a verified staff
  session and never from client input, and records it independently.

## WIF — proceeding, precondition answered: YES

Prime Care OS's auth issuer publishes OIDC discovery and an **ES256 public
JWKS**, verified live:

```
issuer:   https://imewkweatgvqledptdna.supabase.co/auth/v1
jwks_uri: https://imewkweatgvqledptdna.supabase.co/auth/v1/.well-known/jwks.json
```

These are asymmetric, not HS256, so GCP STS can validate them. No token broker,
no interim key, no migration date needed.

The federated subject is a **dedicated bridge account with no staff role**, not
a staff session, and the provider's attribute condition pins its exact `sub`.
Full commands, the values to send back, and rollback are in **`WIF.md`**.

The edge function is already written for this path and prefers it whenever the
WIF settings are present, so nothing on the Google side has to change once the
pool exists.

## To start the build

`WIF.md` step 2 needs `<BRIDGE_SUB>`. Everything else in the runbook is
unblocked and can proceed in parallel: branch, land the six files, the
`index.js` export fix, the enforcement patches, both CI `FUNCTIONS` arrays,
staging matrix, PR, merge.

---

## Hide-item no-op fix (rows 6–7)

**Client (OS app — shipped):** `usePortalAdmin.setAccess` now translates the
panel's `hideItem` / `unhideItem` intent into the backend's `hiddenItems`
module-keyed map. It re-reads the access snapshot immediately before the write
and computes the next array from that fresh read.

*Known limitation:* the read-modify-write happens on the client, so two
concurrent hides on the same member can clobber each other (last write wins).
Acceptable for a single-operator control plane; it disappears once the atomic
server-side op below is deployed and the client switches to sending
`hideItem` / `unhideItem` straight through.

**Backend (this repo — own PR through CI):**
1. `adminSetPortalAccess` now rejects unknown top-level patch keys with
   `400 UNKNOWN_PATCH_KEY` (and `400 EMPTY_PATCH`). An unrecognized key can no
   longer return `ok:true` and write a misleading audit row.
2. `hideItem` / `unhideItem` are first-class patch ops, validated for a known
   module and a non-empty, case-sensitive id, and applied **atomically inside
   `setPortalAccess`'s transaction** (read current list, add/remove id, write).
