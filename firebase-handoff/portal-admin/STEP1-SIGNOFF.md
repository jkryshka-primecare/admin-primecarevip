# Prime Care VIP — Patient Portal Control Plane (Step 1) Production Sign-Off

**Project:** `prive-care-vip` (Firebase / GCP) · **Repo:** `prime-care-vip-app-v2`
**Date:** August 16, 2026
**Scope:** Step 1 — portal admin control plane (invites + visibility/suspension control) and its enforcement across the patient-facing read handlers. **Step 2 (replacement portal plumbing / hard cutover) is not part of this validation and has not started.**

---

## Outcome

The Step 1 control plane and its enforcement were validated **in production**, on a single synthetic member, against the real Workload Identity Federation credential path. Every row of the Phase 5 smoke-test matrix passed. The security-critical behaviors hold: the admin plane is gated by real cryptographic OIDC verification, module visibility fails **open** to a clean unavailable state, suspension fails **closed** on PHI, hidden items leak no artifact, and no downloadable service-account key exists anywhere.

**Recommendation:** cleared to proceed **after** the member-facing UI patch (module-off / suspended states) is deployed through the normal PR path, and — strongly recommended before any broad invite wave — the activate-form autofill fix. The backend enforcement itself is sound and already live. See *Open Follow-Ups* and *Gate*.

---

## What was validated

### Test member
`patients/816455979040769` — synthetic fixture "Test Kieffer" (`_testSeed`), DOB 1980-02-28. Reset to unclaimed, roster email pointed to the staff-controlled `info@primecarevip.com`, then invited and claimed fresh. No real patient was ever targeted; the 763 existing patients were never touched.

### Smoke-test matrix

| # | Action | Result | Notes |
|---|--------|--------|-------|
| 1 | Open Portal tab (WIF chain) | ✅ Pass | Bridge → impersonate `portal-admin` → invoker → `requireAdminCaller` works end-to-end |
| 2 | Send invite | ✅ Pass | SendGrid claim email delivered to `info@`; `claimTokens` created; audit `invite_sent` with `sentTo` recorded |
| 3 | Claim account | ✅ Pass | Fresh uid bound, token consumed, member can sign in and use the portal |
| 3.5 | Revoke invite | ✅ Pass (data-layer) | Token `revoked=true / used=true`; audit `invite_revoked`, `revokedCount:1`. Link no longer activates |
| 4 | Labs OFF | ✅ Backend pass | `getLabs` → `200 {moduleUnavailable:true}`, zero PHI. Member-facing card pending UI patch (see follow-ups) |
| 5 | Labs ON | ✅ Pass | Restore byte-identical; only `modules.labs` changed |
| 6 | Open a real lab PDF | ✅ Pass | `200` signed URL, ~30-min TTL, PDF rendered from Storage (the emulator gap, now covered) |
| 7 | Hide one item | ✅ Pass | `SMOKE-LAB-2` dropped from list, sibling intact; `hiddenItems.labs:["SMOKE-LAB-2"]`. No-leak code-path-verified (see follow-ups) |
| 7b | Unhide | ✅ Pass | Item and artifact return; `hiddenItems.labs:[]` |
| 9 | Suspend | ✅ Pass | `getMyPatientRecord` → `200` with `portal.status:'suspended'`, no PHI; `getLabs`/`getAppointments` → `403 ACCESS_SUSPENDED` |
| 10 | Restore | ✅ Pass | Access resumes; only `status` changed |

### Confirmed security properties
- **Admin gate is real, not header-trust.** `requireAdminCaller` cryptographically verifies a Google OIDC identity token (RS256 against JWKS, checks `iss`/`exp`/`email_verified`/`aud`/allowlisted email). A patient token cannot pass.
- **Visibility fails open, suspension fails closed.** Module-off returns a graceful `200 moduleUnavailable`; suspension hard-denies PHI with `403` while `getMyPatientRecord` returns a first-class suspended shell.
- **No artifact leak.** Hidden items return `404 ARTIFACT_NOT_SYNCED` *before* any Storage access; signed URLs are 30-minute, per-uid scoped.
- **Append-safe changes.** The read allowlist and every access change appended without disturbing existing patients.
- **Keyless credentials.** Workload Identity Federation throughout — no downloadable `portal-admin` key exists. The caller SA is scoped to invoke only the four admin functions.
- **Dual audit trail.** Every mutating action landed in `portalAdminAudit` (portal side, verified with correct actor/reason and before→after chaining across all actions) and `portal_admin_actions` (staff side, confirmed written server-side before the response).

