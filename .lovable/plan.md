# Validate portal invite list with SendGrid (no sends)

## Goal
Clean the ~715 invite candidates through SendGrid Bulk Email Validation. The chat report contains counts only. Nothing is sent, and nothing is written to production.

## Steps
1. **Build the candidate list (read-only).** Use the live coverage buckets: expired (~506), never invited (~159), no account (~43), live invite (6), deferred (1). Members are keyed by patient record ID and never matched by email. Remove duplicate emails and any address already in `emailSuppression`. Write a one-column CSV with the header `emails`. The email→member ID map stays in temporary storage only.
2. **Validate.** Create the job with `PUT /v3/validations/email/jobs {"file_type":"csv"}`, upload to the returned `request_uri` with the returned headers, check until the job finishes, then download the results. `SENDGRID_VALIDATION_API_KEY` is read from the environment only and is never printed or saved.
3. **Sort each address into one of three outcomes:**
   - **Hard-suppress (only addresses that can never be delivered):** `has_mx_or_a_record = false` OR `has_known_bounces = true`.
   - **Hold for correction (A2 review, held out of sends, not suppressed):** plain Invalid, `has_suspected_bounces = true`, bad syntax, any typo suggestion, and Risky (role or disposable).
   - **Send-eligible:** everything else that is Valid.
   - Patient addresses are never edited automatically.
4. **Outputs (option b: a reviewed import, applied by your team):**
   - Chat summary with counts only: Valid/Risky/Invalid verdicts, plus totals for send-eligible, hold-for-correction, and hard-suppress.
   - A sendable list keyed by member ID, in send order: live invites and recently active first, never invited and no account next, the 506 long-expired last.
   - An import file for `emailSuppression` (hard-suppress only), following the #559 schema with source `sendgrid_validation`.
   - An import file for the new collection `inviteEmailCorrections` in the portal project: member ID, reason, verdict/checks, and SendGrid's suggestion.
   - These files contain emails, so they go to your secure handoff location only, never into chat. I write nothing to Firestore and take no write access.

## Before running
- Wait for you to confirm `SENDGRID_VALIDATION_API_KEY` is loaded through the secure form.

## Process note (your question 5)
- The script lives in the review-only `firebase-handoff/` folder of this admin project. It is a one-time catch-up tool and isn't committed to the portal repository, so no issue is needed. When this becomes the recurring admin function for the new-member automation, that work gets its own issue and PR.

## Technical details
- Script: `firebase-handoff/portal-invite-validation/`. It uses the coverage-audit resolver and joins members by patient record ID, never by email.
- Hold-for-correction is checked first, then hard-suppress, so an address with a typo suggestion is never suppressed unless SendGrid confirms it as dead (no MX/A record or known bounces).
- No validators outside SendGrid are used. Logs show counts only. Temporary files containing emails are deleted after the import files are produced.
