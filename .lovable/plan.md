# Restore portal access now — don't wait for the cutover

Recommendation: fix these members today. Helping someone into care.primecarevip.com does not create cutover work. The new portal reads the same claim and access state, so a member who claims today carries that state forward — re-inviting now is not a throwaway action.

Waiting has real cost: a member locked out of their own chart is a service failure, and with only a handful complaining, this is small enough for staff to handle one at a time.

## The catch — find out why before re-inviting

The tooling already exists in Prime Care OS (Patients → member → Portal tab): send/resend invite, revoke invite, suspend/restore access, per-module visibility. But three of the plausible causes look identical from the member's side and only one is fixed by re-inviting:

- Never invited, or the claim link expired — resend the invite. Real fix.
- Access suspended (admin-set) — resending does nothing; restore access instead.
- Signed in but a module is hidden or the chart is empty — an access/coverage issue, not a claim issue. Resending hides it.

So the first move is not "re-invite everyone", it's "read each member's Portal tab and act on what it says".

## What to do today (no code needed)

1. Get each complaining member's name and confirm which of the three symptoms they hit: never got in, can't sign in, or signed in but nothing there.
2. Open Patients → find the member → Portal tab. It already shows claim state, invite status, suspension, and module visibility.
3. Act on what it shows: resend invite for not-invited/expired, restore access for suspended, escalate to engineering for signed-in-but-empty.
4. Note the outcome per member. If more than one lands on the same cause, that's a systemic issue worth chasing rather than a run of bad luck.

## What I'd build to make this repeatable

Right now staff have to already know which member is broken and find them through Patients. Two small additions:

**1. A "Portal access triage" card on the Admin → Member App Data tab**

Search a member by name or email, see the same claim/access snapshot the Portal tab shows, and take the same three actions inline — without navigating through Patients or knowing an Elation ID. Reuses the existing `usePortalAdmin` hook and `portal-admin` function; no new backend.

**2. A "Locked out" bucket in the existing exception lists**

The roster already buckets members by why they lack a portal record. Add a bucket for members who have a portal record but are not usable: never invited, invite expired, or suspended. That turns "patients are complaining" into a list staff can work down, and would have surfaced this before anyone called.

Neither touches the read path, the cutover, or portal access policy. Former members keep read-only access as always — nothing here revokes anyone.

## Technical notes

- Surfaces: `src/pages/admin/AdminHome.tsx` (Member App Data tab), reusing `src/pages/patients/PortalAdminPanel.tsx` logic and `src/hooks/usePortalAdmin.ts`.
- Backend: existing `supabase/functions/portal-admin` passthrough (`get`, `invite`, `revoke`, `setAccess`). No new functions, no schema change.
- Claim states come from `adminGetPortalAccess`: `claimed` / `invited` / `expired_or_revoked` / `not_invited`. The "locked out" bucket is `expired_or_revoked` + `not_invited` + `status === 'suspended'`.
- All actions stay admin-gated and audited to `portalAdminAudit` exactly as today.

## Suggested order

Do step 1–4 manually this morning for the handful who complained. Then build the triage card, then the bucket.
