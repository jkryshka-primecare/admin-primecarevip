# PR #589 callable-only amendment — November 5, 2026

- Portal commit: `3b6c83906ca97fadbcd7a7dcd110d7e1fd8bf323`.
- Review comment: https://github.com/primecarevip/prime-care-vip-app-v2/pull/589#issuecomment-6647093359
- Required check remains `social-signin-gate / social-signin-emulator`; amended-head run: https://github.com/primecarevip/prime-care-vip-app-v2/actions/runs/41948865662

Removed the blocker require and both blocker exports from the actual portal entrypoint, retaining all five logical callables. Staged blocker source is unchanged and unloaded. Updated the contract and rollout scope without changing historical decisions or the production workflow. No merge/deployment performed.

Two new required-check regressions evaluate the real entrypoint using isolated dependency stubs. Both fail on the previous head and pass on the amended head: no blocker module load, no blocker exports, all five callables retained. Exact local tree: 15 nonce/no-mutation/deployment tests and 24 real Auth/Firestore/Functions emulator tests pass. Published index re-read matches the tested source. Amended-head GitHub run 41948865662 and its social-signin-emulator job both completed SUCCESS.

The scoped main/retry workflow now discovers no blockers to register. Firebase `--force` can delete existing now-unexported blocker resources; deletion is not re-registration. Owner checks triggers None pre/post, flags off and native providers disabled. Owner re-verifies before Michael merges. Blocker registration plus SDK audience repair remains separate #588 work requiring a dedicated registered-hosted gate; neither logical CI nor hosted providers-disabled A/B/C certifies that layer. My Health Hub verification remains a separate canary gate.