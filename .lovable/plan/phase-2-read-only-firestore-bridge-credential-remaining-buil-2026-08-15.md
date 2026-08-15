# Phase 2: Read-Only Firestore Bridge — Credential + Remaining Build

## The key you need

A **Google service account key (JSON)** for the live Firebase project, with **read-only** permission. Nothing in this app deploys or provisions GCP resources, so no admin or deploy roles are required.

- Firebase console → Project settings → Service accounts → **Generate new private key**
- Role: **Cloud Datastore Viewer** (`roles/datastore.viewer`) — read Firestore, nothing else
- Do **not** grant: Editor, Owner, Cloud Functions Developer, Storage Admin
- Live project only. No staging environment for now.
- Firebase Storage read access is undecided — start Firestore-only. If member-uploaded files need to appear later, adding **Storage Object Viewer** to the same service account is a one-line change; the key type does not change.

Viewer-only is what physically enforces your safety rule: even a bug in this app cannot write to a live member record, because the credential has no write permission.

## What already exists

- `firestore-bridge` edge function — service-account JWT signing, token caching, collection whitelist, Firestore typed-value decoding. Only `get` and `runQuery`; no write verb exists in the file.
- Staff gating (`requireStaff`) and PHI logging (`logPhiAccess`), same as the Elation and Hint proxies.
- `useFirestore` hook (`useFirestoreList`, `useFirestoreDoc`).
- A Member tab in the patient drawer reading membership, subscriptions, and invoices from Firestore.
- A Firestore row in Connection Health and in the daily automated health check.
- Live-production safety rule and the Elation-ID identity rule saved to project memory.

Everything above is inert until the secret is saved.

## Remaining work once the key is in

1. **Save the key** as `FIREBASE_SERVICE_ACCOUNT` (full JSON contents).
2. **Verify with reads only** — confirm the health check returns 200 and the Member tab populates for a real patient. No test writes.
3. **Confirm field names.** Firestore documents are schemaless; the Member tab currently guesses at field names (`membershipStatus`, `planName`, `patientId`). After the first live read, map the tab to the actual fields the member apps write.
4. **Roster badges** on `/patients` showing which systems each record exists in (Firestore / Elation), so sync gaps are visible instead of silent.
5. **New read-only surfaces**, in this order:
   - Appointment requests — pending member requests with status and requested provider
   - Member billing — accounts, subscriptions, invoices next to the Hint billing view
   - Pharmacy orders — member-submitted orders alongside the existing RX queue

## Out of scope

- Any write path into Firestore, Elation, or Hint.
- Migrating Firestore data into this project's database. Firestore stays source of truth for member-app data; the project database stays source of truth for RX, HR, and Cost Estimator.
- Unifying logins between the member apps and this admin OS.
