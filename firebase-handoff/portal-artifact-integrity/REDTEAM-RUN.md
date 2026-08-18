# Release 2a — red-team gate: run evidence

## How the gate is wired

- `.github/workflows/redteam.yml` runs on **every pull request**: the stateful
  suite under the emulator, then the read-only bucket-privacy suite against the
  real production bucket. It is deliberately NOT part of
  `deploy-production.yml`, so a red-team failure can never wedge an unrelated
  production deploy.
- `test:redteam` is scoped to `test/redteam/artifact-ownership.test.js` only.
  `bucket-privacy.test.js` must NOT run under the emulator (no bucket IAM there);
  it runs via `test:redteam:readonly` with real credentials.
- `emulators:exec` exports `FIREBASE_STORAGE_EMULATOR_HOST`; `helpers/env.js`
  normalizes it into `STORAGE_EMULATOR_HOST` at load, so no extra CI wiring is
  needed. `firebase.json` now declares the `storage` emulator (port 9199)
  alongside `auth` and `firestore`.
- Required env in CI: `REDTEAM_ALLOW_WRITES`, `REDTEAM_PROJECT_ID`,
  `REDTEAM_STORAGE_BUCKET`, `REDTEAM_WEB_API_KEY` (repo secret).

## Status of the two required runs

**Not yet executed. They must be run by a human (or by CI) before this PR is merged.**

The assembling environment has no JDK (the Firebase emulator suite requires one)
and — more importantly — no credentials for a Firebase test project. The stateful
suite deliberately refuses to run without one: `test/redteam/helpers/env.js`
aborts unless `FIRESTORE_EMULATOR_HOST` or `REDTEAM_TARGET` resolves to a
non-production target, and `seedPatient()` mints **real** custom tokens while
`seedDocument()` writes **real** objects. Faking either would turn the gate into
theatre, so nothing was stubbed and no run output is fabricated here.

What was verified in assembly:

- every changed/added file passes `node --check` (syntax clean);
- `.github/workflows/deploy-production.yml` parses as valid YAML after the edit;
- `test/redteam/helpers/portalRead.js` resolves
  `../../../functions/core/services/artifacts/readArtifact` — the module now
  exists at that path in this branch, which is the failure the earlier finding
  reported.

## Run 1 — the gate must be green

```bash
# from the repo root, against the emulator (or a dedicated test project)
pnpm install --no-frozen-lockfile
npm run test:redteam            # emulators:exec ... jest test/redteam/artifact-ownership.test.js
# read-only privacy checks only (safe against the production bucket):
npm run test:redteam:readonly
```

Paste the full jest summary here.

## Run 2 — the mutation check (the gate must go RED)

The gate is only trustworthy once it has been watched failing. Short-circuit the
**reference-ownership** check in `functions/core/services/artifacts/readArtifact.js`
— the step that requires `patients/<elationPatientId>/labs/<reportId>` to exist,
not be tombstoned, and to belong to the caller — then re-run:

```diff
-  const refSnap = await admin.firestore()
-    .collection('patients').doc(elationPatientId)
-    .collection('labs').doc(reportId)
-    .get();
-  if (!refSnap.exists || refSnap.get('deleted') === true) {
-    throw notFound();            // 404, and NO repair is enqueued
-  }
+  // MUTATION CHECK ONLY — never commit this.
+  const refSnap = { exists: true, get: () => undefined, data: () => ({}) };
```

```bash
npm run test:redteam            # expected: RED — cross-patient + steering cases fail
git checkout -- functions/core/services/artifacts/readArtifact.js
npm run test:redteam            # expected: green again
```

Paste **both** outputs here. Cases expected to flip red under the mutation:

- `patient A cannot read patient B artifact by guessing the path`
- `enqueue ignores any caller-supplied patient id`
- `a hidden lab cannot be laundered through another wrapper (cross-calling)`
- `a visible lab is still not servable through the imaging wrapper`

## Post-merge smoke test (production, read-only)

- `adminRunArtifactAudit` is private: no `allUsers`, `portal-admin` invoker only,
  403 unauthenticated (the IAM-hardening step in `deploy-production.yml` now
  covers it).
- On the Test Kieffer fixture: a real lab PDF opens (200 + signed URL), a hidden
  item returns 404, a suspended patient returns 403, and one imaging + one
  medical-record artifact each open — three wrappers, three checks.
