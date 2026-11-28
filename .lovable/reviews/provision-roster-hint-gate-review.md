# #636 — Hint-membership gate review

**Draft PR:** https://github.com/primecarevip/prime-care-vip-app-v2/pull/637  
**Issue:** Closes #636  
**Branch:** `fix/provision-roster-hint-gate`  
**Base/current main:** `1d77a914a41d0b762f9ab443029ed7c408238e27`  
**Head:** `b8c8ceaa040293480c1ce46bb1e0326aae1610b7`  
**State:** draft, unmerged, conflict-free; one commit ahead / zero behind main at final verification.

## Result

Only the backfill handler SELECT loop changed: existing-doc and cohort checks → shared age gate → shared Hint lookup + exact name/DOB active-membership matcher → existing builder. Only HINT_SINGLE_ACTIVE proceeds. Non-member, inactive, ambiguous, partial/unavailable Hint data and unexpected errors fail closed before building, roster writes or internalUid minting. Eligible candidates alone occupy cap slots.

Successful and rejected surname lookups are cached by lowercase surname within the run. Each chart still gets its own membership decision. Typed errors retain fixed HINT_* reason counts; unexpected errors use HINT_UNAVAILABLE, never raw diagnostic text.

## Verify-first

1. Deployed main is #635: Deploy #717 succeeded; live provisionRosterDocs ACTIVE at 2026-11-27T22:38:53.527Z, Appspot runtime. Before this PR SELECT had doc/cohort/age but no Hint gate.
2. Shared discovery lookup and matchActiveMembership confirmed; matcher returns the four specified reason values. No helper modified.
3. Owner supplied empirical same-runtime proof: successful Hint lookups, 8 HINT_SINGLE_ACTIVE members provisioned in a recent tick and 33 discovery docs total. Accepted as satisfying the prerequisite; diagnostic IAM-read 403 did not indicate function-runtime denial. No further IAM grant, secret payload read or production invocation performed.

## Exactly four portal files

- functions/provisionRosterDocs.js
- functions/test/unit/roster-provision.test.cjs
- plans/DECISION-LOG.md — appended amendment, historical bytes preserved.
- plans/INTEGRATION-CONTRACT.md — prepended amendment, historical bytes preserved; additive HINT_* skips and active-members-only all_missing_doc.

Published file bytes match the tested local source. No discovery, evaluator, matcher, Hint client, builder, cohort/cap/auth, workflow/rules, dependency, account/claim or configuration changes.

## Local verification: 121 passed

- 38 roster-provision tests: 20 existing + 18 new actual-handler cases. Real builder, age evaluator and matcher; external services mocked.
- 51 discovery regression tests.
- 32 hydration queue/worker/Recovery/drain/invite-age tests.
- Syntax check passed.
- Mutation check passed: all 18 new cases reject the original handler without the membership gate.

New cases cover the five-member dry/live fixture in both cohorts, active-only candidate/build/write/mint outputs, skipped reasons, age-first minor/unknown exclusion, successful case-insensitive caching, every typed Hint failure in dry/live, unknown-error fallback and rejected-promise caching with per-candidate counts.

Reproduce locally from the PR branch:

```sh
node --check functions/provisionRosterDocs.js
node functions/test/unit/roster-provision.test.cjs
node functions/test/unit/roster-discovery-d406.test.cjs
node --test functions/test/unit/claim-hydration-queue.test.cjs functions/test/unit/claim-hydration-worker.test.cjs functions/test/unit/hydration-recovery.test.cjs functions/test/unit/hydration-drain-d319.test.cjs functions/test/unit/invite-age.test.cjs
```

## Hosted verification: all 13 runs green

12 distinct workflows, including two TruffleHog event runs, passed on this exact head. No manual gate dispatch.

Full claim-hydration-gate run: https://github.com/primecarevip/prime-care-vip-app-v2/actions/runs/46090219873

Verified real steps **success**, not a no-op:
- Hydration queue, worker and Recovery tests.
- Real Firestore client-deny rules and C4 guards.
- Real Auth + Firestore patient reset, adoption and claim reservation.
- No-relevant-changes trivial-pass step **skipped**.

- Red-team (artifact ownership + bucket privacy): success — https://github.com/primecarevip/prime-care-vip-app-v2/actions/runs/46090219848
- TruffleHog Secret Scan: success — https://github.com/primecarevip/prime-care-vip-app-v2/actions/runs/46090219827
- TruffleHog Secret Scan: success — https://github.com/primecarevip/prime-care-vip-app-v2/actions/runs/46090198550
- auto-invite-test: success — https://github.com/primecarevip/prime-care-vip-app-v2/actions/runs/46090220009
- claim-hydration-gate: success — https://github.com/primecarevip/prime-care-vip-app-v2/actions/runs/46090219873
- invite-send-safety: success — https://github.com/primecarevip/prime-care-vip-app-v2/actions/runs/46090219868
- invite-status-test: success — https://github.com/primecarevip/prime-care-vip-app-v2/actions/runs/46090219861
- portal-enforcement-test: success — https://github.com/primecarevip/prime-care-vip-app-v2/actions/runs/46090219951
- roster-backfill-test: success — https://github.com/primecarevip/prime-care-vip-app-v2/actions/runs/46090219911
- roster-discovery-test: success — https://github.com/primecarevip/prime-care-vip-app-v2/actions/runs/46090219832
- sendgrid-event-webhook-gate: success — https://github.com/primecarevip/prime-care-vip-app-v2/actions/runs/46090219830
- social-signin-gate: success — https://github.com/primecarevip/prime-care-vip-app-v2/actions/runs/46090219840
- sync-email-test: success — https://github.com/primecarevip/prime-care-vip-app-v2/actions/runs/46090219916

## Holds and limitations

No merge, deploy, arming, invitation, patient/account mutation, Cynthia bootstrap, AUTOSEND/nudge change or readiness-counter start. Real production membership calls were not performed by these tests; owner-provided runtime evidence satisfied access verification. Emulator checks do not certify live patient activation. Discovery email/collision safeguards remain unchanged and are not newly added to this backfill scope.
