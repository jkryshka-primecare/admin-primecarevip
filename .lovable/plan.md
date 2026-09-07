# Guardian smoke test: sign-in credential, read allowlist, and runtime flags

Answers to the three blockers, plus one small addition to the fixture script.

## 1. Sign-in credential for the fixture guardian

Correct — the fixture writes chart records only; nothing creates the sign-in account.
The account has to be created with the exact uid `smokeguardianuid000000000001`, because
that string is what the chart record stores as `firebaseUid` and what the allowlist matches.

Planned change to `seed-guardian-fixture.js`:

- New step in `seed()` (runs under `--apply`, printed in dry run): create the auth user with
  the pinned uid, the fixture email, a password supplied by the operator via
  `--password=...` or the `SMOKE_GUARDIAN_PASSWORD` environment variable (never hardcoded,
  never printed back), email marked verified so no invite mail is needed.
- Idempotent: if the uid already exists, update email/password instead of failing, and
  refuse if an existing account with that uid carries a different, non-fixture email.
- `--cleanup --apply` deletes the auth user too, so teardown stays complete.
- If no password is supplied, the script skips the auth step and says so — it never invents one.

The guardian then signs in at the portal with `guardian-test-1@primecarevip.com` and that
password, and switches into "Test Dependent".

## 2. D-068 read allowlist — yes, still enforced, and it gates on the child

The shared read path checks `ELATION_FULL_SYNC_ENABLED === 'true'`, and only if that is not
set does it require the id to be present in `ELATION_READ_ALLOWLIST`. The id it checks is the
**subject** of the read — for a guardian read that is the child. So for the smoke test:

- `ELATION_READ_ALLOWLIST` must contain `SMOKE-MINOR-1` (add `SMOKE-GUARDIAN-1` too if you
  want the guardian's own records readable).
- `GUARDIAN_READS_ALLOWLIST` must contain the guardian, not the child:
  `smokeguardianuid000000000001,SMOKE-GUARDIAN-1`.

Missing the child in `ELATION_READ_ALLOWLIST` produces a 403 "Records access is not enabled
for this account yet", which is a different failure from the guardian gate (which answers as
absence, 404) — useful to tell the two apart during the run.

## 3. Setting the flags on the deployed functions

The values are read from `process.env` at request time, so they are per-function runtime
environment variables — there is no config document, and nothing picks them up without an
update to the function. Three functions serve artifacts and must all carry the flags:
`getLabs`, `getImaging`, `getMedicalRecords`.

`--update-env-vars` merges (it does not clear the others). Comma-separated values need the
alternate delimiter, otherwise gcloud splits them into separate variables:

```bash
for FN in getLabs getImaging getMedicalRecords; do
  gcloud functions deploy "$FN" \
    --region=us-central1 \
    --project=prive-care-vip \
    --update-env-vars "^@^GUARDIAN_READS_ENABLED=true@GUARDIAN_READS_ALLOWLIST=smokeguardianuid000000000001,SMOKE-GUARDIAN-1@ELATION_READ_ALLOWLIST=SMOKE-MINOR-1,SMOKE-GUARDIAN-1"
done
```

Note this rewrites `ELATION_READ_ALLOWLIST` wholesale — read the current value first and
append the two fixture ids to it rather than replacing it:

```bash
gcloud functions describe getLabs --region=us-central1 --project=prive-care-vip \
  --format='value(serviceConfig.environmentVariables)'
```

Turning it back off after the smoke test:

```bash
for FN in getLabs getImaging getMedicalRecords; do
  gcloud functions deploy "$FN" --region=us-central1 --project=prive-care-vip \
    --update-env-vars GUARDIAN_READS_ENABLED=false
done
```

Setting `GUARDIAN_READS_ENABLED=false`, or clearing the allowlist, denies every guardian read
— the gate fails closed by design.

If your deploy pipeline owns the runtime environment (a `functions/.env.<project>` file or the
deploy workflow), make the same change there as well, or the next production deploy will
silently drop the flags.

## Deliverable

One file changes: `firebase-handoff/portal-testfixture/seed-guardian-fixture.js` — the auth
user create/update on seed, the delete on cleanup, and an updated "next steps" printout that
lists both allowlists with the exact ids.
