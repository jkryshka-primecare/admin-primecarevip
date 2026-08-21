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

## Functions to add

- `adminLinkGuardian` — admin-only, requires reason, writes one guardian entry
  (idempotent per guardian; called once per parent), audited. Rejects a link where the child is 18+.
- `adminRevokeGuardian` — same shape, sets `status: "revoked"`.
- `dependentBirthdaySweep` — scheduled daily. For each child hitting 18:
  flips `dependent.isMinor` false, moves guardian entries to
  `pending_adult_consent`, provisions the now-adult's own invite.
- `memberSetGuardianConsent` — called by the member app after the new adult
  answers; sets each guardian entry to `active` or `revoked`.

## Rollout

1. Ship the admin panel (done) and let staff work the queue: household matches
   first, then inferred, then the ambiguous list by hand.
2. Export confirmed links as CSV and dry-run `adminLinkGuardian` against the
   test fixture family before any production batch.
3. Smoke matrix, per case: guardian sees child's labs; guardian does **not**
   see a hidden child item; a revoked guardian sees nothing; a
   `pending_adult_consent` guardian sees an empty section.
