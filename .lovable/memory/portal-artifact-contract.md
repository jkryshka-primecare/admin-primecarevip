---
name: Portal artifact read contract (Release 2a)
description: Contract the Lovable-built member portal must honor for artifact reads — 300s signed-URL TTL, preparing state, absence-not-forbidden — plus the open 2b red-team follow-up
type: feature
---

Release 2a centralized the artifact read path in `functions/core/services/artifacts/readArtifact.js`
(merged to `main` in prime-care-vip-app-v2 PR #421; deployed to production, admin functions IAM-locked).
Only three wrappers have an artifact mode: `getLabs`, `getImaging`, `getMedicalRecords`.

## Contract the portal UI MUST honor (required before portal cutover)

1. **Signed-URL TTL is 300s** (hard cap 900s, never caller-supplied). It used to be ~30 minutes.
   Any PDF viewer that caches a link must re-request on expiry instead of showing a broken/expired PDF.
2. **`{ state: 'preparing' }`** is returned when the reference exists but the Storage object is missing.
   The server queues a self-heal repair. The portal must render a friendly "preparing" state,
   NOT an error and NOT a 404.
3. **Absence, never "forbidden"**: hidden item, module off, wrong module, and not-yet-synced all
   return 404 `ARTIFACT_NOT_SYNCED`. The UI must not distinguish them or imply something was hidden.
4. `403 ACCESS_SUSPENDED` → "portal access paused, contact the office". `503` → transient retry.

## Open follow-up for Release 2b

Add a red-team case that isolates the **reference-ownership check** (step 6a). Breaking that check
alone does NOT turn the gate red today — the `category` match (5b) and the uid-scoped Storage path
independently block cross-patient reads. Do not use the reference check as a mutation target expecting
RED; the suppression check is the mutation that goes red. Proposed case: seed patient B's object under
B's uid and point patient A's reference at it, so a regression removing only the reference check fails.
