# Portal invite tracking review

https://github.com/primecarevip/prime-care-vip-app-v2/pull/596

Commit: c299b2a69bc0052c576c73e7ff9064f9ea753d57

Nine focused sender/real receiver-classification tests passed locally; owning CI pending. Three amended files read back and byte-verified. Group-only amendment: configured ASM group and group links in both alternatives, with per-message subscriptionTracking.enable=false and no global footer. Owner-created Portal Invitations group ID 36716 goes in non-secret repository Actions variable SENDGRID_PORTAL_INVITE_ASM_GROUP_ID_PRODUCTION; existing D-070 runtime wiring is unchanged. Existing group_unsubscribe classification produces hard emailSuppression; local portal suppression remains address-wide, not a SendGrid global list mutation. No SendGrid access: variable/live settings and actual group opt-out → no new global unsubscribe → signed event → suppression → next-invite denial remain unverified. Not merged/deployed; no sends. Historical full webhook suite cannot execute directly under this admin checkout's ESM package; no full-suite success claimed.
