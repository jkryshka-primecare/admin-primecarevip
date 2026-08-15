---
name: Portal WIF bridge account
description: Identity, hardening rules and rotation policy for the machine account that federates into GCP for the portal control plane
type: feature
---
The portal control plane reaches the four `admin*` Cloud Functions in
`prive-care-vip` via Workload Identity Federation. The federated identity is a
dedicated machine account in this project's auth:

- sub / `<BRIDGE_SUB>`: `c85a8977-1fa6-40c5-a819-decdf43e7177`
- email: `portal-bridge@bridge.primecarevip.invalid` (`.invalid` TLD on purpose —
  no deliverable mailbox, so there is no password-reset backdoor)
- password: `PORTAL_BRIDGE_PASSWORD` secret, 64-char CSPRNG, rotate quarterly.
  Rotation does not change the `sub`, so no Google-side change is needed.

Rules:
- The account must never hold a role. A trigger on `public.user_roles`
  (`deny_bridge_account_roles`) blocks any insert/update for this uid.
- Never send it a recovery email; `recovery_sent_at` must stay null.
- The GCP provider's attribute condition must stay pinned to this exact `sub`.
  `aud=authenticated` is shared by every user of the project and is not a lock.
