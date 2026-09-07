# D-304 / #488 — running the read-path canary against the live guardian fixture

Goal: a green `adminRunReadPathSmoke` **including the guardian arm** before
`GUARDIAN_READS_ALLOWLIST` is widened to `*`.

## 0. Prerequisites

| Thing | Value |
|---|---|
| Guardian uid | `usewzqpqvmndv4r7k5i4dewzjc12` (matching is case-insensitive) |
| Guardian chart id | `SMOKE-GUARDIAN-1` |
| Linked child (positive) | `SMOKE-MINOR-1` |
| Unlinked child (negative) | `SMOKE-MINOR-2` — **must be seeded, see §2** |

The guardian arm only runs when, on the *functions runtime*:
`GUARDIAN_READS_ENABLED=true` **and** `GUARDIAN_READS_ALLOWLIST` contains the
guardian uid or `SMOKE-GUARDIAN-1`. Otherwise both guardian lines come back
`SKIP` with the reason — never a silent pass.

## 1. Invoking it

`adminRunReadPathSmoke` is an **HTTP admin function** behind two gates:

1. Cloud Functions IAM (`roles/cloudfunctions.invoker`), and
2. `requireAdminCaller` — a **Google OIDC identity token** whose `email` is
   `portal-admin@prive-care-vip.iam.gserviceaccount.com` and whose `aud` is the
   function's own URL.

`SMOKE_WEB_API_KEY` is *not* a caller credential — it lives on the runtime and
is only used inside the function to mint the fixture's patient token.

### Preferred: the admin OS button

**Admin → Artifact Coverage → Run read-path smoke.** The `portal-admin` edge
function already holds that identity, and the run is audited. Nothing to set up.

### Cloud Shell (needs `roles/iam.serviceAccountTokenCreator` on `portal-admin`)

```bash
PROJECT=prive-care-vip
REGION=us-central1
URL="https://${REGION}-${PROJECT}.cloudfunctions.net/adminRunReadPathSmoke"

TOKEN=$(gcloud auth print-identity-token \
  --impersonate-service-account="portal-admin@${PROJECT}.iam.gserviceaccount.com" \
  --audiences="$URL" \
  --include-email)

curl -sS -X POST "$URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
        "guardianUid":       "usewzqpqvmndv4r7k5i4dewzjc12",
        "guardianElationId": "SMOKE-GUARDIAN-1",
        "childPatientId":    "SMOKE-MINOR-1",
        "otherChildId":      "SMOKE-MINOR-2"
      }' | tee ~/canary.json | node -e '
const r=JSON.parse(require("fs").readFileSync(0,"utf8"));
console.log(`passed ${r.passed}  failed ${r.failed}  skipped ${r.skipped}`);
for (const x of r.results) console.log(`${x.skipped?"SKIP":x.pass?"PASS":"FAIL"}  ${x.name}${x.detail?" — "+x.detail:""}`);
console.log("guardianFixture:", JSON.stringify(r.guardianFixture,null,2));'
```

Notes:
- Do **not** pass `patientId` — anything other than the configured fixture is
  rejected with 400 by design.
- The four guardian ids are body fields precisely so minors' ids stay out of
  GitHub Secrets and the durable `.env`. `SMOKE_GUARDIAN_UID` /
  `SMOKE_GUARDIAN_ELATION_ID` / `SMOKE_CHILD_PATIENT_ID` / `SMOKE_OTHER_CHILD_ID`
  remain the fallback if you'd rather set them on the runtime.
- `401 BAD_AUDIENCE` → `--audiences` didn't match the URL exactly.
  `403 CALLER_NOT_ALLOWED` → the token isn't the `portal-admin` SA (missing
  `--include-email` or no impersonation).

## 2. The unlinked second child

The guardian fixture seeds **one** minor. It does **not** seed the isolation
child, so without this step the negative assertion is `SKIP`, and the canary is
not green in the sense that matters.

```bash
cd ~ && mkdir -p isofix && cd isofix
npm init -y >/dev/null && npm i firebase-admin@12
# copy seed-isolation-minor-fixture.js here
gcloud config set project prive-care-vip
gcloud auth application-default login          # if not already
node seed-isolation-minor-fixture.js           # dry run — prints intended writes
node seed-isolation-minor-fixture.js --apply
```

It creates `patients/SMOKE-MINOR-2` (`Test Unrelated`, `_testSeed: true`, **no
guardians array**) plus one signed lab with a real PDF object. Teardown:
`node seed-isolation-minor-fixture.js --cleanup --apply`.

**Yes — add `SMOKE-MINOR-2` to `ELATION_READ_ALLOWLIST`**, the same careful way
you added `SMOKE-MINOR-1`. The read path checks the *subject's* id against that
allowlist before it ever reaches the guardian gate. Leave it out and the child
is refused at the account level: the canary still records `PASS` (403 with no
leak), but it proves the wrong control. With the child allowlisted, the only
thing that can produce the denial is guardian containment.

The canary also hard-FAILS if `SMOKE-MINOR-2` ever carries an active link to
this guardian — the negative case can't be quietly turned into a second
positive.

## 3. Reading the output

Top level: `passed`, `failed`, `skipped`. **Green = `failed: 0` and neither
guardian line skipped.** Check `guardianFixture` on every run:

```
"enabled": true,       // the arm actually ran
"flag": true,          // GUARDIAN_READS_ENABLED
"scoped": true,        // allowlist is a real list, not "*"
"failClosed": false,   // allowlist is non-empty
"fixtureSources": { "childPatientId": "body", ... }
```

`enabled: false` means both guardian lines are `SKIP` — that is *not* a pass.

The two lines that gate the flip:

```
PASS  6. guardian -> linked minor: 200 + signed URL serves PDF bytes
      — GET 200, 1043 bytes, magic=%PDF-            <-- POSITIVE
PASS  7. guardian -> UNLINKED minor: denied (cross-child isolation)
      — 404 ARTIFACT_NOT_SYNCED                     <-- NEGATIVE
```

Line 6 passes only on a 200 **with** a signed URL that really returns `%PDF-`
bytes. Line 7 passes only on 403/404 **with no leak** — a 200, a signed URL, or
even a calm `{ state: 'preparing' }` counts as a leak and fails, because
`preparing` would confirm the record exists.

Lines 1–5 plus `portalAccess restored to its pre-smoke state` are the existing
solo-patient arm; `5. imaging/records` may legitimately `SKIP` when the fixture
holds no such document. Signing errors on 1/5/6 print the explicit fix: the
runtime SA needs `roles/iam.serviceAccountTokenCreator` **on itself**.

## 4. Before flipping to `*`

Keep the run's JSON (`~/canary.json`) as the D-304 evidence artifact: it records
`allowlistSize`, `scoped: true`, and both guardian assertions passing while the
allowlist was still narrow. After widening, re-run — `guardianFixture.global`
should read `true` and lines 6 and 7 must both still pass.
