# Step 2 — Portal Data Plane, Stable Identity, Family Access

Ships as two releases. **2a** has no legal dependency and goes first; **2b** builds family access while compliance reviews the adolescent rules.

Where the work lands:
- **This app (Prime Care OS)** — staff-facing panels, reconciliation, the guardian-link console, exported patches.
- **Firebase repo** — Cloud Functions, Firestore rules, Storage layout, backfill and audit jobs, delivered as patches under `firebase-handoff/` as in Step 1.

Everything stays read-only against Elation and Hint. No patient-facing writes without your explicit go-ahead per row.

**Revised after the review response.** Four changes: storage is re-keyed **once**, straight to the internal UUID (no intermediate Elation-shaped key); the ownership resolver gets a dedicated red-team gate; self-heal becomes sweep-first with an async on-miss repair; and guardian access ships enabled for **young children only**, with adolescents gated pending counsel.

---

## Release 2a — Storage integrity and roster coverage

Goal: every referenced document provably exists and is reachable, and every active member has a portal record.

**1. Mint the internal UUID now (moved earlier)**

Originally planned for 2b. Doing it in 2a avoids re-pathing every object twice. Mint an opaque UUID per patient and store it alongside the existing key with an `externalIds` map (`{ elation: <id>, hint: <id> }`). Elation ID stays the *lookup* key through 2b; the UUID becomes the *physical storage* key immediately.

**2. Re-key artifact storage off `firebaseUid` — once**

Today: `elation-artifacts/<firebaseUid>/<reportId>/report.pdf`. A re-claim orphans the files and unclaimed patients have nowhere to put artifacts.

End-state layout, decided now: `artifacts/<internalPatientId>/<documentId>/…`. Keying physical storage by Elation ID would embed an Elation-shaped identifier in the data we are trying to own independently, and would force a second object migration in 2b. One migration, UUID key, done.

Copy-forward: write to the new path, keep the old path readable during a dual-read window, delete only after the coverage audit passes.

**3. Ownership resolver — the biggest new attack surface, and a hard gate**

