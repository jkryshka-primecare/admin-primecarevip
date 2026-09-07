# Guardian smoke test: sign-in credential, read allowlist, and runtime flags

Answers to the three blockers, plus one small addition to the fixture script.

## 1. Sign-in credential for the fixture guardian

Correct — the fixture writes chart records only; nothing creates the sign-in account.
Correct — the fixture writes chart records only; nothing creates the sign-in account.
The sign-in uid and the `firebaseUid` on the guardian's chart record must be the same string,
and that string is what `GUARDIAN_READS_ALLOWLIST` matches. If you already created an account
(uid `usEWzqPQVMNdv4R7k5I4DewZjC12`), that uid wins and the script's placeholder must yield.

Planned change to `seed-guardian-fixture.js`:

- New `--guardian-uid=<uid>` flag, defaulting to the pinned placeholder: whatever is passed is
  written as the chart `firebaseUid`, used for the auth account, and echoed in the printout.
- New step in `seed()` (runs under `--apply`, printed in dry run): create the auth user with
  that uid, the fixture email, a password supplied via `--password=...` or the
  `SMOKE_GUARDIAN_PASSWORD` environment variable (never hardcoded, never printed back), email
  marked verified so no invite mail is needed.
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

## 3. Setting the flags on the deployed functions — do NOT use gcloud here

Confirmed by your describe: these are **1st-gen** functions (vars at top-level
`environmentVariables`, not `serviceConfig`). Two consequences:

- `gcloud functions deploy getLabs --update-env-vars ...` with no `--source` defaults to
  `--source=.` — the **current directory**. From a Cloud Shell without `functions/` it would
  package the wrong tree and clobber the deployed code. It is not source-safe. Do not run it.
- There is no gen1 "update env only" command; every env change is a full redeploy.

The correct channel is the one already used for allowlist appends (GO-LIVE.md):

1. Snapshot the current deployed values to `~/allow-deployed.txt` (your rollback artifact —
   not `/tmp`, Cloud Shell wipes it):
   ```bash
   gcloud functions describe getLabs --region=us-central1 --project=prive-care-vip \
     --format='value(environmentVariables)' > ~/allow-deployed.txt
   ```
2. Build the new `ELATION_READ_ALLOWLIST` as `<old>,SMOKE-MINOR-1,SMOKE-GUARDIAN-1` with
   `printf '%s'` (no trailing newline), keeping all ~800 existing ids.
3. Set the repository secrets and re-run the workflow:
   ```bash
   printf '%s' "$(cat ~/allow-new.txt)" | gh secret set ELATION_READ_ALLOWLIST_PRODUCTION
   printf '%s' 'true' | gh secret set GUARDIAN_READS_ENABLED_PRODUCTION
   printf '%s' 'usEWzqPQVMNdv4R7k5I4DewZjC12,SMOKE-GUARDIAN-1' | gh secret set GUARDIAN_READS_ALLOWLIST_PRODUCTION
   ```
   Confirm those secret names against `deploy-production.yml` before running — if
   `GUARDIAN_READS_*` are not yet wired into the workflow's `.env.prive-care-vip` writer, that
   wiring is a one-line workflow change and must land first, or the redeploy silently drops them.
4. Re-run the last **Deploy to Production** run from the Actions tab (not an empty commit —
   `main` is branch-protected). The re-run re-reads secrets and rewrites
   `functions/.env.prive-care-vip`.

Verification, content-based rather than CI-green: `sorted diff` of old vs new
`ELATION_READ_ALLOWLIST` shows exactly two `>` lines (the two fixture ids) and N → N+2, and
`updateTime` advanced on `getLabs`, `getImaging` and `getMedicalRecords` — the D-071 silent
no-op trap.

Your intended values are right, with two notes:

- Replacing `GUARDIAN_READS_ALLOWLIST` (currently `hpqpnevnzuveuph0nu0v3yrqsz02`) removes that
  existing canary guardian. Record it in the rollback file if it is still wanted.
- Matching is case-insensitive on both sides, so `usEWzqPQVMNdv4R7k5I4DewZjC12` matches fine —
  but that uid must be the one stored as `firebaseUid` on the guardian's chart record, so seed
  the fixture with that uid rather than the placeholder in the script.

`getImaging` and `getMedicalRecords` are the same gen1 setup and read the same three
variables through the shared read path, so all three must carry identical values — which the
`.env.prive-care-vip` route gives you automatically, and per-function gcloud edits would not.


## Deliverable

One file changes: `firebase-handoff/portal-testfixture/seed-guardian-fixture.js` — the auth
user create/update on seed, the delete on cleanup, and an updated "next steps" printout that
lists both allowlists with the exact ids.
