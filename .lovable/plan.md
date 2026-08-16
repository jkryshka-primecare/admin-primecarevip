# Member roster: make Hint the source of truth

## The problem

The Member App Data tab counts portal roster documents in Firestore (764). That is "who has a member-app record", not "who is a member". Membership truth lives in Hint, where 609 active membership contracts cover 998 distinct patients — because one contract can cover a whole family.

Verified live counts:

```text
Hint memberships (all)            927   active 609 | ended 298 | unpaid 12 | pending 8
Hint active memberships           609   contracts
Patients on an active membership  998   <- the real member count
Hint patients (all charts)      2,143
Firestore portal roster           764   what the tab shows today
Gap                              ~234   active members with no portal record
```

## What to build

### 1. A canonical member roster from Hint

Add a read-only path that pages Hint `memberships` (limit/offset, 100 per page — Hint ignores `per_page`) and flattens `membership_patients` into one row per covered person, carrying:

- Hint patient id, name, email, phone
- Elation patient id (the join key, from the Hint patient record)
- membership status, member type (primary vs dependent), start/end dates
- the owning membership id, so families group together

Filter to memberships with `status === "active"`, and drop individual member lines whose own `status` is terminated. That yields the defensible active-member list.

### 2. Reconciliation against the portal roster

Join the Hint roster to the Firestore `patients` collection on Elation patient id and bucket every person into:

- **Active member, portal active** — claimed and using it
- **Active member, portal invited** — invited, not yet claimed
- **Active member, no portal record** — the ~234; these cannot even be invited today
- **Portal record, no active membership** — lapsed or ended, candidates for review

### 3. Surface it in the Member App Data section

Replace the current status chips with these four buckets, each showing a live count against the Hint denominator, plus:

- a headline reading "998 active members - 764 with portal records"
- search across name, email, phone, Hint id, Elation id
- a per-row indicator of which system each person was found in

## Technical notes

- `supabase/functions/hint-live/index.ts` already allows the `memberships` resource; paging uses `query: { limit: 100, offset: n }`. Hint returns the true total in the `x-total-count` header.
- Firestore paging already exists via `fetchAll` in `src/hooks/useFirestore.ts` (300 rows per page through `firestore-bridge`).
- New work is a hook that fans out both sources and joins them, consumed by `src/components/firestore/MemberAppExplorer.tsx`.
- Everything stays read-only. No writes to Hint, Elation, or Firestore; no invites are issued as part of this.

## Out of scope

Bulk-inviting the missing members. This plan only makes the gap visible and countable; sending invites is a separate, explicitly approved step.
