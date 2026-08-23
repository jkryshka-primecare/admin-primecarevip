# Security pass — `setUserRole` and `syncElationPatients`

Reviewed against the live repo (`primecarevip/prime-care-vip-app-v2`, `main`).
Neither is in the Part B path; neither blocks the UID mint.

## 1. `setUserRole` — real finding, but NOT the invoker list

`functions/setUserRole.js` is `functions.https.onCall`. Firebase **callables are
invoked directly by the signed-in browser client**, so their public `allUsers`
invoker binding is load-bearing: authorization happens inside, from the verified
`context.auth` token. Adding it to `ADMIN_FUNCTIONS` binds the invoker role to
`portal-admin@` only and would 403 every legitimate admin-console call. Do not
add it. The correct posture for a callable is a hard internal gate.

The internal gate is server-verified (`verifyAuth(context)` reads
`context.auth.token`, never the body — good), but it is **not super_admin-only
and it permits privilege escalation**:

```js
requireRole(caller, ['admin', 'super_admin']);   // line 18
...
if (!VALID_ROLES.includes(role)) { ... }         // any role, incl. super_admin
```

An account holding `admin` can therefore grant `super_admin` — to any uid,
including its own. That is the finding, not the IAM binding.

Secondary: `ENFORCE_AUTH` fail-open in `middleware/verifyAuth.js` returns
`{ role: 'pending' }` instead of throwing when unset. `requireRole` still
rejects `pending`, so this is not exploitable today, and
`deploy-production.yml` writes `ENFORCE_AUTH=${ENFORCE_AUTH:-true}`. Leave it,
but do not add any allowlist that includes `pending`.

### Patch

```diff
-  requireRole(caller, ['admin', 'super_admin']);
+  // Role mutation is super_admin-only. An `admin` must not be able to mint
+  // `super_admin` (self-escalation) or demote a super_admin.
+  requireRole(caller, ['super_admin']);
```

and, after the `VALID_ROLES` check, block self-mutation so a super_admin cannot
lock the tenant out or silently change their own tier:

```js
if (uid === caller.uid) {
  throw new functions.https.HttpsError('permission-denied', 'Cannot change your own role', {
    reason: 'SELF_ROLE_CHANGE', metadata: { uid },
  });
}
```

If any current `admin` genuinely needs to assign non-privileged roles, split it:
keep `setUserRole` at super_admin, and add a separate callable that `admin` may
call but whose `role` parameter is restricted to the non-privileged subset
(`clinical`, `pharmacy`, `billing`, `hr`, `staff`, `pending`) — never `admin` or
`super_admin`.

## 2. `syncElationPatients` — gate confirmed; lock only if no browser caller

`functions/syncElationPatients.js` is `functions.https.onRequest`.

- POST only, CORS pinned to `ALLOWED_ORIGIN` (default
  `https://provider.primecarevip.com`).
- `verifyAuth(req.headers.authorization)` → `requireRole(user, ['super_admin'])`
  on every mode, documented as independent of `ENFORCE_AUTH`. Identity comes
  from the verified Firebase ID token, never the body. Confirmed correct.
- `full` mode additionally refuses unless `ELATION_FULL_SYNC_ENABLED=true`;
  default mode is the named-id allowlist.

So the gate holds. The question is only whether the public IAM binding is
needed:

- **If it is triggered from the provider console in a browser** (super_admin
  clicking sync), it needs `allUsers` at IAM for the same reason the patient
  read CFs do — leave it public and rely on the token gate.
- **If it is only ever invoked machine-to-machine or by hand via gcloud**, add
  `syncElationPatients` to `ADMIN_FUNCTIONS` in `deploy-production.yml` and
  switch its gate from `verifyAuth` to `requireAdminCaller` + `selfAudience`,
  matching the rest of the admin plane. Do not add it to the list while it still
  authenticates with a Firebase ID token — the lock binds `portal-admin@` as the
  sole invoker and the browser call would 403.

Confirm which caller is real before touching this one; it is a PHI sync and a
broken sync is worse than a public-but-gated endpoint.

## Summary

| Function | Gate server-verified? | Add to ADMIN_FUNCTIONS? | Action |
| --- | --- | --- | --- |
| `setUserRole` | Yes, but `admin` can mint `super_admin` | **No** — callable, would break the console | Tighten to `super_admin` + block self-change |
| `syncElationPatients` | Yes — `super_admin`, all modes | Only if no browser caller | Confirm caller, then lock + `requireAdminCaller` |
