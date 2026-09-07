# Wire `PORTAL_ALLOWED_ORIGINS` through the deploy pipeline

One file, two added lines: `.github/workflows/deploy-production.yml`.
`functions/core/config/allowedOrigins.js` is **not** touched — it already reads
`process.env.PORTAL_ALLOWED_ORIGINS` additively over its hardcoded baseline. The only gap was
that the workflow never populated the variable, so the additive path was dead in production.

## Diff

```diff
--- a/.github/workflows/deploy-production.yml
+++ b/.github/workflows/deploy-production.yml
@@ env: block of the env-file-writing step (~95-104)
             GUARDIAN_READS_ENABLED: ${{ secrets.GUARDIAN_READS_ENABLED_PRODUCTION }}
             GUARDIAN_READS_ALLOWLIST: ${{ secrets.GUARDIAN_READS_ALLOWLIST_PRODUCTION }}
+            PORTAL_ALLOWED_ORIGINS: ${{ secrets.PORTAL_ALLOWED_ORIGINS_PRODUCTION }}
@@ run: | block writing functions/.env.prive-care-vip (~111-122)
             echo "GUARDIAN_READS_ENABLED=${GUARDIAN_READS_ENABLED:-false}" >> functions/.env.prive-care-vip
             echo "GUARDIAN_READS_ALLOWLIST=${GUARDIAN_READS_ALLOWLIST:-}" >> functions/.env.prive-care-vip
+            echo "PORTAL_ALLOWED_ORIGINS=${PORTAL_ALLOWED_ORIGINS:-}" >> functions/.env.prive-care-vip
```

Both additions use the existing 10-space indentation and the same `:-` default form as the
line directly above them.

## Applying it

The two anchor lines are unique in the file, so this inserts both additions exactly once and
is safe to re-run (it exits without changes if `PORTAL_ALLOWED_ORIGINS` is already present):

```bash
f=.github/workflows/deploy-production.yml
grep -q 'PORTAL_ALLOWED_ORIGINS' "$f" && echo "already wired" || {
  perl -0pi -e 's{^(          GUARDIAN_READS_ALLOWLIST: \$\{\{ secrets\.GUARDIAN_READS_ALLOWLIST_PRODUCTION \}\}\n)}
                {$1          PORTAL_ALLOWED_ORIGINS: ${{ secrets.PORTAL_ALLOWED_ORIGINS_PRODUCTION }}\n}me;
                s{^(          echo "GUARDIAN_READS_ALLOWLIST=\$\{GUARDIAN_READS_ALLOWLIST:-\}" >> functions/\.env\.prive-care-vip\n)}
                {$1          echo "PORTAL_ALLOWED_ORIGINS=\${PORTAL_ALLOWED_ORIGINS:-}" >> functions/.env.prive-care-vip\n}me' "$f"
  grep -n 'PORTAL_ALLOWED_ORIGINS' "$f"
}
```

Expect exactly two matching lines in the output. If the indentation in your file differs from
the 10 spaces above, adjust the leading spaces in both patterns — everything else is literal.

## Behavior

| `PORTAL_ALLOWED_ORIGINS_PRODUCTION` | Written to `.env.prive-care-vip` | Effect |
|---|---|---|
| unset | `PORTAL_ALLOWED_ORIGINS=` | baseline origins only — live portal unaffected |
| `https://vital-records-access.lovable.app` | that value | baseline ∪ the test origin |

Set the secret after merge, then re-run the last **Deploy to Production** run from the Actions
tab (not an empty commit — `main` is branch-protected):

```bash
printf '%s' 'https://vital-records-access.lovable.app' | gh secret set PORTAL_ALLOWED_ORIGINS_PRODUCTION
```

Verify by re-running the failing `getMyPatientRecord` call from the test URL and confirming
the response carries `Access-Control-Allow-Origin` for that origin, and that a call from
`care.primecarevip.com` still does too. Remove the secret and redeploy after the cutover.

## Confirmation

No `GUARDIAN_READS_*`, `ELATION_*` or `ENFORCE_AUTH` line is modified, and
`functions/core/config/allowedOrigins.js` is untouched.

## Contract line

Append to `plans/INTEGRATION-CONTRACT.md`:

> `PORTAL_ALLOWED_ORIGINS` (additive CORS origins, comma-separated; unioned with the hardcoded
> baseline that always includes `https://care.primecarevip.com`) is now wired through
> `deploy-production.yml` from the `PORTAL_ALLOWED_ORIGINS_PRODUCTION` secret; unset means
> baseline only.
