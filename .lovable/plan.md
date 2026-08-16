# Step 2 — Portal Data Plane, Stable Identity, Family Access

Ships as two releases. **2a** has no legal dependency and goes first; **2b** builds family access while compliance reviews the adolescent rules.

Where the work lands:
- **This app (Prime Care OS)** — staff-facing panels, reconciliation, the guardian-link console, exported patches.
- **Firebase repo** — Cloud Functions, Firestore rules, Storage layout, backfill and audit jobs, delivered as patches under `firebase-handoff/` as in Step 1.

Everything stays read-only against Elation and Hint. No patient-facing writes without your explicit go-ahead per row.

---

## Release 2a — Storage integrity and roster coverage

Goal: every referenced document provably exists and is reachable, and every active member has a portal record. No identity changes yet.

**1. Re-key artifact storage off `firebaseUid`**

Today: `elation-artifacts/<firebaseUid>/<reportId>/report.pdf`. A re-claim orphans the files and unclaimed patients have nowhere to put artifacts.

New layout: `artifacts/<elationPatientId>/<documentId>/…`. Ownership is enforced at read time by resolving account → allowed patient ids, not by the path. Copy-forward migration: write to the new path, keep the old path readable during a dual-read window, delete only after the coverage audit passes.

**2. Self-heal reconciliation**

A doc with `hasArtifact:true` and no stored object currently 404s forever. Add both:
- a lazy on-miss trigger that re-fetches from Elation on the read that missed, and
- a nightly sweep that scans for the same mismatch and repairs ahead of any patient hitting it.

Both write an audit row. Repeated failures for the same document raise a health-check alert rather than retrying silently.

**3. Coverage audit**

A job that walks every document reference and proves the object exists in Storage, producing a report with a hard number. This becomes the go/no-go gate: no Elation exit, and no 2b cutover, below 100%.

**4. Close the 254-member gap**

We verified 976 active Hint members against 764 portal records. Add a provisioning action driven by the reconciliation view already built: staff select members with no portal record and create the roster docs in bulk. Creating a roster record does **not** send an invite — inviting stays a separate, deliberate action.

**Exit criteria for 2a:** artifact coverage at 100%, self-heal proven on a seeded miss, zero active Hint members without a portal record, old storage paths retired.

---

## Release 2b — Identity split and family access

**5. Phased internal UUID**

Mint an opaque UUID per patient and store it alongside the existing key, with an `externalIds` map (`{ elation: <id>, hint: <id> }`) on each record. Elation ID stays the lookup key through 2b so nothing re-keys mid-flight. Once family access is live and stable, flip lookups to the UUID behind a mapping layer; the UUID never changes after that.

**6. Account / record / grant split**

Three separate concepts, three collections:

```text
account   { firebaseUid, email, phone }            <- a login
patient   { internalId, externalIds, demographics } <- the clinical record
grant     { accountId, patientId, relationship,
            permissions, effectiveFrom, effectiveTo,
            status, createdBy, reason }             <- the edge
```

One account can hold many grants; one patient can be reached by several accounts (both parents). Email and phone become attributes, never identity keys — which is what unblocks minors sharing a parent's email.

**7. Guardian links — three creation paths, all verified**

- **Staff-mediated:** a guardian-link console in this app. Staff pick guardian and dependent, state the relationship and reason, and the grant is written server-side with an audit row.
- **Invite-for-dependent:** issue an invite scoped to a dependent that attaches to a guardian's already-verified account, reusing the Step 1 claim-token flow.
- **Hint auto-suggest:** Hint memberships already group families onto one contract. A job proposes likely guardian/dependent pairs from shared contracts plus DOB, and staff approve or reject each one. Nothing is ever created without a staff approval click.

Revocation is first-class — `effectiveTo` / `status`, reversible, with an audit row on every change (custody changes, disputes).

**8. Patient switcher and per-patient control plane**

After a guardian authenticates, the portal resolves their own record plus active grants and offers "Viewing: You / Child A / Child B". Every read — list and artifact — is scoped to the selected patient id, and the Step 1 `portalAccess` controls (module visibility, item hide, suspension) apply per that patient, so staff keep independent control of each dependent.

**9. Policy engine for minors**

v1 rule: full guardian access under 18. The mechanism supports per-age and per-record-type gating from day one, configurable without a code change, so counsel can tighten it later. Also handles the age-out transition at majority.

**10. Proxy-aware audit**

Extend `phi_access_log` to record the acting account, the patient record viewed, the internal patient id, and the grant that authorised it — so every view of a child's record is attributable to the specific adult who made it.

---

## Carried over from Step 1, not rebuilt

Workload Identity Federation and keyless signing, the `portalAccess` control plane (modules fail open, suspension fails closed), short signed-URL TTLs, suppression-before-storage, audit-before-read, branch protection and PR/CI deploy discipline, and the member-UI module-off / suspended states.

---

## Cutover

Dual-read shadow period before any hard switch: serve from the new plane while verifying parity against the old, then cut over. Gated on 100% artifact coverage, parity verification, family-link data migrated, and audit continuity. Each release gets its own runbook and go/no-go, same as Step 1.

---

## Two things I'd flag

- **The 254-member gap is the bigger near-term risk.** Those are paying members with no portal record at all. 2a fixes that before we spend effort on family access.
- **Hint is the best source for family structure we have.** A Hint contract covering multiple people is already a de-facto family unit, which makes the auto-suggest path far more accurate than name matching — but every suggestion still needs a staff click, since a shared contract is not proof of guardianship.

## Open, not blocking

Legal input on adolescent record types and the age threshold. 2a ships regardless; 2b ships with the simple v1 rule and tightens by config.
