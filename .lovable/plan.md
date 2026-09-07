# CORS patch — env-driven allowed origins

Two files. Nothing else is touched, and no guardian/elation env wiring is modified.

## 1. `functions/core/config/allowedOrigins.js`

Replace the hardcoded array with a baseline-union-env list:

- **Baseline, hardcoded and never removable:** `https://care.primecarevip.com`,
  `http://localhost:5173`. A bad or empty secret can never take the live portal offline.
- **Additive from env:** read `process.env.CORS_ALLOWED_ORIGINS`, split on comma, `.trim()`
  each entry, drop empties.
- **Final list** = baseline ∪ env, de-duplicated, baseline first. Exact-match string compare
  is preserved — no normalisation, no wildcards, no regex.
- Unset or empty `CORS_ALLOWED_ORIGINS` yields exactly the current baseline array: zero
  behavior change when the secret is not set.
- Export shape and every existing helper signature stay byte-compatible, so no call-site in
  the CORS middleware changes. Env is read at call time so a value set after module load
  still applies.

Deliverable: the full new file content, pasteable.

## 2. `.github/workflows/deploy-production.yml` — one added line

In the step that writes `functions/.env.prive-care-vip`, add, matching the existing pattern:

```
echo "CORS_ALLOWED_ORIGINS=${CORS_ALLOWED_ORIGINS}" >> functions/.env.prive-care-vip
```

and map the secret into that step's `env:` block the same way the other `*_PRODUCTION`
secrets are mapped:

```
CORS_ALLOWED_ORIGINS: ${{ secrets.CORS_ALLOWED_ORIGINS_PRODUCTION }}
```

Unset → empty value written → baseline only, which is safe. Every
`GUARDIAN_READS_*` and `ELATION_READ_ALLOWLIST` line is left exactly as-is.

Deliverable: the diff with surrounding context so you can see it lands in the right block.
Since I don't have the workflow file here, the context lines are reconstructed from the
pattern you quoted — if the hunk doesn't apply cleanly, paste the step and I'll re-cut it.

## 3. Contract note

One line for `plans/INTEGRATION-CONTRACT.md` recording that allowed CORS origins are now
env-driven via `CORS_ALLOWED_ORIGINS`, with the baseline always including
`care.primecarevip.com`.

## Not done here

The secret value is yours to set after merge; I set nothing.
