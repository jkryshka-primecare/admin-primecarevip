# Go live with the portal control plane (no portal change)

Short answer: the current portal keeps running exactly as it does today. Nothing about this is a handoff, and members do not see My Health Hub. The only change is that staff in Prime Care OS gain the ability to invite, suspend, and control visibility for the portal that is already live at care.primecarevip.com.

The portal rebuild in My Health Hub is a separate track. Members only see it on the day you point `care.primecarevip.com` at it — and that only happens after a parity review and your explicit sign-off.

## What members experience during this go-live

```text
Today                          After this go-live
-----                          ------------------
care.primecarevip.com          care.primecarevip.com   (same app, same URL)
  -> Cloud Functions             -> Cloud Functions  (same, now access-aware)
  -> Firestore / Elation         -> Firestore / Elation

Invites: CLI script            Invites: Portal tab in Prime Care OS
Visibility: none               Visibility: per-member module + item control
```

Members see no new UI. The only thing they can notice is a deliberate staff action: a section marked unavailable, an item hidden, or an account paused.

## Steps to make the control plane live

1. **Deploy the four admin functions.** Copy `firebase-handoff/portal-admin/functions/` into the Firebase repo, export them from `functions/index.js`, deploy. These are new endpoints — they add nothing to the member-facing path and cannot break it.
2. **Apply the enforcement patches.** Follow `ENFORCEMENT.md` for `getLabs`, `getImaging`, `getMedications`, `getLetters`, `getMedicalRecords`, `getAppointments`, `getProblems`, `getAllergies`, and `getMyPatientRecord`. This is the only step that touches live member reads. It is written to fail open on visibility (a Firestore hiccup never blanks a real chart) and fail closed on suspension. With no `portalAccess` doc written, behaviour is byte-for-byte what it is today.
3. **Create the caller identity.** Service account `portal-admin@prive-care-vip`, Cloud Functions Invoker on those four functions only, then paste its JSON key into Prime Care OS as `PORTAL_ADMIN_SERVICE_ACCOUNT`.
4. **Prove it on one test member.** Read state, send one invite, toggle one module off and back on, suspend and restore. Confirm each change appears on the live portal and lands in the audit trail.

## Rollback

Each step reverses independently: redeploy the previous function build to undo enforcement, remove the invoker binding or delete the secret to disable the control plane instantly. No data migration, so nothing to unwind.

## Work in this app

None required — the Portal tab, the `portal-admin` edge function, and the `portal_admin_actions` audit table are already built here. Until the secret exists, the tab reports "not configured" rather than acting.

## After it is proven

Bulk invite waves, then the My Health Hub rebuild track. The rebuild consumes the same access model, so the visibility controls you set now carry over unchanged at cutover.
