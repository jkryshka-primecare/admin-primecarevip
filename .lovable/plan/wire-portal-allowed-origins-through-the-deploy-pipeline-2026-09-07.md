# Wire PORTAL_ALLOWED_ORIGINS through the deploy pipeline

One file, two added lines: `.github/workflows/deploy-production.yml`.
`functions/core/config/allowedOrigins.js` is not touched.

## Diff

```diff
@@ env: block of the env-file-writing step
             GUARDIAN_READS_ENABLED: ${{ secrets.GUARDIAN_READS_ENABLED_PRODUCTION }}
             GUARDIAN_READS_ALLOWLIST: ${{ secrets.GUARDIAN_READS_ALLOWLIST_PRODUCTION }}
+            PORTAL_ALLOWED_ORIGINS: ${{ secrets.PORTAL_ALLOWED_ORIGINS_PRODUCTION }}
@@ run: | block writing functions/.env.prive-care-vip
             echo "GUARDIAN_READS_ENABLED=${GUARDIAN_READS_ENABLED:-false}" >> functions/.env.prive-care-vip
             echo "GUARDIAN_READS_ALLOWLIST=${GUARDIAN_READS_ALLOWLIST:-}" >> functions/.env.prive-care-vip
+            echo "PORTAL_ALLOWED_ORIGINS=${PORTAL_ALLOWED_ORIGINS:-}" >> functions/.env.prive-care-vip
```

Both additions use the existing 10-space indentation and the same `:-` default form as the
line above them. Unset secret → empty value → baseline-only origins, so the live portal is
unaffected either way.

No `GUARDIAN_READS_*`, `ELATION_*` or `ENFORCE_AUTH` line is modified, and
`allowedOrigins.js` is untouched.

## Contract note

One line appended to `plans/INTEGRATION-CONTRACT.md`:

> `PORTAL_ALLOWED_ORIGINS` (additive CORS origins, comma-separated; unioned with the hardcoded
> baseline that always includes `https://care.primecarevip.com`) is now wired through
> `deploy-production.yml` from the `PORTAL_ALLOWED_ORIGINS_PRODUCTION` secret; unset means
> baseline only.

## Not done here

The secret value stays yours to set after merge.
