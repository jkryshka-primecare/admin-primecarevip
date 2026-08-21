---
name: Portal access retention for former members
description: Former/lapsed members keep read-only portal access to their records; membership lapse never revokes portal access
type: feature
---

Policy: portal access is NOT tied to Hint membership status.

- A patient who leaves the practice (membership ended, unpaid, terminated) keeps read-only access to their existing records in the member app.
- Nothing in the read path may gate on Hint membership. The only access gate is `portalAccess.status === 'suspended'` (per-member, admin-set, audited) plus module/item visibility.
- The reconciliation bucket `portal_no_membership` is informational only — labeled "Former member · access retained". Never present it as "candidates for access removal", and never build bulk revoke tooling off it.
- Suspension stays a deliberate, per-member admin action with a reason, not a consequence of billing state.
