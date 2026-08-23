# Read-path `reason` enumeration (portal ↔ admin OS contract)

**Authority: the handler, not this doc.** `core/services/artifacts/readArtifact.js`
shipped in Release 2a, is red-team covered, and the member UI
(`artifact-read-contract`) is already built against its exact answers. This file
was drafted ahead of that code and disagreed with it in two places; both are
resolved in favour of the handler. A token change now lands in the handler and
this doc in the same PR.

Two settled decisions, previously in conflict:

1. **`ARTIFACT_NOT_SYNCED`, not `ARTIFACT_SUPPRESSED` / `ITEM_HIDDEN`.** The
   handler has exactly one absence token: hidden item, module off, deleted
   reference, wrong module, unauthorized guardian and never-synced all throw the
   identical `404 NOT_FOUND / ARTIFACT_NOT_SYNCED`. That single token is the
   point — absence is never distinguishable from forbidden. Do not reintroduce
   finer-grained absence tokens.
2. **"Preparing" is `200 { state: 'preparing' }`, not `409 ARTIFACT_NOT_READY`.**
   Reference present + object missing enqueues a repair and answers 200 with a
   body state. It is not an error: the portal renders a calm preparing state and
   polls (5× at 8s). `ARTIFACT_NOT_READY` / 409 is **withdrawn** — no handler
   emits it and the portal must not branch on it.

Every enforcing read handler answers a refusal with
`{ error: { code, status, message, details: { reason } } }`. `reason` is the
machine-readable token; `message` is human text and is NOT a contract. The
portal member UI should switch on `reason` only, and should treat an unknown
token as a generic "not available" rather than leaking it.


## Artifact read path — the authoritative set

These are exactly the tokens `readArtifact.js` emits today. The portal union
must be this set and nothing else.

| reason | code | HTTP | Meaning |
| --- | --- | --- | --- |
| `MISSING_REPORT_ID` | `INVALID_ARGUMENT` | 400 | No `reportId` on the request. |
| `UNKNOWN_MODULE` | `INVALID_ARGUMENT` | 400 | `module` is not `labs` / `imaging` / `records`. |
| `NO_TOKEN` | `UNAUTHENTICATED` | 401 | No verifiable Firebase ID token (also the fallback for any verify failure without its own reason). |
| `NO_PATIENT_BOUND` | `PERMISSION_DENIED` | 403 | The uid resolves to no patient record and named no child. |
| `NOT_IN_ALLOWLIST` | `PERMISSION_DENIED` | 403 | Subject outside `ELATION_READ_ALLOWLIST` (pre-G9 gate). |
| `ACCESS_SUSPENDED` | `PERMISSION_DENIED` | 403 | `portalAccess.status !== 'active'` on the **subject's** record. |
| `ACCESS_CHECK_FAILED` | `UNAVAILABLE` | 503 | Access/suspension lookup errored — fails closed; retry. |
| `ARTIFACT_NOT_SYNCED` | `NOT_FOUND` | 404 | **The single absence token.** Hidden item, module off, deleted or wrong-module reference, unauthorized/revoked guardian, stranger guess, never-synced. Deliberately indistinguishable. |
| `STORAGE_ERROR` | `INTERNAL` | 500 | Storage existence check failed. |
| `SIGN_ERROR` | `INTERNAL` | 500 | Signed-URL generation failed. |

Non-error states on the same path:

| body | HTTP | Meaning |
| --- | --- | --- |
| `{ signedUrl, expiresAt, contentType }` | 200 | Serve it. TTL default 300s, hard cap 900s; on expiry the client re-requests — there is no `ARTIFACT_LINK_EXPIRED` token. |
| `{ state: 'preparing', message }` | 200 | Reference exists, object missing; a repair was enqueued. Render a calm preparing state and poll. Not an error. |

Withdrawn (drafted here, never implemented — do not build against them):
`ARTIFACT_NOT_READY` (409), `ARTIFACT_SUPPRESSED`, `ARTIFACT_LINK_EXPIRED`,
`ARTIFACT_IDENTITY_MISMATCH`, `ITEM_HIDDEN`, `MODULE_DISABLED`,
`PORTAL_NOT_CLAIMED`, `PORTAL_SUSPENDED`, `NO_PATIENT_BINDING`,
`UID_PATIENT_MISMATCH`, `ELATION_NOT_ALLOWLISTED`, and every
`GUARDIAN_*` / `NOT_A_MINOR` / `DEPENDENT_AGED_OUT` refusal token. The guardian
outcomes in particular collapse to `ARTIFACT_NOT_SYNCED` on purpose: telling a
caller "no active guardian link" confirms the child exists.

`ARTIFACT_NOT_PDF` is real but is **server-side only** — thrown inside the
backfill and `sweepArtifactRepairs`, never returned to a member. The member sees
`preparing` while the heal loop runs, and the report parks + alerts if it keeps
failing.

## Admin / operational surfaces (not member-facing)

| reason | HTTP | Meaning |
| --- | --- | --- |
| `METHOD_NOT_ALLOWED` | 405 | Non-POST on a POST-only function. |
| `MALFORMED_BODY` | 400 | Body was not JSON. |
| `NO_PATIENT_IDS` / `TOO_MANY_PATIENT_IDS` / `MALFORMED_PATIENT_ID` | 400 | `backfillElationReports` wrapper validation (`INVALID_ARGUMENT`). |
| `NO_PATIENT_DOC` / `NOT_A_MINOR` / eligibility reason | — | Per-id entries in the wrapper's `rejected[]` array. Admin-only; never member-facing. |
| `PERMISSION_DENIED` | 401/403 | `requireAdminCaller` rejected the invoker. |
| `GUARDIAN_HAS_NO_PORTAL_ACCOUNT` | — | Admin unclaimed-guardians report row. Not a read-path refusal. |

## Rules

- Never add a reason that distinguishes "exists but you may not see it" from
  "does not exist" for a member-facing item — everything absent is
  `404 ARTIFACT_NOT_SYNCED`.
- Never put PHI in `message` or `reason`.
- Adding or renaming a member-facing token is a contract change: handler and
  this doc in the same PR, portal union updated before the handler ships.

