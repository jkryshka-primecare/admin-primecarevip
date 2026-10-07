# Check Christianna Elash's family access (look only, change nothing)

## What I can and can't do
I can't sign in as Christianna. That would need her password, and impersonating a patient isn't allowed under HIPAA. Instead I'll read her portal records directly. That shows the same thing her login would: which children she's linked to and whether those links are turned on.

## What we already know
The family list from Aug 22 links Christianna (chart 1137115541209089) as parent of two children:
- **John Elash IV**, born Oct 8, 2012 (chart 1056187192442881). Also linked to John Elash III.
- **Elena Christianna Elash**, born Dec 3, 2009 (chart 1056182001336321). She turns 18 on Dec 3 this year, and parent access then ends automatically.

**Her husband (John Elash III)** is an adult. He can't sit under her login. He needs his own portal account and his own email address.

## The check (looking only)
1. Christianna's portal record. Confirm her account is activated and see which children the portal links to her.
2. Each child's portal record. For each one, confirm the link to Christianna is active (not pending or revoked) and that the portal still treats them as a minor.
3. Whether the portal's parent-viewing feature is turned on for her. It's currently limited to an approved test list.
4. Whether John Elash III has a portal account of his own.

Nothing is sent or changed. I won't send any invites.

## What you'll get back
A short answer for each family member: can she see them today, yes or no, and why. You'll also get a draft reply to her email. The draft will explain that:
- the children appear under her own login, so they don't need their own emails,
- her husband needs his own invite, and
- she doesn't need a new link for the kids.

## Technical details
- Read portal records through the read-only Firestore connection: `patients/{id}` for all four charts, including `guardians[]`, `dependent.isMinor`, claim state and `internalUid`.
- Read the guardian-read gate (`GUARDIAN_READS_ENABLED` and the allowlist). The current allowlist is limited to the test account, so she likely can't view the children yet, even with active links.
- The lookup is keyed by chart ID only, with no email matching.
