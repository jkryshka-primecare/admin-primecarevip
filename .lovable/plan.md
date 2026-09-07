# Env-driven CORS for the pre-cutover smoke test

Two changes, one patch. Everything else (guardian flags, allowlist wiring, the fixture Auth
user) is already in place.

## 1. `functions/core/config/allowedOrigins.js` — make it env-driven

- Keep the current hardcoded entries as a **pinned base** (`https://care.primecarevip.com`,
  `http://localhost:5173`) that no environment value can remove. A dropped or clobbered
  variable can then only fail to add a test origin — it can never break production.
- Merge in `CORS_ALLOWED_ORIGINS` (comma-separated). Each entry is trimmed, lower-cased,
  de-duplicated, and must parse as an absolute `https://` origin with no path
  (`http://localhost:<port>` excepted). A bare host, a wildcard, a trailing path or anything
  unparseable is dropped, so `*` can never be produced from config.
- Read at call time, not module load, so tests can vary it without re-requiring.
- The module's existing export shape stays identical, so every consumer keeps working with no
  call-site change and CORS behavior is otherwise untouched: exact match only, `Vary: Origin`
  retained, headers on all responses including errors.
- Small unit test alongside it: base always present, valid extra added, `*` rejected, junk
  rejected, empty variable is a no-op.

## 2. `deploy-production.yml` — one variable through

Add `CORS_ALLOWED_ORIGINS: ${{ secrets.CORS_ALLOWED_ORIGINS_PRODUCTION }}` to the env block and
the matching `CORS_ALLOWED_ORIGINS=...` line in the `functions/.env.prive-care-vip` writer,
following exactly the form the three existing variables already use in that step (same
quoting, same ordering convention) so an unset secret writes an empty value rather than
`null`.

## Delivery

Patch in the same format as #495, applied with `git apply`. To make the workflow hunk apply
cleanly rather than being a described change, paste the env block and the
`.env.prive-care-vip` writer step from `deploy-production.yml` — plus the current
`allowedOrigins.js` if you want that hunk to be context-exact too. Without them I'll write
`allowedOrigins.js` as a full-file replacement and the workflow change as a precise two-line
instruction.

## Then

```bash
printf '%s' 'https://vital-records-access.lovable.app' | gh secret set CORS_ALLOWED_ORIGINS_PRODUCTION
```

Re-run the last **Deploy to Production** run from the Actions tab (not an empty commit —
`main` is branch-protected). Verify by re-running the failing `getMyPatientRecord` call from
the test URL and confirming the response carries `Access-Control-Allow-Origin` for that
origin, and that a call from `care.primecarevip.com` still does too. Remove the secret and
redeploy after the cutover.
