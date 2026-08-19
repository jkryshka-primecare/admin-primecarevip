# Release 2a — status of record (2026-08-19)

Reconciled with the repo agent after the merge of PR #421 (`release-2a/centralize-artifact-read`)
and the lockfile follow-up PR #422. Lovable's GitHub token is Actions-blind (403 on workflow runs),
so the runtime evidence below comes from the repo agent, not from a read of `main`.

## Closed

- **Code on `main`** — verified file by file: `readArtifact.js`, `repairQueue.js`, the three
  delegating wrappers (`!wantArtifact` list guard, audit-first `phi_access_log`, module pinned,
  `ttlSeconds: 300` hardcoded), `auditArtifactCoverage.js` + `sweepArtifactRepairs.js` registered in
  `index.js`, `adminRunArtifactAudit` in `ADMIN_FUNCTIONS`, `redteam.yml` with the bucket-prefix and
  prod-SA fixes, `package.json` / `helpers/env.js` test wiring.
- **Red-team gate** — stateful suite green (14 passed, 4 skipped) under
  `emulators:exec --only auth,firestore,storage`. Mutation performed: planted hole → RED → revert → green.
- **`REDTEAM_WEB_API_KEY`** — set (dummy value; the Auth emulator ignores it on custom-token exchange).
- **Production deploy** — green end to end. All six admin functions expose
  `serviceAccount:portal-admin@prive-care-vip.iam.gserviceaccount.com` as the only invoker,
  unauthenticated → 403. `getLabs` remains public by design.

## Deferred to the portal cutover gate

- **Live read-path smoke** on the Test Kieffer fixture (real lab PDF 200 + signed URL, hidden → 404,
  suspended → 403, plus one imaging and one medical-record artifact). The refactored functions are
  deployed but not yet live-serving; `care.primecarevip.com` is still the pre-Lovable portal.
- **Member-UI behavior changes — Lovable owns this.** See `mem://portal-artifact-contract`:
  300s TTL (re-request on expiry) and `{ state: 'preparing' }` rendered as a preparing state, not an
  error. Both must be handled before cutover.

## Open, owned by the repo agent

- **First audit/sweep observation.** Trigger `adminRunArtifactAudit` (or wait for the 03:15 schedule),
  read `artifact_coverage_reports/{runId}` for `coveragePct`, `totalReferenced`, `missing`,
  `truncatedWalk`; then let `sweepArtifactRepairs` run once and confirm the on-miss queue drains.

## Correction to carry into 2b

Do **not** use the step-6a reference-ownership check as a mutation target expecting RED — the
`category` match (5b) and the uid-scoped Storage path independently block cross-patient reads, so the
suite stays green. That also means the reference check is not independently covered. 2b follow-up:
add a case that seeds patient B's object under B's uid and points patient A's reference at it.
