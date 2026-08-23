# Step 1 — load guardian links against production (Cloud Shell)

`adminLinkGuardian` is invoker-locked to `portal-admin@prive-care-vip.iam.gserviceaccount.com`.
No key is ever downloaded: you impersonate that SA from your own admin identity.

## 0. One-time grant (an owner runs this once)

```bash
PROJECT=prive-care-vip
gcloud iam service-accounts add-iam-policy-binding \
  portal-admin@$PROJECT.iam.gserviceaccount.com --project=$PROJECT \
  --member="user:YOU@primecarevip.com" \
  --role="roles/iam.serviceAccountTokenCreator"
```

## 1. Get the script + CSV into Cloud Shell

```bash
cd ~
git clone <prime-care-os repo url> prime-care-os      # or: cd ~/prime-care-os && git pull
cd ~/prime-care-os/firebase-handoff/portal-dependents
npm init -y >/dev/null 2>&1 || true
npm install google-auth-library
```

The CSV: use Cloud Shell's **⋮ → Upload** to drop `guardianlinks20260823.csv` into
`~` , then:

```bash
cp ~/guardianlinks20260823.csv ~/prime-care-os/firebase-handoff/portal-dependents/
```

Header row must be exactly:

```
minor_name,minor_dob,minor_elation_id,minor_hint_id,guardian_name,guardian_email,guardian_elation_id,guardian_hint_id,match_source,confirmed_at
```

Sanity-check row/id counts before anything else:

```bash
CSV=~/prime-care-os/firebase-handoff/portal-dependents/guardianlinks20260823.csv
tail -n +2 $CSV | wc -l                      # expect 194 links
tail -n +2 $CSV | cut -d, -f3 | sort -u | wc -l   # expect 174 unique minors
```

## 2. Authenticate (impersonation, no key file)

```bash
gcloud config set project prive-care-vip
gcloud auth application-default login \
  --impersonate-service-account=portal-admin@prive-care-vip.iam.gserviceaccount.com
```

This writes an ADC file containing only your user credentials plus an
impersonation URL. `GoogleAuth.getIdTokenClient()` in the script then mints an
identity token **as portal-admin**, with `aud` = the function URL — exactly what
`requireAdminCaller` checks.

Verify before touching data:

```bash
gcloud auth application-default print-access-token >/dev/null && echo ADC_OK
```

## 3. The three staged invocations

```bash
cd ~/prime-care-os/firebase-handoff/portal-dependents
CSV=./guardianlinks20260823.csv
ACTOR=you@primecarevip.com

# 3a. Full dry run — writes nothing, prints every intended link.
node scripts/load-guardian-links.js --csv $CSV --actor $ACTOR | tee dryrun.log
grep -c 'would link' dryrun.log       # expect 194
grep 'SKIP' dryrun.log                # expect none

# 3b. One-child apply (the fixture minor). Verify in Firestore before going wide.
node scripts/load-guardian-links.js --csv $CSV --actor $ACTOR \
  --only-minor 1252809063464961 --apply

# 3c. Full batch.
node scripts/load-guardian-links.js --csv $CSV --actor $ACTOR --apply | tee apply.log
tail -3 apply.log                     # linked=194 failed=0 skipped=0
```

Between 3b and 3c, confirm the fixture doc:

```bash
gcloud firestore documents describe \
  "projects/prive-care-vip/databases/(default)/documents/patients/1252809063464961" \
  --format=json | grep -A5 guardians
```

Failures land in `guardian-load-failures.json`. The script is idempotent per
`(child, guardian)` pair, so a partial run is safe to re-run with `--apply`.

## Preconditions

Step 0 must be done first: the 174 minor `patients/<elationId>` docs must exist
(Provision Missing dialog with **Adults only (18+)** off). `linkGuardian`
returns `CHILD_NOT_FOUND` for any missing doc.

## Rollback

`adminRevokeGuardian` per (child, guardian) pair. No bulk undo — this is why 3b
exists.
