# Portal invite tracking and authorized one-email smoke test

Normal portal sender change: `trackingSettings.clickTracking.enable=false`, `enableText=false`, `openTracking.enable=true`. Shared by invite/reissue paths; no global SendGrid tracking or CRM configuration change.

Tests exercise the actual normal sender through a stubbed transport and credential reader; no test sends occur.

Nov 11: main sender was HTML-only. Adds text/plain before text/html with matching claim link/expiry. Supersedes the earlier raw mailbox header: sender uses `asm.groupId`/`groupsToDisplay` from validated positive-integer `SENDGRID_PORTAL_INVITE_ASM_GROUP_ID`, group unsubscribe substitution in both alternatives, and per-message subscription tracking enabled. No custom List-Unsubscribe or List-Unsubscribe-Post: SendGrid owns headers/HTTPS endpoint. Subscription tracking is account-wide, not group-only; its global footer is explicitly labeled separately from the portal-invitation group footer. No account-wide tracking toggle or CRM change.

Production workflow follows D-070: repository variable `SENDGRID_PORTAL_INVITE_ASM_GROUP_ID_PRODUCTION` goes to the project-scoped runtime env. Group ID is non-secret; no fabricated default. Missing/invalid ID refuses transport before credential access. Create/select main-account ASM group **Portal Invitations**, wait at least one minute after creation, populate that variable before deployment, and ensure the portal signed Event Webhook has **Unsubscribe** and **Group Unsubscribe** events enabled. No SendGrid connection is available here, so account group creation/configuration is NOT performed or verified.

Existing receiver classifies unsubscribe and group_unsubscribe into emailSuppression; focused tests exercise the real classification source. The existing collection is address-wide, so this retains its current broad suppression policy (not a new per-group local collection). Real acceptance is still a release gate: authorized synthetic/staff message through normal send, inspect delivered MIME and managed headers, opt out through SendGrid, read genuine signed event + suppression, and verify next invitation refused before mint. No live flow is certified by mocked transport/classification tests; Gmail UI and inbox placement are not guaranteed.

The one live staff test is NOT sent: existing portal service identity cannot read `SENDGRID_API_KEY` (`secretmanager.versions.access` HTTP 403). No existing generic non-member test-email function was found. Do not call a member-invite endpoint with a staff email, mint a claim token, start a wave, or change holds to bypass this.

Owner can send one non-PHI message using the normal main-account key, from `health@primecarevip.com`, to the explicitly authorized staff address, category exactly `portal_invite`, clicks off/opens on. Alternatively arrange a narrowly scoped approved operator execution; do not broaden temporary read-only diagnostic grants casually. Verify SendGrid acceptance, then correlate resulting genuine portal `emailEvents` by message ID and confirm category. Gmail header inspection remains owner-operated.

Source change must merge/deploy in the owning portal repository to affect live invites. No deployment, SendGrid settings mutation, production send, Firestore write, flag change or trigger registration performed here.

Owner confirmed health@primecarevip.com is monitored, but mailbox parsing/action is superseded by the managed unsubscribe design. No new endpoint or email-based patient locator is introduced. No suppression records written or sends performed.