# Portal SendGrid webhook review — PR #559

PR: https://github.com/primecarevip/prime-care-vip-app-v2/pull/559
Closes #362. Review head: `00e2b93037688ce472c7fd021eff919a8fe9076c`.

`PR-559-review.patch` is the full main-base diff at this review head; `PR-559-portal-key-correction.patch` isolates the subsequent key/code/test correction. Source here is review staging, not part of the admin application or a deployable backend in this project.

- Separate portal/default-Firestore receiver; CRM database and CRM receiver unchanged.
- Runtime Secret Manager `SENDGRID_PORTAL_WEBHOOK_SIGNING_KEY` only; timestamp + exact raw bytes verified before parsing/writing. No fallback to the CRM key.
- Atomic event + suppression commits prevent a failed suppression write from being discarded on retry.
- Both collections allow admin/super_admin reads and deny ALL client writes.
- Local evidence: 33 receiver tests (dedicated secret lookup, no CRM fallback, distinct-key signature rejection), 29 real Firestore tests, 2 callable-only entrypoint checks pass. Existing auto-invite suite passed on the preceding review head; shared suppression logic unchanged in this correction.
- New CI workflow runs receiver and real rules tests on a demo project; no production credentials.
- No merge/deployment, no switches/triggers changed. Current callable-only main is preserved.

## Release prerequisite

Recorded topology: portal feed uses the SendGrid main account; CRM uses the dedicated `primecarevip-crm` subuser, separate webhook and separate signing key. Live SendGrid settings were not audited in this change. At configuration time, populate NEW `SENDGRID_PORTAL_WEBHOOK_SIGNING_KEY` in Google Secret Manager with the main account's PORTAL Event Webhook public verification key and grant the portal receiver runtime access. Leave CRM `SENDGRID_WEBHOOK_SIGNING_KEY` unchanged. No value was read, created or changed. Until the portal key is available the receiver fails closed with 503. Endpoint deployment alone does not establish a live feed: #558 needs an authentic recent `emailEvents` record (within 7 days). No invite arming authorized.