# Google production audience and My Health Hub gates — November 5, 18:31 UTC request

## Status: neither gate certified; no production change

- #589 is merged: 12bf3f5d6112e04721bfed6a1a946ce774704e75, November 5 01:35 UTC, verified through GitHub.
- Current main deployment workflow has no SOCIAL_GOOGLE_CLIENT_IDS step environment entry and does not write that variable into the generated functions/.env.prive-care-vip. A redeploy using this workflow alone cannot fix the missing audience reported by the owner.
- Direct authorized service-account metadata reads returned HTTP 403. The configured WIF account could be impersonated, but production Functions and Identity Platform metadata reads also returned HTTP 403 and production functions.update permission was absent. Impersonating lovable-portal-readonly returned HTTP 403 PERMISSION_DENIED. Thus no production redeploy was attempted and live flags/triggers/audience were not independently verified.
- GitHub Actions secret listing returned HTTP 403. The saved Google OAuth client reference is available in this environment, but repository secret availability cannot be inferred from that. No saved value was printed or copied into a tracked file. Live frontend-to-server equality is not established.
- Apple remains deferred: no Apple audience wiring or provider settings changed.

## Durable audience proposal

production-google-audience-review.patch adds the named GitHub Actions GOOGLE_OAUTH_CLIENT_ID source to the deploy step, fails before deployment if absent, and writes SOCIAL_GOOGLE_CLIENT_IDS into the generated project-specific environment file. The patch is review-only and has not been pushed to the portal repository. An authorized operator must securely populate that repository secret from the approved web OAuth configuration. Do not confuse client ID with client secret; do not log either saved value.

The patch intentionally preserves deployment commands. For the immediate authorized rollout, deploy only the five reviewed social callables through the owning production deployment process. Never register blocker resources or change native providers. Confirm the current entrypoint excludes blocker imports/exports, flags are off, and triggers None pre/post. Preserve other runtime variables and secret references. Verify the Google audience on all five live callable resources afterward; a config-source change alone is not deployment evidence. Keep Apple unset in the deployed runtime.

## My Health Hub: owning-project application required

- Latest accessible snapshot remains cb2ef5ec, checked out read-only. No social controls have been applied there.
- Existing review diff: firebase-handoff/portal-social-ui/my-health-hub-social-controls-review.patch.
- Patch dry-run passes against a disposable copy of the current snapshot; all ten focused frontend tests pass. This is not an owning-project applied diff, browser test, or public release.
- The approved flow remains GIS Google ID token -> server-bound socialBeginAttempt -> socialLinkExisting or socialStartVerification/socialConfirmVerification -> server custom token -> existing signInWithToken. No direct Firebase social sign-in.
- Set explicitly public VITE_SOCIAL_GOOGLE_CLIENT_ID in the owning Hub project to the approved web OAuth client ID used by the server; review its configuration there. Keep displayEnabled false and Apple return configuration empty.
- Open My Health Hub's own chat to apply this patch, review its native diff, and run its checks before publishing. This chat cannot write another project's release or create an applied native diff for it.

## Holds

No flag-on, trigger registration, canary, production Auth mutation, messages, domain changes, merge, or deployment occurred in this request. Gate 1 waits on owning-project application and verification. Gate 2 waits on authorized production deployment and live verification. No credentials should be pasted in chat.