# #636 — verification before implementation

## Confirmed

- Current main: `1d77a914a41d0b762f9ab443029ed7c408238e27`, the squash merge of #635. Production deployment #717 succeeded on this exact revision (completed November 27, 2026, 22:41:14 UTC).
- Live `provisionRosterDocs`: `ACTIVE`, updated `2026-11-27T22:38:53.527Z`; runtime service account is `prive-care-vip@appspot.gserviceaccount.com`.
- `functions/provisionRosterDocs.js:177–206`: SELECT checks existing document (190), cohort (195), then `evaluateDiscoveryAge` (200), then builder (206). No Hint membership check/import exists.
- `functions/core/services/patient/memberSafeguards.js:58–67`: `matchActiveMembership` returns the requested `ok` and `reason` values: `HINT_SINGLE_ACTIVE`, `HINT_AMBIGUOUS`, `HINT_NOT_ACTIVE`, `HINT_NO_MEMBER`; membership matches first name + last name + DOB, not email.
- `memberSafeguards.js:107–115`: discovery's `evaluateNewMember` uses the supplied `hintPatientsByLastName` lookup and this exact matcher.
- `functions/core/services/hint/client.js:12–29,42–66`: the shared client reads `HINT_PRACTICE_API_KEY` at runtime using `SecretManagerServiceClient`, with fail-closed typed errors.

## Blocker: current access cannot be independently confirmed

The current diagnostic identity can read live function metadata, but both secret `getIamPolicy` and project `getIamPolicy` returned **403 PERMISSION_DENIED**. This is a denial to the diagnostic identity, **not proof the function lacks access**.

The owner confirmed on October 14 that the Hint secret was enabled and secretAccessor was granted to this same Appspot account. That is useful historical evidence, but does not independently verify the current grant.

Implementation is held at VERIFY FIRST item 3. No runtime code, tests, remote branch or PR created; no production invocation, data mutation, Hint query, secret payload read, permission change, merge, deploy, send or arming. Temporary diagnostic tests were removed.

## Minimal owner verification — no secret contents

Run in Google Cloud Shell for the portal project:

```sh
gcloud secrets get-iam-policy HINT_PRACTICE_API_KEY \
  --project=prive-care-vip \
  --flatten='bindings[].members' \
  --filter='bindings.role=roles/secretmanager.secretAccessor AND bindings.members=serviceAccount:prive-care-vip@appspot.gserviceaccount.com' \
  --format='json(bindings.role,bindings.members,bindings.condition)'
```

Provide the filtered result only — never the key. A current unconditional matching binding confirms the narrowly scoped grant; any conditional binding needs its condition checked. If empty, inherited project-level access must be checked before declaring the runtime grant absent.

**Only if no effective grant exists**, the required secret-scoped permission is:

```sh
gcloud secrets add-iam-policy-binding HINT_PRACTICE_API_KEY \
  --project=prive-care-vip \
  --member='serviceAccount:prive-care-vip@appspot.gserviceaccount.com' \
  --role='roles/secretmanager.secretAccessor'
```

The first command is read-only; the second changes IAM and is not executed here. No Auth/provisioning permissions or key disclosure are needed.

## Remaining approved work once verification clears

Implement only the backfill handler membership gate after age and before builder, cache lookup outcomes by lowercase surname, add real-handler regression tests, preserve existing tests, prepend/append documentation without changing historical content, and open a draft PR from current main on `fix/provision-roster-hint-gate`, body `Closes #636`. Run local suite with count and require the full real hosted claim-hydration gate green. No merge/deploy/arming.
