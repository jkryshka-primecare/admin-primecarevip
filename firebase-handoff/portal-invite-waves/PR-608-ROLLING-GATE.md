# C4 rolling reputation gate — #607

- PR: https://github.com/primecarevip/prime-care-vip-app-v2/pull/608
- Feature branch: `fix/c4-rolling-reputation-607`
- Commit: `942a3b9e48f3f9d3d76ea531fffc85b14210cf33`
- Base: `b85ab9f5cc6723dfa56db892a4f452fc022075f7`
- Closes #607; conflict-free, one commit over main; all seven published file hashes verified.

## Changes

- Runner counts distinct recipient hashes only for `bounce`, not `dropped`; spam remains `spamreport`.
- Select numeric descending recorded prior waves until at least 150 accepted sends; all recorded prior waves if under 150. Whole boundary wave retained, hashes unioned, sends summed, events filtered from earliest included start.
- `evaluateGate` remains byte-unchanged (strictly below 2% / 0.1%). Settlement uses immediately prior wave end. Missing completion/feed failure and malformed included history fail closed.
- Contract amendment preserves historical sections. Root architecture rule and task checklist updated; new real runner emulator suite added to claim-hydration-gate.

## Verification

- Actual report-only CSV runner against isolated Firestore emulator: wave 3 lone dropped -> gateForWave 4 passes, bounceRate 0; one newest-wave real bounce -> pass at 1/150; three distinct rolling-window real bounces -> blocks at 2%.
- 39 emulator tests passed: 12 hydration client-denial, 18 existing batch preflight/first-invite, 9 new runner gate tests. No provider requests or production credentials used in emulator.
- Unit cases cover numeric ordering, union, all-history fallback, whole-wave overshoot, malformed history, thresholds. Existing invitation safety/cooldown/batch and hydration queue/worker/recovery/drain tests pass; runner syntax passes.
- Hosted required claim-hydration-gate run `43995671382`: SUCCESS; invite-send-safety `43995671375`: SUCCESS on exact published commit.
- Main, deployment, arming, production configuration/data and real invitations untouched. No merge performed.