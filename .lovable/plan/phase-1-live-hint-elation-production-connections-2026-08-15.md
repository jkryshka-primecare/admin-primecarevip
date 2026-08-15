# Phase 1: Live Hint + Elation Production Connections

## Blocker: repo access

`https://github.com/primecarevip/prime-care-vip-app-v2` returns 404 from this sandbox, so it is private (or renamed). Before I can read the Claude/Firebase work, one of these must happen:

1. Make the repo public temporarily, or
2. Give me a GitHub read token (I'll request it as a secret), or
3. Zip the repo and upload it into the chat.

The Hint/Elation production work below does not depend on the repo, so we start there.

## What already exists

- `hint-live` edge function — proxies `api.hint.com` provider/partner APIs with `HINT_PRACTICE_API_KEY` / `HINT_PARTNER_API_KEY`, Bearer auth, staff-gated, PHI-logged.
- `elation-live` edge function — OAuth2 client-credentials proxy for `app.elationemr.com/api/2.0` (REST) and `fhir.elationemr.com` (FHIR), with `ELATION_CLIENT_ID` / `ELATION_CLIENT_SECRET`.
- Insights UI panels currently mix live panels with sandbox/mock panels.

Whether the production credentials currently authenticate has not been verified — that is step 1.

## Plan

### 1. Verify both production connections
- Call `elation-live` for `practices`, `patients`, `physicians`, `appointments` and record status codes.
- Call `hint-live` for `practice`, `patients`, `memberships`, `invoices` on the practice scope, and `practices`/`organizations` on partner scope.
- Report exactly which resources return 200 and which fail, with the upstream error text. If a key is wrong or scoped incorrectly, I'll say which secret needs replacing rather than guessing.

### 2. Build a connection health surface
New **Admin → Integrations → Connection Health** panel:
- One row per integration (Elation REST, Elation FHIR, Hint practice, Hint partner).
- Live/Down badge, last-checked timestamp, HTTP status, latency, and the upstream error message when failing.
- Manual "Test now" button per row.

### 3. Cut Insights over to production
- Replace remaining sandbox/mock data sources on the Insights tabs with the `-live` proxies where a production endpoint answered in step 1.
- Any tab whose upstream is unavailable keeps its current panel but gains an explicit "no live source" notice rather than silently showing mock numbers.

### 4. Daily automated spot-check (carries over the earlier ACH/CC request)
- Scheduled function runs each morning, pings the same endpoint list, writes results to a new `integration_health_checks` table, and emails admins on failure.

## Phase 2 (after repo access)

Once I can read `prime-care-vip-app-v2` I'll produce an inventory of its Firestore collections, security rules, and Cloud Functions, then a migration plan for keeping Firestore as source of truth while this app reads it. Note the constraint up front: this app's auth, RLS, and all existing modules (RX, HR, Cost Estimator) run on Lovable Cloud Postgres. Firestore access will be added as a second data source — read via a Google service account from edge functions (server-side, so credentials stay out of the browser) plus a typed client data layer. I'll detail that after reading the code.

## Technical notes

- Firestore service-account JSON will be stored as a Cloud secret and used only inside edge functions; no Firebase web SDK keys with broad access in the frontend.
- Any Elation writes stay off-limits — the existing read-only rule holds.
- New tables get GRANTs + RLS scoped to admin/staff roles.