Physical ownership (files under the caller's uid, unguessable) is being replaced by a read-time check. Paths become guessable, so the resolver is the only thing between patient A and patient B's PDF. Non-negotiable guardrails:

- Bucket stays **fully private** — no public objects, no direct list access — so a guessed path is worthless without a server-minted signed URL.
- Signed URLs are minted **only after** ownership resolution passes (unchanged from today).
- **Dedicated adversarial red-team pass before cutover**, written as a permanent test suite: cross-patient path guessing, stale/replayed signed URLs, revoked grants, suspended patients, hidden items, and the 2b case where allowed ids expand to guardian + dependents. This is a **go/no-go gate**, not a nice-to-have.

**4. Self-heal — sweep-first, async on-miss**

A doc with `hasArtifact:true` and no stored object currently 404s forever. Fix without re-coupling the hot read path to Elation:

- **Nightly sweep is the primary healer.** It scans for the mismatch and repairs before any patient hits it.
- **On-miss is a rare backstop:** it enqueues an async repair and immediately returns a friendly "preparing your document" state. It never blocks a member on an Elation round-trip, so a slow or down Elation degrades to a calm message instead of a hang.

Both write an audit row. Repeated failures for the same document raise a health-check alert rather than retrying silently.

**5. Coverage audit**

A job that walks every document reference and proves the object exists in Storage, producing a report with a hard number. Go/no-go gate: no Elation exit and no 2b cutover below 100%.

**6. Close the member-coverage gap — exact set, not an estimate**

Reconciliation of the verified numbers (they do add up):

```text
Active members in Hint              976
  ├─ matched to a portal record     722
  └─ no portal record               254   <- to provision

Portal records                      764
  ├─ matched to an active member    722
  └─ no active Hint membership       42   <- not provisioned; review separately
```

The naive 976 − 764 = 212 assumes every portal record is an active member; 42 are not, which is what closes the gap. Before any bulk create: re-run the reconciliation, **exclude the `_testSeed` fixture** (Test Kieffer, `816455979040769`), and produce an exact, reviewable list. Staff select and confirm; creating a roster record does **not** send an invite — inviting stays a separate, deliberate action.

**Exit criteria for 2a:** artifact coverage 100%, red-team suite green, self-heal proven on a seeded miss, zero active Hint members without a portal record, old storage paths retired.

---

## Release 2b — Identity split and family access

**7. Account / record / grant split**

```text
account   { firebaseUid, email, phone }             <- a login
patient   { internalId, externalIds, demographics } <- the clinical record
grant     { accountId, patientId, relationship,
            permissions, effectiveFrom, effectiveTo,
            status, createdBy, verifiedBy,
            verificationMethod, reason }            <- the edge
```

One account can hold many grants; one patient can be reached by several accounts (both parents). Email and phone become attributes, never identity keys — which is what unblocks minors sharing a parent's email. Lookups flip from Elation ID to the UUID behind a mapping layer during this release; storage needs no change, it is already UUID-keyed.

**8. Guardian links — three creation paths, all verified**

- **Staff-mediated:** a guardian-link console in this app. Staff pick guardian and dependent, state the relationship, **record how it was verified**, and the grant is written server-side with an audit row.
- **Invite-for-dependent:** an invite scoped to a dependent that attaches to a guardian's already-verified account, reusing the Step 1 claim-token flow.
- **Hint auto-suggest, hardened:** a shared Hint contract is a *household*, not a guardianship — it can hold spouses, partners and unrelated adults. So: suggestions are **restricted to dependents who are minors by DOB** (an adult is never proposed as someone's dependent), the approval UI requires the verification method per link and **has no bulk-approve**, and adult-to-adult access is out of scope here — it routes through a separate consent flow where the adult consents for themselves.

Revocation is first-class — `effectiveTo` / `status`, reversible, audit row on every change (custody changes, disputes).

**9. Patient switcher and per-patient control plane**

After a guardian authenticates, the portal resolves their own record plus active grants and offers "Viewing: You / Child A / Child B". Every read — list and artifact — is scoped to the selected patient id, and the Step 1 `portalAccess` controls (module visibility, item hide, suspension) apply per that patient.

**Dual-guardian rule, stated up front:** control is a property of the *patient*, not the viewer. One `portalAccess` document per patient governs what every linked guardian sees — set a module off for a child and both parents lose it. Per-guardian differences are expressed only by revoking that guardian's grant, never by divergent module state. The panel labels this explicitly so staff aren't surprised.

**10. Policy engine for minors — conservative default**

The mechanism supports per-age and per-record-type gating from day one. What ships **enabled** is the conservative slice: guardian access for **young children only**, below a cutoff we set with you (a common line is 12). Adolescent records stay **gated off** until counsel signs off — disclosing protected adolescent information to a parent cannot be undone, so the default we ship live is a compliance decision, not a config detail. Age-out at majority is handled by the same engine.

**11. Proxy-aware audit**

Extend `phi_access_log` to record the acting account, the patient record viewed, the internal patient id, and the grant that authorised it — so every view of a child's record is attributable to the specific adult who made it.

---

## Carried over from Step 1, not rebuilt

Workload Identity Federation and keyless signing, the `portalAccess` control plane (modules fail open, suspension fails closed), short signed-URL TTLs, suppression-before-storage, audit-before-read, branch protection and PR/CI deploy discipline, and the member-UI module-off / suspended states.

---

## Cutover

Dual-read shadow period before any hard switch: serve from the new plane while verifying parity against the old, then cut over. Gated on 100% artifact coverage, the red-team suite green, parity verification, family-link data migrated, and audit continuity. Each release gets its own runbook and go/no-go, same as Step 1.

---

## Open, not blocking

- The exact age cutoff for the v1 guardian default, and the adolescent record-type list — counsel's call. 2a ships regardless; 2b ships with the conservative default and opens up by config once you have the read.
- Adult-to-adult proxy access (spouse, elderly parent) — deliberately deferred to its own consent flow.
