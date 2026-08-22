# Release 2b — dependents, guardian proxy, and the 18th birthday

Admin-side matching lives in this repo (`src/lib/portal/dependents.ts` +
`src/components/firestore/DependentMatches.tsx`). This document is the contract
the member app and Cloud Functions must implement.

## Decisions (locked)

- **Minors get no login.** A guardian signs in to their own portal account and
  switches into the child's record. Siblings sharing an email is exactly why.
- **At 18 the child converts** to an independent account. On first sign-in the
  now-adult is asked whether to keep sharing with the guardian; the guardian's
  proxy is **suspended until they answer**.
- **A child may have more than one guardian.** Both parents on a household can
  each hold an independent, separately revocable proxy; `guardians[]` is a list
  and every entry is confirmed and audited on its own.
- **Guardian sees everything the child has** — same modules, same artifacts.
  No category-level withholding in 2b.
- **Link sources:** Hint household (same membership/contract id) is
  authoritative; shared email + last name is a heuristic. Neither is ever
  auto-applied — a staff confirmation is required for every link.

## Data model

`patients/<childElationId>.guardians[]`:

```
{
  guardianElationId: string,     // the proxy's portal record id
  guardianUid: string | null,    // resolved at first proxy use
  source: "hint_household" | "inferred_email_name" | "manual",
  status: "active" | "pending_adult_consent" | "revoked",
  confirmedBy: string,           // admin email
  confirmedAt: Timestamp,
  reason: string                 // audited, required
}
```

`patients/<childElationId>.dependent`:

```
{ isMinor: boolean, dob: string, convertsAt: Timestamp }  // convertsAt = 18th birthday
```

## Enforcement rules

1. Every artifact and list read already goes through the shared handler
   (`readArtifact.js`). Extend its identity check: a request is authorized when
   the caller's uid owns the record **or** an `active` guardian entry names them.
2. Suppression (`portalAccess.hiddenItems`, module toggles) is evaluated on the
   **child's** record, not the guardian's. A guardian must not see more than the
   child's own settings allow.
3. `pending_adult_consent` denies exactly like absence — the guardian sees an
   empty section, never "access was removed."
4. Proxy reads log to the PHI access log with both uids
   (`actingUid`, `subjectUid`).

## Functions (source in `functions/`, ready to commit)

- `adminLinkGuardian` — admin-only, requires reason, writes one guardian entry
  (idempotent per guardian; called once per parent), audited. Rejects a link where the child is 18+.
- `adminRevokeGuardian` — same shape, sets `status: "revoked"`. The entry is kept, never deleted.
- `dependentBirthdaySweep` — scheduled daily (07:15 America/New_York). For each
  child hitting 18: flips `dependent.isMinor` false, moves guardian entries to
  `pending_adult_consent`, provisions the now-adult's own invite.
- `memberSetGuardianConsent` — member-facing (patient token, own record only);
  sets each `pending_adult_consent` entry to `active` or `revoked`.

Shared model: `core/services/patient/guardians.js`.

### Install

Copy into the Firebase repo:

```
functions/adminLinkGuardian.js
functions/adminRevokeGuardian.js
functions/dependentBirthdaySweep.js
functions/memberSetGuardianConsent.js
functions/core/services/patient/guardians.js
```

Export from `functions/index.js`:

```js
exports.adminLinkGuardian          = require('./adminLinkGuardian').adminLinkGuardian;
exports.adminRevokeGuardian        = require('./adminRevokeGuardian').adminRevokeGuardian;
exports.dependentBirthdaySweep     = require('./dependentBirthdaySweep').dependentBirthdaySweep;
exports.memberSetGuardianConsent   = require('./memberSetGuardianConsent').memberSetGuardianConsent;
```

Two things to confirm on your side before deploy:

1. `dependentBirthdaySweep.js` imports the existing invite path
   (`core/services/patient/claimTokens` → `issueClaimToken`, and
   `core/services/email/sendInviteEmail`). Adjust those two paths/names to match
   the repo if they differ — the rest of the file is self-contained.
2. `memberSetGuardianConsent.js` uses `middleware/requireAuth`; the two admin
   functions use `middleware/requireAdminCaller` (already in the repo from the
   portal-admin handoff). Add the two new admin functions to the
   `lock-admin-invokers.yml` list and grant the `portal-admin` SA invoke rights.

Composite index required by the sweep:

```json
{ "collectionGroup": "patients", "queryScope": "COLLECTION",
  "fields": [ { "fieldPath": "dependent.isMinor", "order": "ASCENDING" },
              { "fieldPath": "dependent.convertsAt", "order": "ASCENDING" } ] }
```

### Batch loader

`scripts/load-guardian-links.js` walks the finalized CSV and calls
`adminLinkGuardian` once per row. Dry-run by default:

```bash
node scripts/load-guardian-links.js --csv ../guardian-links-final-2026-08-22.csv \
  --actor you@primecarevip.com --only-minor <fixtureChildElationId>        # dry run
node scripts/load-guardian-links.js ... --only-minor <id> --apply          # fixture
node scripts/load-guardian-links.js --csv ... --actor ... --apply          # full batch
```

Rows with an empty `minor_elation_id` are skipped and listed, so the one
unresolved child never silently drops out of the batch.

## Rollout

1. Ship the admin panel (done) and let staff work the queue: household matches
   first, then inferred, then the ambiguous list by hand.
2. Export confirmed links as CSV and dry-run `adminLinkGuardian` against the
   test fixture family before any production batch.
3. Smoke matrix, per case: guardian sees child's labs; guardian does **not**
   see a hidden child item; a revoked guardian sees nothing; a
   `pending_adult_consent` guardian sees an empty section.

## Non-patient guardians (`email_on_file`)

Some minors have no parent in Hint or Elation. Staff attach those guardians by
email from the roster panel, and the export carries them with:

- `match_source = email_on_file`
- `guardian_email` = the address to invite (the contact email on the child's chart, or one typed by staff)
- `guardian_elation_id` / `guardian_hint_id` = empty — there is no chart to point at

The control plane must provision these as an email-identified proxy: issue a
portal invite to `guardian_email`, and on claim bind that uid as a proxy on the
minor's record. Everything else (revocation, module visibility, audit) is
identical to a patient guardian. The CSV now always includes a
`guardian_email` column, also populated for patient guardians.

## Final export (2026-08-22)

`guardian-links-final-2026-08-22.csv` — staff-finalized, this is the batch to
load. 194 links across 176 minors (18 children with two guardians):

- 119 `inferred_email_name`
- 40 `email_on_file` (invite the address, bind proxy on claim)
- 35 `manual_search`

Validated: every row has a guardian email, no duplicate (minor, guardian) pairs,
no malformed addresses. `minor_elation_id` is populated for every minor except
one — **vivienn Schwab (`pat-SIz4AU3unU2i`)**, whose Elation chart did not
resolve; hold that row until the chart id is supplied manually. For 30
`email_on_file` rows staff left the guardian name as the email address; the
invite should fall back to the email for display.
