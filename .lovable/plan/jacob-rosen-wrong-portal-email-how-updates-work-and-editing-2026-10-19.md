# Jacob Rosen: wrong portal email, how updates work, and editing

## Answers

**Why it's wrong (likely, still to confirm).** The portal saves its own copy of a member's email once, when their portal record is first created. It never refreshes it on its own. Jacob's record was most likely created while his chart still had the typo (jacobrosen94, missing the "s"). Someone corrected Hint and Elation later, but the portal copy stayed. This is the same pattern as Brian Weiner and Maria Ducker. Step 1 below confirms this from the record's history instead of guessing.

**Does our system update in real time when Hint or Elation changes?** No.
- Patient screens (Overview, Meds, Problems, etc.) read Hint and Elation live, so they always show the current email.
- The portal's saved email does not update. Neither Hint nor Elation tells us when an email changes, and nothing checks for it on a schedule. It changes only when staff click **Refresh email from chart**.

**Editing Jacob's info.** You can already fix his email without code. His account is "Not claimed", so: pick a reason, click **Refresh email from chart**, confirm the change to jacobsrosen94@gmail.com, then click **Resend invite**. The old link stops working.
We should not add a free-typed email box. A typed address could send someone's health records to the wrong person. Fixing the chart and then refreshing keeps Elation as the one place the email is set.

**A real bug on that screen.** "Email matches the chart?" always shows a green check, even when it doesn't match. That's why it looked fine for Jacob. It should actually compare the emails.

## Plan

1. **Confirm the cause for Jacob (look only).** Check when his portal record was created, who created it, and with which email. Compare that with his Elation chart and its history. Report what happened.
2. **Fix Jacob.** Either you click Refresh + Resend, or I do it after you approve. Then I check that the new invite went to jacobsrosen94@gmail.com.
3. **Make the checklist honest.** When the Portal tab opens, do a no-change comparison against the chart. Show a red warning with both emails when they differ, plus a one-click fix button.
4. **Mismatch report.** Add a list in Member roster of every member whose portal email differs from their chart. It looks only and offers the same Refresh button per member. It runs when the page opens, because the project has no scheduled jobs.
5. **Stop invites going to stale emails.** Before **Resend invite**, quietly compare against the chart. If they differ, ask staff to refresh first.

## Technical details
- Comparison uses the existing `adminSyncMemberEmail` with `dryRun: true` (default), keyed by Elation patient ID. It reads the chart email and never writes. Fix `PortalHelp.tsx` (the hardcoded `ok: true` check), and add the dry-run call in `PortalAdminPanel.tsx`/`usePortalAdmin.ts`.
- The bulk report runs the dry-run per member in small rate-limited batches through `portal-admin`, for the roster's active or invited rows only. It never matches by email.
- The resend guard runs a dry-run before `issueInvite` in the panel. The server-side invite path is unchanged.
