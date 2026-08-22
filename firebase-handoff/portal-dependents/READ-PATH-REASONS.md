# Read-path `reason` enumeration (portal ↔ admin OS contract)

Every enforcing read handler answers a refusal with
`{ error: { code, status, message, details: { reason } } }`. `reason` is the
machine-readable token; `message` is human text and is NOT a contract. The
portal member UI should switch on `reason` only, and should treat an unknown
token as a generic "not available" rather than leaking it.

## Identity / session

| reason | HTTP | Meaning |
| --- | --- | --- |
| `UNAUTHENTICATED` | 401 | No verifiable Firebase ID token on the request. |
| `TOKEN_EXPIRED` | 401 | Token parsed but past `exp`; client should refresh and retry once. |
| `NO_PATIENT_BINDING` | 403 | The uid is not bound to any patient record. |
| `UID_PATIENT_MISMATCH` | 403 | The requested patient is not this uid's own record and no proxy grant applies. |

## Portal access state

| reason | HTTP | Meaning |
| --- | --- | --- |
| `PORTAL_NOT_CLAIMED` | 403 | Roster record exists but the invite was never claimed. |
| `PORTAL_SUSPENDED` | 403 | `portalAccess.status !== 'active'`. |
| `MODULE_DISABLED` | 403 | The module flag (`labs`, `imaging`, …) is off for this member. |
| `ITEM_HIDDEN` | 404 | The specific document id is in `hiddenItems`; deliberately indistinguishable from "not found". |

## Guardian proxy (Release 2b)

| reason | HTTP | Meaning |
| --- | --- | --- |
| `GUARDIAN_READS_DISABLED` | 403 | `GUARDIAN_READS_ENABLED` is off — the whole proxy path is inert. |
| `NOT_A_MINOR` | 403 | Target record is not `dependent.isMinor === true`; proxy never applies to an adult. |
| `NO_ACTIVE_GUARDIAN_LINK` | 403 | No guardian link in `active` state for this (guardian, child) pair. |
| `GUARDIAN_LINK_REVOKED` | 403 | A link exists but was revoked. |
| `GUARDIAN_NOT_CHART_BACKED` | 403 | Link is email-on-file only, and the handler requires chart-backed authorization. |
| `GUARDIAN_CONSENT_REQUIRED` | 403 | Consent record missing or withdrawn. |
| `DEPENDENT_AGED_OUT` | 403 | `convertsAt` has passed — the child is an adult; proxy is refused even before the sweep runs. |
| `GUARDIAN_HAS_NO_PORTAL_ACCOUNT` | 403 | Guardian has no claimed portal account to read as (also the blocker surfaced in the admin unclaimed-guardians report). |

## Artifact read path

| reason | HTTP | Meaning |
| --- | --- | --- |
| `ARTIFACT_NOT_READY` | 409 | Referenced but not yet in Storage; the member UI polls. |
| `ARTIFACT_NOT_PDF` | 500 | Download-back self-check failed; the object was deleted and the repair loop owns it. |
| `ARTIFACT_IDENTITY_MISMATCH` | 403 | Object path's uid does not match the resolved reader identity. |
| `ARTIFACT_SUPPRESSED` | 404 | Suppression list hit; same shape as not-found on purpose. |
| `ARTIFACT_LINK_EXPIRED` | 410 | Signed link past its TTL; request a new one. |

## Upstream / operational

| reason | HTTP | Meaning |
| --- | --- | --- |
| `ELATION_NOT_ALLOWLISTED` | 403 | Patient outside `ELATION_READ_ALLOWLIST`. |
| `UPSTREAM_UNAVAILABLE` | 503 | Elation or Storage transient; retry with backoff. |
| `RATE_LIMITED` | 429 | Per-uid throttle. |
| `METHOD_NOT_ALLOWED` | 405 | Non-POST on a POST-only function. |
| `MALFORMED_BODY` | 400 | Body was not JSON. |
| `INVALID_ARGUMENT` (status) with `NO_PATIENT_IDS` / `TOO_MANY_PATIENT_IDS` / `MALFORMED_PATIENT_ID` | 400 | Admin-side ingest wrapper validation. |
| `PERMISSION_DENIED` (status) | 401/403 | `requireAdminCaller` rejected the invoker — admin functions only. |

## Rules

- Never add a reason that distinguishes "exists but you may not see it" from
  "does not exist" for a member-facing item — use `ITEM_HIDDEN`/`ARTIFACT_SUPPRESSED`
  with a 404 shape.
- Never put PHI in `message` or `reason`.
- Adding a token is a contract change: land it here first, then in the handler.
