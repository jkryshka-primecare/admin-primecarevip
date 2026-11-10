# Invite email pre-check (one-time, read-only)
In-house syntax + MX/A check (domain-only DNS, cached per domain) for portal invite candidates. Replaces SendGrid Bulk Validation, which is a paid add-on and was declined.
- Reads Hint active members, Firestore patients/claimTokens/emailSuppression/emailEvents. Writes nothing to Firestore and sends nothing.
- Members are matched by hintPatientId, then by a unique name+DOB match. Never matched by email.
- Outcomes: send / risky (role or disposable address) / correction (bad syntax, likely typo, DNS error) / suppress (domain has no MX/A only). Minors are held.
- Outputs are review import files; the team applies them after review.
Run: `FIREBASE_SERVICE_ACCOUNT=... HINT_PRACTICE_API_KEY=... node invite-email-precheck.js`
