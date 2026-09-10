# Guardian reads — go-live evidence and close-out (2026-09-09)

Verdict: **CLOSED / GO**. Guardian reads stay live.

## Live config at close-out

| Item | Value |
|---|---|
| `GUARDIAN_READS_ENABLED` | `true` |
| `GUARDIAN_READS_ALLOWLIST` | `*` (containment rests entirely on the guardian→child link) |
| `dependentBirthdaySweep` | deployed, scheduled 07:15 ET daily, clean, 0 aged-out backlog, next age-out **19 Oct 2026** |
| Guardian identity backfill | applied — 45 `READY_BOUND` guardians |
| Domain | `care.primecarevip.com` live on the hub |
| Deployed SHA | `432bc4f` (carries PR #509 red-team tests) |

## Checklist items ticked

### 1. Red-team suite green — TICKED
CI green on the emulator at the deployed SHA `432bc4f`; PR #509 merged, so the deployed
build and the tested commit are the same tree. New coverage in that PR:

- mixed-case stored `guardianUid` authorizes the lower-cased caller (D-016 vs D-112 drift);
- case folding does **not** widen the match to a near-miss uid;
- D-068 `ELATION_READ_ALLOWLIST` enforced on the **child** subject, not the guardian;
- D-068 fails closed on an empty allowlist.

Pre-existing coverage: Path A (bound uid) / Path B (chart id) authorization, revoked
entries, `pending_adult_consent`, guardian-of-A vs child B, shared-email independence,
email-only (unbound) links denied on all three wrappers, suppression parity, audit lines.

### 2. Real-guardian E2E — TICKED
Live guardian `qyxjrae3lghwppssprabhfatjqs2` (Lainey) signed into the hub on the real
origin, sees exactly her two bound dependents and no others.

### 3. D-304 read-path canary against production

| Line | Case | Result |
|---|---|---|
| 1 | subject read (adult self) | **PASS** — signed URL served a real 738 KB `%PDF-` |
| 7 | cross-child isolation / deny | **PASS** — real family: guardian → unlinked minor → 404 `RECORD_NOT_AVAILABLE`; also PASS on the fixture. `failed: 0`, no `preparing` leak |
| 6 | guardian → linked minor: 200 + PDF | **not exercised — test-data gap** |

### Line 6: proven by composition (accepted)

No production child currently has both an active guardian link **and** a lab with
`hasArtifact: true`. Lainey's linked children have no lab PDF; `SMOKE-MINOR-1` has a PDF
but the smoke never creates a guardian entry for it. This is a fixture gap, not a defect.

Line 6 is the conjunction of two independently green halves:

- **guardian authorization for the subject** — proven by line 7 (the deny half, on a real
  family), by the real-guardian E2E (the allow half: the correct two dependents resolve and
  list), and by the merged red-team resolver cases which exercise the authorized guardian
  → linked-child serve path in full, including the signing step;
- **artifact serving for an authorized subject** — proven by line 1 (real signed URL, real
  `%PDF-` body) on the same deployed code path; `readArtifact` runs one serve path for all
  callers, with the guardian check preceding it, not replacing it.

Recorded as **proven by composition**, with fast-follow (a) below to make it literal on the
next canary run.

## DECISION LOG

- **D-309 — guardian reads go-live closed on composed line-6 evidence (2026-09-09).**
  Red-team suite green in CI at deployed SHA `432bc4f` (PR #509), D-304 canary lines 1 and 7
  green against production, real-guardian E2E green. Canary line 6 could not be exercised
  literally for want of a child holding both an active guardian link and an artifact-backed
  lab. Accepted as proven by composition (line 7 + E2E for authorization, line 1 for
  serving, red-team for the joined path). Reversal is unchanged and immediate:
  `GUARDIAN_READS_ENABLED_PRODUCTION=false` + redeploy.
- **D-309a — containment now rests solely on the guardian→child link.** With
  `GUARDIAN_READS_ALLOWLIST=*`, the uid allowlist is no longer a fence. The red-team
  guardian mutation check (REDTEAM-RUN.md, run 2b) is therefore the only evidence the link
  check works and must not be skipped on future changes to `resolveGuardianAccess`.

## Fast-follows

### (a) Make canary line 6 literal — before the next canary run
Either seed a guardian + child + lab-artifact fixture, or identify a real family that
qualifies:

- preferred: extend `firebase-handoff/portal-testfixture/seed-guardian-fixture.js` so
  `SMOKE-MINOR-1` (which already carries a real lab PDF) also gets an **active guardian
  entry** for `SMOKE-GUARDIAN-1` — dry-run first, `--apply` required, and it must remain
  the only writer of that fixture;
- ensure the child is in `ELATION_READ_ALLOWLIST` (D-068 gates the subject);
- then re-run `adminRunReadPathSmoke` and expect line 6 = 200 with a `%PDF-` body and
  `failed: 0`.

Alternative, no new fixture: watch for the first real linked minor to receive an
artifact-backed lab, then run the canary against that family.

Owner: unassigned. Due: before the next scheduled canary.

### (b) Arm the invite-failed Cloud Logging alert — before 19 Oct 2026
`dependentBirthdaySweep` invites each newly-converted adult. A failed invite leaves a real
person with no guardian proxy and no account of their own, silently. The metric and policy
are already written up in `firebase-handoff/portal-dependents/sweep-invite-failed-alert.md`
(log-based metric `sweep_invite_failed`, count > 0 over 10 minutes, 24h auto-close, routed
to the artifact-repair `parked` channel). It is **not yet created**.

Must be live before the first real age-out on **19 Oct 2026**.

Owner: unassigned. Due: 2026-10-12 (one week of headroom).

## Still open, unchanged by this close-out

- Weekly `ELATION_READ_ALLOWLIST` reconciliation stays manual until #496 lands.
- Guardian onboarding backlog: 90 `CHART_NO_ACCOUNT`, 38 `NO_CHART_NO_ACCOUNT`,
  1 `ACCOUNT_NO_CHART`. Claim-time bind + invite campaign remain the fast-follow track.
