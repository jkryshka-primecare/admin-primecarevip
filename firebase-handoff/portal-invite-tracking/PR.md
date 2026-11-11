# Portal invite tracking review

https://github.com/primecarevip/prime-care-vip-app-v2/pull/596

Commit: 3dc8e974a27c30376ec0bd4ee402c24cca1b5915

Nine focused sender/real receiver-classification tests passed locally; owning CI pending. Four committed files read back and matched local bytes. Replaces raw mailto header with configured ASM group, group links in both alternatives, and per-message subscription tracking (global footer clearly labeled). D-070 runtime wiring uses non-secret repository variable SENDGRID_PORTAL_INVITE_ASM_GROUP_ID_PRODUCTION. No SendGrid access: owner group/variable configuration and signed live opt-out acceptance are pending. Not merged/deployed; no sends. Historical full webhook suite cannot execute directly under this admin checkout's ESM package; no full-suite success claimed.
