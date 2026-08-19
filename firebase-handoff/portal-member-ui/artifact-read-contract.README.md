# Member portal: Release 2a artifact read contract

Patch: `artifact-read-contract.patch` (apply in `primecarevip/prime-care-vip-app-v2`).

```bash
git checkout -b feat/portal-artifact-read-contract
git apply /path/to/artifact-read-contract.patch
```

Backend unchanged. All edits are in `artifacts/web-member/src`. Verified with
`patch -p1 --dry-run` against `main` at `51dda90` and syntax-checked with esbuild.

This is the member-UI half of `mem://portal-artifact-contract` — the last Lovable-owned
item gating the portal cutover.

## What it fixes

The read path centralized in `functions/core/services/artifacts/readArtifact.js` changed
three things the client never learned about:

1. **Signed URLs now live 300s**, not ~30 minutes, and the TTL is server-pinned. The
   viewer cached the link for the life of the screen, so an open report went dead after
   five minutes and Print/Download silently opened an expired URL.
2. **`200 { state: 'preparing' }`** — reference exists, Storage object is being restored,
   repair already queued server-side. The client hit the "200 but wrong shape" branch and
   rendered red **"Unexpected response."**, which reads as an outage for something that is
   simply not ready.
3. **Absence is never "forbidden"** — hidden item, module off, wrong module and
   not-yet-synced all answer `404 ARTIFACT_NOT_SYNCED`. The UI must not distinguish them.

## Changes

- **`hooks/useArtifact.js`** (new) — owns the whole artifact lifecycle for `getLabs`,
  `getImaging` and `getMedicalRecords`: opens a report, re-requests a fresh URL 45s before
  the stated `expiresAt` (floor 15s), polls `preparing` up to 5 times at 8s, and maps every
  outcome to member copy. Generation counter so a slow response for report A cannot paint
  over report B; timers cleared on unmount and on every `open`/`close`.
- **`services/api/clinicalApi.js`** — `fetchArtifact` branches on `state === 'preparing'`
  **before** the shape check → `{ kind: 'preparing' }`. Contract documented on the function.
- **`components/PdfViewer.jsx`** — new `onExpired` prop. A `react-pdf` load failure or a
  failed blob fetch asks for a fresh URL **once per URL** before showing the terminal
  "couldn't be displayed" message, since at a 300s TTL expiry is the likelier cause.
- **`screens/LabResults.jsx` / `screens/Imaging.jsx`** — render the `preparing` state as
  calm neutral copy (no red, no retry button — polling handles it); only genuinely
  transient faults (`0`, `503`) are red and offer **Try again**. Both screens drop their
  local `fetchArtifact` plumbing and duplicated error mappers in favour of the hook.

Copy is deliberately identical for every flavour of absence: *"This report is not
available to view yet."* Suspension is the one distinct case: *"Portal access is paused.
Please contact the office and we will restore it."*

No medical-records screen exists in `web-member` yet (`RecordsNotReady.jsx` is the
placeholder). When it lands it should call `useArtifact('getMedicalRecords', getIdToken)`
and get all three behaviors for free.

## Interaction with `module-off-suspended-states.patch`

The two patches are independent and touch different branches of `fetchArtifact`. If the
module-off patch is applied first, `useArtifact` already handles its `{ kind: 'moduleOff' }`
and `{ kind: 'suspended' }` results; if it is not, those branches are simply never taken.
Apply the module-off patch first when landing both.

## Smoke-test expectations (Test Kieffer fixture)

| Case | Expected |
| --- | --- |
| Visible lab with artifact | PDF renders; a fresh URL is minted before 300s with no visible flicker |
| Leave a report open >5 min, then Print | Works — the viewer re-requests instead of opening a dead link |
| Reference present, object missing | Calm "We are preparing this document…", escalating copy after ~16s, no red, no retry button |
| Hidden item / module off / wrong module | Identical "not available to view yet" — no hint that anything was withheld |
| Suspended patient | "Portal access is paused. Please contact the office…" |
| Network drop / 503 | Red transient message **with** Try again |
