# PR #589 required gate migration — November 5, 2026

- Portal PR: https://github.com/primecarevip/prime-care-vip-app-v2/pull/589
- Portal commit: `5d1394a9cd96541cbd9511f274546bba046557f0`
- Verified GitHub run: https://github.com/primecarevip/prime-care-vip-app-v2/actions/runs/41944661028
- Required workflow/job unchanged: `social-signin-gate / social-signin-emulator`.
- Marked Ready for review after GitHub reported SUCCESS for every required-gate step. No merge or deployment.

## Exact changes in the portal repository

- `.github/workflows/social-signin-gate.yml`: run logical signed-token/nonce and no-auth-mutation tests, then both isolated Auth/Firestore/Functions emulator suites. Preserve all-PR execution, read-only permissions, Node 22, Java 17 and demo-project isolation; pin firebase-tools 13.29.2.
- Remove `.github/workflows/logical-social-gate.yml` to consolidate the logical checks into the existing required check.
- Remove obsolete `functions/test/unit/social-signin.test.cjs` and `functions/test/run-social-signin.js`.

## Evidence

- 13 signed-token/nonce/proof and no-Auth-mutation tests PASS.
- 24 real Auth/Firestore/Functions emulator tests PASS: A/B/C, atomic attempt progression/replay, concurrent A/B completions, mapping ownership/provider-slot collisions, claim reconciliation with no deletion, true-case UID/password preservation, staff fail-closed.
- GitHub verified install, nonce/no-mutation, and emulator steps all SUCCESS on the exact portal commit.
- No branch-protection rename required. Other repository checks and deployment safety remain separate from this gate.

Production flags stay off, blocking triggers stay None, canary stays held. No provider configuration, runtime credentials, production data or member-facing code changed. Hosted Google providers-disabled gate was previously passed; Apple hosted remains deferred and B integrations were synthetic/stubbed. My Health Hub owning-project verification and blocking-export-safe deployment remain independent prerequisites.
