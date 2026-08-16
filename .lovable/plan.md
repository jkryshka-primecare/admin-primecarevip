# Full member roster + status filters in Member App Data

Today the Member App Data table asks the bridge for a single page of 100 documents, so the count badge stops at 100 no matter how many members exist. This adds full-roster loading and status filtering, staying strictly read-only.

## What changes

1. **Load every member, not just the first 100**
   - The read bridge already accepts an offset cursor and caps each request at 300 rows. Fetch pages in a loop until a short page comes back, then show the combined list.
   - Show a true total in the badge (e.g. "1,248 members") plus a small "loading page N" indicator while paging.
   - A safety ceiling (e.g. 10,000 docs) so a runaway collection can't hang the tab.

2. **Status filters**
   - Filter chips above the table: All / Active / Invited / Other, with live counts per bucket.
   - Buckets come from the `status` field on each member document; anything not `active` or `invited` lands in Other so nothing is silently hidden.
   - Filtering happens on the loaded roster, so switching is instant and costs no extra reads.

3. **Small usability additions on the same table**
   - A name/email/ID search box.
   - Row count line: "Showing X of Y".
   - Filters/search apply to whichever collection tab is open; the status chips only render for collections that actually have a `status` field.

## Technical notes

- `src/hooks/useFirestore.ts`: add an opt-in `fetchAll` mode to `useFirestoreList` that loops `cursor` in 300-row pages inside one query function and returns the concatenated docs plus the real total.
- `src/components/firestore/MemberAppExplorer.tsx`: consume the paged hook, add status chips + search, derive counts with `useMemo`.
- No edge function or database changes; the bridge stays read-only and every read is still logged to the PHI access log.

## Not in scope

Bulk invite actions from this table — that is Step 2 work once we can see who is still waiting.