### Infrastructure & process validated
- Branch protection on `main` (PR + 1 approval, no admin bypass), CI deploy via merge (`deploy-production.yml`), rules-first fatal deploy, health gate.
- Scoped Lovable read credential (Datastore viewer) replacing the earlier over-privileged admin key.
- Admin functions locked to `portal-admin` invoker only (public `allUsers` binding was found and removed during setup).

---

## Open follow-ups

Prioritized; none reopen the validated backend, but the first two matter before a broad rollout.

1. **Member-UI states patch — deploy pending (blocker for rollout).** `module-off-suspended-states.patch` (reviewed and approved; display-only, backend untouched) makes the member portal render calm "turned off" / "access paused" cards instead of a generic "Unexpected response" error. Until it ships, a real member hitting a turned-off module or a suspension sees an error screen. It lives in-repo (`artifacts/web-member/src`), so it should go through branch → PR → review. **Confirm the CI actually builds/deploys the `web-member` hosting**, or identify the separate deploy step.
2. **Activate-form autofill bug (recommended before invite wave).** A browser-autofilled date of birth doesn't fire the change event the form needs, so the **Activate account** button stays permanently disabled even though the DOB and password look correct. Every invited patient hits this form. Fix: sync a pre-filled/autofilled DOB into validation state (read the field on mount/blur, or validate from the DOM on submit).
3. **Backend hardening — `adminSetPortalAccess` should reject unknown patch keys.** The hide-item no-op bug was invisible precisely because an unrecognized top-level key returned `ok:true`. Make the function `400` on unknown keys so a shape mismatch can never again masquerade as a successful, audited action. (Optional but recommended alongside: move hide/unhide to an atomic server-side op inside the existing transaction, eliminating the client-side read-modify-write race.) Backend PR, its own CI review.
4. **Revoked-link UX.** A revoked claim link loads the activate form and silently disables the button rather than showing "this invitation is no longer valid." Security is fine (token is dead); the messaging should be explicit.
5. **`claimedAt` / `webAccessVerifiedAt` not stamped on claim.** Bind and hydration complete correctly, but these two timestamps came back unset. Confirm whether the claim flow is meant to write them.
6. **Row-7 no-leak was code-path-verified, not live-replayed.** The hidden item is provably absent from the list and the artifact path 404s by design; a live replayed fetch was not run. Optional to close fully.

### Already fixed during this validation
- Panel white-screen (React #31) when rendering Firestore Timestamps — fixed (timestamp normalizer).
- "Hide a specific item" no-op (panel sent `{hideItem:…}`; backend expects `{hiddenItems:{labs:[…]}}`) — fixed (panel/hook translation).

---

## Teardown / housekeeping

The test fixture is currently **claimed** under new uid `d8h7h6xc6axkq3k3tgnoz6ytxmx1`, email `info@primecarevip.com` (in Elation and Firestore), with a live login (password set at activation). Also present: the seeded `SMOKE-LAB-2` lab doc + PDF, and dummy PDFs on the real report id.

To fully decommission when ready: `seed-test-lab-artifacts.js --cleanup --apply` (removes `SMOKE-LAB-2`), delete the new Auth user, and restore/retire the Elation email. Note `reset-test-fixture.js` is pinned to the **old** uid/email, so it will not clean the current claim without updated pins. Alternatively, leave the fixture claimed for future re-tests. (The `set-roster-email.js` / read helpers used here are throwaway Cloud Shell scripts; the ADC login created an ephemeral `/tmp` credential that clears on Cloud Shell recycle.)

---

## Not in scope

**Step 2 — rebuilding portal storage/functions on Google as the replacement backend with a hard cutover — has not started.** It should get its own scoping pass, runbook, and go/no-go review, separate from this Step 1 sign-off.
