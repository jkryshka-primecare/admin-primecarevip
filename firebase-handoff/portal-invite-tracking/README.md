# Portal invite tracking and authorized one-email smoke test

Normal portal sender change: `trackingSettings.clickTracking.enable=false`, `enableText=false`, `openTracking.enable=true`. Shared by invite/reissue paths; no global SendGrid tracking or CRM configuration change.

Tests exercise the actual normal sender through a stubbed transport and credential reader; no test sends occur.

The one live staff test is NOT sent: existing portal service identity cannot read `SENDGRID_API_KEY` (`secretmanager.versions.access` HTTP 403). No existing generic non-member test-email function was found. Do not call a member-invite endpoint with a staff email, mint a claim token, start a wave, or change holds to bypass this.

Owner can send one non-PHI message using the normal main-account key, from `health@primecarevip.com`, to the explicitly authorized staff address, category exactly `portal_invite`, clicks off/opens on. Alternatively arrange a narrowly scoped approved operator execution; do not broaden temporary read-only diagnostic grants casually. Verify SendGrid acceptance, then correlate resulting genuine portal `emailEvents` by message ID and confirm category. Gmail header inspection remains owner-operated.

Source change must merge/deploy in the owning portal repository to affect live invites. No deployment, SendGrid settings mutation, production send, Firestore write, flag change or trigger registration performed here.