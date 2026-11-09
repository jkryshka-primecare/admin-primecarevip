# Portal SendGrid webhook review — PR #559

PR: https://github.com/primecarevip/prime-care-vip-app-v2/pull/559
Closes #362. Review head: `48dc6830287d8de5866dfd7a7de1194a2ed46e70`.

`PR-559-review.patch` is the full current-main diff. Source here is review staging, not part of the admin application or a deployable backend in this project.

- Separate portal/default-Firestore receiver; CRM database and CRM receiver unchanged.
- Runtime Secret Manager `SENDGRID_WEBHOOK_SIGNING_KEY`; timestamp + exact raw bytes verified before parsing/writing.
- Atomic event + suppression commits prevent a failed suppression write from being discarded on retry.
- Both collections allow admin/super_admin reads and deny ALL client writes.
- Local evidence: 32 receiver tests, 29 real Firestore tests, 2 callable-only entrypoint checks, existing auto-invite suite pass.
- New CI workflow runs receiver and real rules tests on a demo project; no production credentials.
- No merge/deployment, no switches/triggers changed. Current callable-only main is preserved.

## Release prerequisite

Historical CRM documentation associates `SENDGRID_WEBHOOK_SIGNING_KEY` with the CRM subuser. The user states the named secret already exists; this review does not read its value. Before releasing, confirm it contains the public verification key for the separate PORTAL webhook, not the CRM webhook. Separate keypairs are necessary for signature-based cross-delivery rejection. Endpoint deployment alone does not establish a live feed: #558 needs an authentic recent `emailEvents` record (within 7 days). No invite arming authorized.