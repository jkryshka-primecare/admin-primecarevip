# B4 read-side allowlist retirement — PR #593

Review-only source diff for primecarevip/prime-care-vip-app-v2.
PR: https://github.com/primecarevip/prime-care-vip-app-v2/pull/593
Head: 8b6c4926fe460b14603620f9d847eec2f13797e8
Base: d0be95b3034e19683072f137c5c6b2abc1e462cb
Closes #403 (documented existing issue; Issues create/read HTTP403, current state unverified).

Eight read handlers and shared artifact helper remove containment checks. All nine read handlers plus artifact helper pass original token.uid for exact patient.authUid validation after existing firebaseUid index lookup. Zero/duplicate bindings and missing/conflicting authUid fail closed. Non-read callers do not enable new exact-UID option; shared containment helper and discovery/invite/provisioning/claim/hydration/ingest/backfill/refill/deploy/rules/index/CRM byte-unchanged. No membership/lifecycle gate on reads. Guardian controls remain unchanged/off.

Local verification: exact committed CI runner 40 real Auth/Firestore/Functions tests PASS; 15 focused exact-UID/artifact tests PASS; 6 guardian + 2 no-blocker tests PASS; existing discovery, roster provision, auto-invite, refill tests PASS; syntax PASS. Test-only upstream stub asserts server-derived patient query. All fixtures synthetic. Published 20-file PR scope and critical contents verified.

Missing/conflicting authUid is a deliberate fail-closed hardening; no production roster backfill or repair performed. Read retirement does not hydrate never-ingested cached documents. Existing suspension/visibility unchanged. Other pre-existing staff-demographic read APIs remain staff-role authorized, not patient self-read endpoints; no allowlist there.

Full diff in PR-593-review.patch. No merge, deployment, Auth mutation, flags, triggers, sends or production configuration changed. GitHub CI status must be reviewed before merge.
