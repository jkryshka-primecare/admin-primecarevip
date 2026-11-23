# Pamela Marcus — "date of birth doesn't match" on portal claim

## What the screenshot shows
Her password passes, but the claim is refused at the date-of-birth check. She entered Apr 9, 1967 (sent as 1967-04-09). So the problem is the DOB comparison, not the password or the invite link.

## Read-only investigation (change nothing, send nothing)
1. Find her patient record by name in the portal roster, then confirm by chart ID (never by email). Report patient ID only.
2. Compare the DOB stored on her portal patient record with 1967-04-09, and with the DOB on her Elation chart and Hint record.
3. Check the invite token she used: which patient ID it points to, whether it's unused/unexpired, and whether it belongs to her record (e.g. a duplicate or wrong record).
4. Check the DOB attempt throttle for that patient (how many failed tries, whether she's now locked out).
5. Look for duplicate "Pamela Marcus" records that could have received the invite.

## Likely causes to confirm or rule out
- Stored DOB differs (typo, day/month swapped, or a timezone shift storing 1967-04-08).
- Invite was issued to a different/duplicate record.
- Stored DOB missing or in an unexpected format.

## Deliverable
A short report: root cause, her patient ID, which source is correct, and the smallest safe fix (e.g. correct the chart DOB at the source, then re-sync) for your approval. No data changes or reissued invites without separate approval.
