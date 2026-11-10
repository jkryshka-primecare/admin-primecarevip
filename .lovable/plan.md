# Validate portal invite list with SendGrid (no sends)

## Goal
Clean the ~715 invite candidates through SendGrid Bulk Email Validation, then report counts only. Nothing is sent.

## Steps
1. **Build the candidate list (read-only).** Use the live coverage buckets: expired invite (~506), never invited (~159), no portal account (~43), live invite (6), deferred (1). Members are keyed by patient record ID, never by email. For each member, use the email on their chart record. Remove duplicate emails and anything already in `emailSuppression`. Keep the email→member ID map in temporary storage only. Write a one-column CSV with the header `emails`.
2. **Run the validation job.** Create the job with `PUT /v3/validations/email/jobs {"file_type":"csv"}`, upload to the returned `request_uri` with the returned headers, check the job until it finishes, then download the results. The key is read from the environment only; it is never printed or saved.
3. **Sort each result.**
   - Valid: can be sent.
   - Invalid, bad syntax, no MX/A record, or known bounces: remove and add to suppression.
   - Risky (role or disposable address, score about 0.5–0.8): keep, but hold for the final waves.
   - Typo suggestion: add to a needs-correction list. The member's address is never edited automatically.
4. **Outputs.**
   - Chat summary with counts only: Valid, Risky, Invalid, removed, added to suppression, flagged for correction.
   - A sendable list keyed by member ID, in send order: live invites and recently active first, never invited and no account next, the 506 long-expired last, Risky in the final wave.
   - Suppression records and the needs-correction list written in the portal project. Files hold IDs only where possible; anything that contains emails stays inside PCVIP infrastructure.

## Blockers to clear before running
- **Validation key:** `SENDGRID_VALIDATION_API_KEY` is in Doppler, and this workspace can't reach it. You need to provide it as a secure secret here (secure form, never pasted into chat). Or run the script yourself in an environment that holds the key.
- **Permission to write suppression and the correction list:** the portal account I use can only read. Writing those records needs one of these:
  - (a) temporary write access limited to those two lists, or
  - (b) I prepare a reviewed import file, and your team applies it, or
  - (c) a small reviewed admin function in the portal codebase.
  My recommendation is (b) or (c), because suppression affects every future send.
- **Where the correction list goes:** I need to know where the A2 cleanup picks it up, for example a Firestore collection name.

## Technical details
- A standalone script under `firebase-handoff/portal-invite-validation/` uses the same resolver and buckets as the coverage audit. It joins members by patient record ID; emails are not used to match members.
- Suppression documents follow the #559 schema (source `sendgrid_validation`, verdict, checks, timestamp). The document key matches the receiver's hashed-email convention.
- Nothing goes to any validator outside SendGrid. Logs show counts only. The temporary files containing emails are deleted after use.
