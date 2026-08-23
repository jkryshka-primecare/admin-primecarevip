# `setUserRole` hardening — review pack

Scope: `functions/setUserRole.js` only, plus one `firestore.rules` block and one
alert policy. No IAM change: `setUserRole` is `onCall`, the console invokes it as
the signed-in user, so it stays out of `ADMIN_FUNCTIONS`. Same conclusion for
`syncElationPatients` — user-token gate, console-invoked, keeps its public
binding, no workflow change.

Files in this handoff:

- `functions/setUserRole.js` — full replacement (drop-in, same export name).
- `firestore-rules-role-change-audit.txt` — rules block to paste.
- `super-admin-grant-alert.md` — log-based metric + alert policy.

## What changes

### 1. Escalation closed

```diff
-  requireRole(caller, ['admin', 'super_admin']);
+  requireRole(caller, ['super_admin']);
```

`admin` could previously grant any role in `VALID_ROLES`, including
`super_admin`, to any uid including its own. That is the finding. Now only
`super_admin` may mutate roles at all.

If some `admin` workflow genuinely needs to assign non-privileged roles, do not
reopen this — add a second callable whose `role` parameter is restricted to
`clinical | pharmacy | billing | hr | staff | pending`.

### 2. Self-mutation blocked

```js
if (uid === caller.uid) throw ... reason: 'SELF_ROLE_CHANGE'
```

Blocks silent self-elevation and self-demotion lockout. Note the operational
consequence: **a super_admin can no longer demote themselves**, and the last
remaining super_admin cannot be removed through this endpoint. That is
intentional; removal of the final super_admin is a deliberate console/CLI
action, not a self-serve one.

### 3. Reason required for privileged grants

Granting `admin` or `super_admin` now requires a non-empty `reason` in the
request body, recorded in the audit row. `INVALID_ARGUMENT / REASON_REQUIRED` if
absent. **Caller-visible change** — the admin console's role dropdown must send
`reason` for those two roles or those grants start failing.

### 4. Audit row first, fail closed

A `role_change_audit` document is written **before** `setCustomUserClaims`, with
actor uid/email/role taken from the verified token (never the body), target uid
and email, `previousRole` read from the target's existing custom claims,
`newRole`, `privileged`, and `reason`. If that write fails the handler returns
`unavailable / AUDIT_UNAVAILABLE` and the claim is never set — same posture as
`recordActionStrict` in the operator console.

A second update stamps the outcome: `applied`, `failed`
(`set_claims_failed`), or `partial` (`firestore_update_failed` — claims set,
users doc stale; that state was already possible, it is now recorded).

Return shape gains two fields: `{ uid, role, previousRole, auditId }`. Purely
additive.

### 5. super_admin-grant alert

On a `super_admin` grant the handler emits a `severity: WARNING` line with
`event: "super_admin_granted"`. `super-admin-grant-alert.md` has the log-based
metric and the alert policy — any grant should page, because in steady state
this should fire approximately never.

## What is NOT changed

- `ENFORCE_AUTH` fail-open in `middleware/verifyAuth.js`. It returns
  `{ role: 'pending' }` rather than throwing when unset; `requireRole` still
  rejects `pending`, and the deploy writes `ENFORCE_AUTH=${ENFORCE_AUTH:-true}`,
  so it is not exploitable here. Out of scope, but do not ever add `pending` to
  an allowlist.
- No IAM / workflow edits. `ADMIN_FUNCTIONS` stays at the 13 Part B names.

## Pre-merge checklist

1. Confirm no current `admin` (non-super) relies on `setUserRole` — they will
   start getting `permission-denied / INSUFFICIENT_ROLE`.
2. Confirm at least two active `super_admin` accounts exist before merge, since
   self-demotion is now blocked.
3. Update the admin console to send `reason` when granting `admin`/`super_admin`
   and to surface `SELF_ROLE_CHANGE` and `REASON_REQUIRED`.
4. Paste the `role_change_audit` rules block and deploy rules with the function.
