# Team access: emailed invites, remove access, delete user

All three go into the existing **Administration → Users & Invitations** tab.

## 1. Email invites automatically
- "Invite user" sends a branded email straight to the person, from your verified sender (notify.admin.primecarevip.com). The email contains their sign-up link.
- The link is still shown and copyable, as a backup.
- If the email fails, the invitation is still created and the screen says the email didn't go out, so you can copy the link instead.
- Pending invitations get a **Resend email** button.

## 2. Remove access (reversible)
- Every user row gets a **Remove access** button. You must give a reason, and it's logged.
- It signs the person out of every device, blocks any new sign-in, and takes away their role.
- **Restore access** undoes it. You then pick their role again.
- Removed people stay listed under "Access removed", so the history is kept.

## 3. Delete user (permanent)
- A **Delete** button sits on each user row. To confirm, you type the person's email.
- It deletes the login completely. Their past actions stay in the audit logs, with their email still on each entry.
- Only super admins can delete. Admins can remove access but can't delete.

## Safety rules (all three)
- You can't remove or delete yourself.
- The last remaining super admin can't be removed or deleted.
- The internal portal system account can't be removed or deleted, and it stays hidden from this list.
- Every action is recorded: who did it, to whom, when and why.

## Technical details
- New invite email template added to the existing app email system. `admin-invite-user` queues it after creating the invitation row and returns `email_sent: true/false`.
- New backend function `admin-manage-user` with actions `disable`, `enable` and `delete`:
  - Checks the caller's role on the server: admin for disable and enable, super_admin for delete.
  - Refuses self-actions, the last super_admin, and the bridge account (c85a8977-…).
  - **disable:** bans the auth user (indefinite ban duration), revokes their sessions, removes their roles, and sets `profiles.access_removed_at` / `access_removed_reason`.
  - **enable:** lifts the ban and clears those fields. The role is re-picked through the existing role change flow.
  - **delete:** deletes the auth user. Foreign keys that point at `auth.users` without cascade (audit tables) are checked, and switched to SET NULL where needed so history survives.
  - Each action writes a row to `role_change_audit` / `audit_log`, including the target's email.
- Migration: add nullable `access_removed_at` and `access_removed_reason` columns to `profiles`, and adjust the audit foreign keys to `ON DELETE SET NULL`. Additive only.
- UI: `UsersAdmin` gains the action buttons, reason and type-to-confirm dialogs, an "Access removed" section, and a Resend button on invitations.
