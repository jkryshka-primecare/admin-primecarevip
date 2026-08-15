# Phase 2: Read-Only Firestore Bridge

Hint stays. Elation patient ID is the single unique patient identifier across systems (shared emails/phones in families make email/phone unusable as keys).

## Goal

Let this admin OS read the Firestore data the patient/member apps already own — patient roster, appointment requests, billing, messaging, pharmacy orders — without duplicating the Elation sync and without putting Firebase credentials in the browser.

## Architecture

```text
Admin OS (React)
   -> useFirestore hook
      -> edge function `firestore-bridge`  [staff-gated, PHI-logged]
         -> Google service account (JWT -> access token, cached)
            -> Firestore REST API (prive-care-vip)
```

- Server-side only. A Google service-account JSON is stored as a backend secret and never reaches the client.
- Read-only by construction: the bridge whitelists collections and only issues `get` / `runQuery`. No writes, ever.
- Access is gated by the same `requireStaff` helper and logged to `phi_access_log`, exactly like `hint-live` and `elation-live`.
- Patient documents are keyed by Elation patient ID, so records join to Elation lookups with no extra mapping table.

## Steps

### 1. Credentials
Request a Google service account (Firestore read-only: `roles/datastore.viewer`) for `prive-care-vip`, stored as one secret. If a staging project should be reachable too, a second secret.

### 2. `firestore-bridge` edge function
- Signs a JWT with the service-account key, exchanges it for an access token, caches it in memory until expiry.
- Accepts `{ collection, id?, where?, orderBy?, limit?, cursor? }`.
- Whitelist (read-only): `patients`, `appointment_requests`, `billing_accounts`, `billing_invoices`, `billing_subscriptions`, `pharmacy_orders`, `chat_conversations`, `messages`, `directory`, `locations`, `family`, `onboard_fees`.
- Converts Firestore's typed-value JSON into plain objects before returning.
- Returns the same envelope shape the other proxies use (`status`, `ok`, `elapsedMs`, `data`, `pagination`) so existing UI patterns apply.

### 3. `useFirestore` hook
Mirrors `useHintResource` — list + detail fetch, loading/error state, TanStack Query caching.

### 4. Patients page becomes the joined roster
`/patients` currently queries Elation live per request. It becomes:
- Firestore `patients` as the roster (membership status, pod, onboarding state, billing account).
- Elation live detail fetched on demand in the drawer, keyed by the same Elation patient ID.
- A badge on each row showing which systems the record exists in (Firestore / Elation / Hint), so sync gaps are visible instead of silent.

### 5. New read-only surfaces
- **Appointment requests** — pending member requests with status and requested provider.
- **Member billing** — accounts, subscriptions, invoices from Firestore, next to the Hint billing view.
- **Pharmacy orders** — member-submitted orders alongside the existing RX queue.

### 6. Health + safety
- Add a Firestore row to Administration -> Integrations -> Connection Health and to the daily automated check, so a broken service account is caught the next morning.
- Document in security memory that the bridge is read-only, staff-gated, and PHI-logged.

## Out of scope for this phase

- Any write path back into Firestore.
- Migrating Firestore data into this project's database. Firestore stays source of truth for member-app data; Postgres stays source of truth for RX, HR, and Cost Estimator.
- Firebase Auth unification — the two systems keep separate logins for now.

## What I need from you

The Google service-account JSON (Firestore viewer role on `prive-care-vip`). Everything else is buildable immediately after that.
