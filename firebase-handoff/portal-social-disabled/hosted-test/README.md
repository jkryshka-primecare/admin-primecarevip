# Disposable genuine Google hosted test

Project: pcvip-social-test only. Expires November 6, 2026, 23:59 UTC.

- Source: reviewed #589 five logical callables, plus testGoogleHarness; no blocking exports or registration changes.
- Public page: https://pcvip-social-test.web.app and equivalent firebaseapp.com origin.
- Google audience comes from the securely saved GOOGLE_OAUTH_CLIENT_ID. Public OAuth configuration is generated in temporary Hosting staging, never a private key.
- Owner operates Google sign-in for each A/B/C scenario. Genuine Google signature/audience/nonce validation is unchanged. Tokens are never stored, returned, logged or downloaded; only sanitized outcomes go to __googleHarnessResults/{A,B,C}.
- Prepare creates an expiring server-bound nonce, with flags off. A genuine designated Google response plus matching proof is required before synthetic fixture changes and temporary test flag enablement. Completion restores both test flags off in finally.
- Native Firebase Google/Apple remain disabled; direct IdP probe uses the genuine Google token. Successful logical callables return a custom token exchanged server-side; exact-case synthetic UID is checked.
- B uses explicitly synthetic Elation and Verify adapters, not production integration certification. New claims/hydration are deliberately outside this test page's scope. Apple deferred.
- A public test harness needs Cloud Run invoker transport permission on testgoogleharness only. Do not widen production IAM. Delete the disposable project after review.
- No hosted A/B/C pass may be claimed until the owner has completed the genuine sessions and sanitized results have been read back.
