# Env-driven CORS + deploy wiring for the pre-cutover smoke test

Scope: one `git apply`-able patch, same format as #495. The fixture-script work is dropped —
the guardian Auth user (`usEWzqPQVMNdv4R7k5I4DewZjC12`) and the chart record are already done.

## What's wrong today

CORS is a hardcoded constant repeated in every patient-facing function:

```js
const ALLOWED_ORIGINS = ['https://care.primecarevip.com', 'http://localhost:5173'];
```

`setCors` only echoes `Access-Control-Allow-Origin` on an exact match. The preflight is
answered before that check, which is why OPTIONS returns 204 and the real POST is blocked.
There is no env var, so today a new origin costs a code change.

## The patch

**1. New shared module `functions/core/config/corsOrigins.js`**

- `allowedOrigins()` — pinned base list (`https://care.primecarevip.com`,
  `http://localhost:5173`) merged with `CORS_ALLOWED_ORIGINS` (comma-separated).
- Each extra entry is trimmed, lower-cased, and must parse as an absolute `https://` URL
  (`http://localhost:<port>` excepted). Anything else — a bare host, a wildcard, a path — is
  dropped. `*` can never be produced.
- The pinned base is never removable, so a dropped or clobbered variable cannot break
  production; it can only fail to add the test origin.
- `setCors(req, res)` exported from the same module so the per-file copies disappear.

**2. `setCors` swap in every patient-facing function**

The three artifact readers are in this handoff folder and will be patched directly:
`getLabs.js`, `getImaging.js`, `getMedicalRecords.js`. The rest (`getMyPatientRecord` and its
siblings) are not — see "Inputs I need" below. Behavior is otherwise unchanged: exact match
only, no wildcard, `Vary: Origin` retained, headers on every response including errors.

**3. `deploy-production.yml` wiring**

Extend the step that writes `functions/.env.prive-care-vip` so all four variables are written
every deploy, using the repo's existing `_PRODUCTION` suffix convention (confirmed by
GO-LIVE.md, which uses `ELATION_READ_ALLOWLIST_PRODUCTION`):

| `.env.prive-care-vip` key | GitHub secret |
|---|---|
| `ELATION_READ_ALLOWLIST` | `ELATION_READ_ALLOWLIST_PRODUCTION` |
| `GUARDIAN_READS_ENABLED` | `GUARDIAN_READS_ENABLED_PRODUCTION` |
| `GUARDIAN_READS_ALLOWLIST` | `GUARDIAN_READS_ALLOWLIST_PRODUCTION` |
| `CORS_ALLOWED_ORIGINS` | `CORS_ALLOWED_ORIGINS_PRODUCTION` |

Written with `printf '%s'`, no trailing newline, and each line quoted so a comma-separated
800-id value survives intact. An unset secret writes an empty value rather than the literal
string `null` — an empty `GUARDIAN_READS_ALLOWLIST` denies all guardian reads, which is the
correct fail-closed default.

**4. Handoff note** listing the functions your repo must sweep and the exact `gh secret set`
commands, including the reminder that `ELATION_READ_ALLOWLIST_PRODUCTION` must be read,
appended to, and re-set whole — never replaced with just the fixture ids.

## Your commands after the patch lands

```bash
printf '%s' 'https://vital-records-access.lovable.app' | gh secret set CORS_ALLOWED_ORIGINS_PRODUCTION
printf '%s' 'true' | gh secret set GUARDIAN_READS_ENABLED_PRODUCTION
printf '%s' 'usEWzqPQVMNdv4R7k5I4DewZjC12,SMOKE-GUARDIAN-1' | gh secret set GUARDIAN_READS_ALLOWLIST_PRODUCTION
printf '%s' "$(cat ~/allow-new.txt)" | gh secret set ELATION_READ_ALLOWLIST_PRODUCTION
```

Then re-run the last **Deploy to Production** run from the Actions tab — not an empty commit;
`main` is branch-protected. The re-run re-reads secrets and rewrites `.env.prive-care-vip`.

Reminders carried over: these are **gen1** functions, so `gcloud functions deploy` without
`--source` would package the current directory and clobber the code — the workflow is the only
safe channel. `ELATION_READ_ALLOWLIST` gates on the **child** id, so `SMOKE-MINOR-1` must be in
it; `GUARDIAN_READS_ALLOWLIST` gates on the **guardian**.

## Inputs I need to make the patch exact

I don't have `deploy-production.yml` or the non-artifact function files in this workspace, so
two parts would otherwise be written blind:

- **`deploy-production.yml`** — paste it (or the env-writing step) and the wiring hunk will
  apply cleanly instead of being a described change.
- **The patient-facing function list** — either paste `functions/index.js`, or the output of
  `grep -rl ALLOWED_ORIGINS functions/`, and every one gets the swap.

Without them I'll ship the helper plus the three artifact readers as real hunks, and the
workflow wiring plus remaining files as a precise written diff you apply by hand. With them,
the whole thing is one `git apply`.
