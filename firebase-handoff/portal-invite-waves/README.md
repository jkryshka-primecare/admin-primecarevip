# Portal invite wave runner (review-only, issue #594)
Patch against prime-care-vip-app-v2 @ d1deacf6. Not pushed, merged, or deployed; nothing sent.
- Sends via existing `adminBatchReissue` -> `inviteOne` -> `sendInviteEmail` (from health@primecarevip.com).
- Scope: adult members with a portal record in live/expired-invite buckets (501). The 1 claimed-not-hydrated member is excluded (reissue refuses claimed accounts; needs hydration repair). No-account adults and minors excluded.
- Adds SendGrid category `portal_invite`; webhook stores only that allowlisted category.
- `inviteOne` checks emailSuppression before mint, fail-closed.
- Waves 20 -> 35 -> 50 -> 50..., in pre-check send order. Gate before each wave N>1: prior wave bounce+dropped <2%, spam <0.1%, settle window (default 48h), event feed readable.
- Live requires `--wave N --go` and `config/inviteWaves` {domainPrepComplete:true, approvedThroughWave>=N, enabled:true}; `BATCH_REISSUE_ENABLED` and the reissue kill switch still apply.
- Tests: `node functions/test/unit/invite-waves.test.cjs`.
