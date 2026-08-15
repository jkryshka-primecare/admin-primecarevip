---
name: Firestore bridge
description: Read-only Firestore edge function, service-account secret, and whitelisted collections from the Firebase member apps
type: feature
---

The Firebase project `prive-care-vip` (member/patient apps, provider portal) is reachable from this admin OS through the `firestore-bridge` edge function.

- Auth: `FIREBASE_SERVICE_ACCOUNT` secret (full service-account JSON, Firestore viewer role). Server-side only — never expose to the browser.
- Gated by `requireStaff()` and logged to `phi_access_log` like the other PHI proxies.
- Only `get` (by document id) and `runQuery` are implemented. No writes, ever.
- Whitelisted collections: patients, appointment_requests, billing_accounts, billing_invoices, billing_subscriptions, pharmacy_orders, chat_conversations, messages, directory, locations, family, onboard_fees.
- Frontend access via `src/hooks/useFirestore.ts` (`useFirestoreList`, `useFirestoreDoc`).
- Firestore is the source of truth for member-app data; Postgres stays source of truth for RX, HR, and Cost Estimator.
