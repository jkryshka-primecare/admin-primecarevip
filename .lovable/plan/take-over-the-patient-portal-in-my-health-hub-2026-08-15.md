# Take over the patient portal in "My Health Hub"

Rebuild the member portal now served at care.primecarevip.com inside the Lovable project **My Health Hub**, keeping Google (Firebase Auth + your existing Cloud Functions + Firestore) as the backend. Nothing about the live portal changes until the rebuild reaches parity and you approve the DNS cutover.

## Where the work happens

The build must be done **in the My Health Hub project**, not in this admin OS. This plan is the blueprint to carry over there. This project (PrimeCare OS) stays the staff/admin app.

## What exists today

Current live portal (`artifacts/web-member` in the private repo `prime-care-vip-app-v2`):

- React 19 + Vite, plain JSX, inline-style theme, deployed to Firebase Hosting
- Firebase Auth (email/password) with a claim-account invite flow (`/claim?t=<token>`)
- All PHI read through HTTPS Cloud Functions with `Authorization: Bearer <idToken>` — the client never reads PHI from Firestore directly
- Functions in use: `getMyPatientRecord`, `getProblems`, `getAllergies`, `getLabs`, `getMedications`, `getImaging`, `getAppointments`, `getLetters`, `getMedicalRecords`, `claimAccount`, `logPatientAccess`, `logPhiAcknowledgment`
- Gates and safeguards: DOB verification (`webAccessVerifiedAt`), `NOT_WEB_VERIFIED` 403 handling, "records not ready" state, session idle timeout, hydration modal
- Screens: Login, Claim Account, Dashboard, Appointments, Lab Results, Imaging, Medications, Conditions, Allergies, Profile, Records Not Ready

My Health Hub today: a TanStack Start UI shell with mock data in `src/data/portal-data.ts` and routes for Dashboard, Appointments, Labs, Imaging, Medical Records, Medications. No auth, no backend.

## Approach

Parity plus a design refresh, on the existing Google backend. Same functions, same auth, same PHI rules — new frontend.

### Stage 1 — Wire the backend (no UI change yet)
- Add a client-only Firebase module (`app`, `auth`) initialized for project `prive-care-vip`; guard against SSR since My Health Hub is TanStack Start.
- Port the API client layer: a single authed caller that attaches the Firebase ID token, 15s abort timeout, and the existing `parseApiError` semantics (401 / 403 `NOT_WEB_VERIFIED` / `NO_PATIENT_RECORD` / `AMBIGUOUS_BINDING` / network 0). Fail closed on unexpected 200 shapes — never render partial PHI.
- Config: `VITE_FIREBASE_API_KEY` (publishable) and `VITE_FUNCTIONS_BASE_URL` pointing at `https://us-central1-prive-care-vip.cloudfunctions.net`.
- **Google-side change required:** the Cloud Functions CORS allowlist must accept the My Health Hub preview and published Lovable origins, otherwise every read is blocked in the browser. This is a change in the Firebase repo/functions and needs your explicit approval and a deploy on your side.

### Stage 2 — Auth and gates
- Login (email/password + password reset), Claim Account via invite token, sign-out.
- Patient-record boot flow: `getMyPatientRecord` on load → loading / friendly error screens / ready.
- DOB verification gate, PHI acknowledgment, idle session timeout, Records-Not-Ready screen.

### Stage 3 — Screens at parity, refreshed design
Rebuild each screen on the My Health Hub design system (Prime Care VIP brand tokens, shadcn components), replacing `portal-data.ts` mocks with live reads:

Dashboard · Appointments · Lab Results · Imaging · Medical Records / Letters · Medications · Conditions · Allergies · Profile (incl. profile photo)

Every screen keeps the current empty, loading, and error states rather than inventing new ones.

### Stage 4 — Parity check and cutover
- Side-by-side review of the Lovable portal against the live one, screen by screen, signed in as a real test member.
- Publish My Health Hub, then move `care.primecarevip.com` to the Lovable custom domain once you sign off. The old Firebase Hosting build stays deployable as an instant rollback.

## Safety rules carried over

- Read-only against production: no writes, updates, or deletes to Firestore, Elation, or Hint without explicit per-action approval.
- No PHI read straight from Firestore in the browser — all PHI goes through the audited Cloud Functions.
- No changes to `firestore.rules`, `storage.rules`, or existing function logic as part of the frontend rebuild, except the CORS allowlist noted above.

## Open items to resolve during Stage 1

- A test member account (email + DOB) to exercise the real flows end to end.
- Confirmation of who deploys the Cloud Functions CORS change on the Google side.
- Whether the Twilio-based messaging surface is in scope for this portal (it exists in the provider app; the member web portal currently has no messages screen).
