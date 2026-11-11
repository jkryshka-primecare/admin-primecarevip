/**
 * Activation (claim) outcome classification.
 *
 * Two rules that must not regress:
 *  1. A claim that actually succeeded is NEVER reported to the member as a
 *     failure. "Already claimed" is a SUCCESS here — a reopened or resubmitted
 *     invite link must land the member on sign-in, not on an error. The same
 *     holds when the claim succeeds but the sign-in handoff fails.
 *  2. Every branch has named copy. The generic message is a last resort and
 *     always logs the raw reason token so the gap is identifiable.
 */
import { CONCIERGE_PHONE_DISPLAY } from "@/lib/contact";
import { PASSWORD_POLICY_ERROR } from "@/lib/password-policy";
import { PortalError, memberMessage } from "./errors";

export type ClaimOutcome =
  /** Account exists and is usable — show a calm next step, never an error. */
  | { kind: "already-active"; message: string }
  | { kind: "dob-mismatch"; message: string }
  | { kind: "bad-link"; message: string }
  | { kind: "throttled"; message: string }
  | { kind: "locked"; message: string }
  | { kind: "call-office"; message: string }
  | { kind: "password"; message: string }
  | { kind: "retry"; message: string }
  | { kind: "unknown"; message: string; reason: string; status: number };

const ALREADY_ACTIVE_MESSAGE = "This account is already set up — please sign in.";

export const CLAIM_SERVER_ERROR_MESSAGE = `We couldn't finish setting up your account. Try again, or call ${CONCIERGE_PHONE_DISPLAY}.`;

/** True when the service is telling us the account already exists. */
export function isAlreadyClaimed(reason: string): boolean {
  const r = reason.toUpperCase();
  return (
    r.includes("ALREADY_CLAIMED") ||
    r.includes("ALREADY_ACTIVE") ||
    r.includes("ALREADY_REGISTERED") ||
    r === "ACCOUNT_EXISTS" ||
    r === "EMAIL_EXISTS" ||
    r === "EMAIL_ALREADY_IN_USE" ||
    r === "AUTH/EMAIL-ALREADY-IN-USE" ||
    r === "CLAIMED"
  );
}

/** "wait 90 seconds" style hint, when the service tells us how long. */
function waitHint(retryAfterSeconds?: number): string {
  if (!retryAfterSeconds || retryAfterSeconds <= 0) return "Please wait and try again.";
  const minutes = Math.ceil(retryAfterSeconds / 60);
  if (retryAfterSeconds < 60) {
    return `Please wait ${Math.ceil(retryAfterSeconds)} seconds and try again.`;
  }
  return `Please wait ${minutes} minute${minutes === 1 ? "" : "s"} and try again.`;
}

/** Reads a retry-after hint off the error, when the service supplied one. */
export function readRetryAfter(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const raw = (error as Record<string, unknown>)["retryAfter"];
  const n = typeof raw === "string" ? Number(raw) : raw;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Maps an activation failure to a named member-facing state. */
export function classifyClaimError(error: unknown, retryAfterSeconds?: number): ClaimOutcome {
  const pe = error instanceof PortalError ? error : new PortalError(500, "UNKNOWN");
  const r = pe.reason.toUpperCase();
  const retryAfter = retryAfterSeconds ?? readRetryAfter(error);

  // Success in disguise — the account exists, so this is never an error state.
  if (r === "SETUP_FINISHING" || isAlreadyClaimed(r)) {
    return { kind: "already-active", message: ALREADY_ACTIVE_MESSAGE };
  }

  if (r === "DOB_LOCKED") {
    return {
      kind: "locked",
      message: `Too many attempts. Call our office at ${CONCIERGE_PHONE_DISPLAY} to unlock.`,
    };
  }

  if (r === "DOB_THROTTLED") {
    return { kind: "throttled", message: `Too many attempts. ${waitHint(retryAfter)}` };
  }

  if (r === "DOB_UNAVAILABLE") {
    return {
      kind: "call-office",
      message: `We can't verify your identity right now. Please call our office at ${CONCIERGE_PHONE_DISPLAY}.`,
    };
  }

  if (r === "ADOPT_PASSWORD_RESET_FAILED") {
    return {
      kind: "call-office",
      message: `Your account is linked but the password couldn't be set. Please call our office at ${CONCIERGE_PHONE_DISPLAY}.`,
    };
  }

  if (r === "PASSWORD_TOO_LONG") {
    return { kind: "password", message: "Password must be 64 characters or fewer." };
  }

  if (r === "WEAK_PASSWORD" || r === "PASSWORD_TOO_SHORT") {
    return {
      kind: "password",
      message: PASSWORD_POLICY_ERROR,
    };
  }

  if (r === "THROTTLE_UNAVAILABLE") {
    return {
      kind: "retry",
      message: "Verification is temporarily unavailable. Try again shortly.",
    };
  }

  if (
    r.includes("DOB") ||
    r.includes("DATE_OF_BIRTH") ||
    r.includes("BIRTHDATE") ||
    r === "IDENTITY_MISMATCH" ||
    r === "VERIFICATION_FAILED"
  ) {
    return {
      kind: "dob-mismatch",
      message: "That date of birth doesn't match our records. Please check and try again.",
    };
  }

  if (
    r.includes("TOKEN") ||
    r.includes("EXPIRED") ||
    r.includes("INVALID_LINK") ||
    r.includes("INVITE") ||
    r === "NOT_FOUND" ||
    (pe.status === 404 && r === "UNKNOWN")
  ) {
    return {
      kind: "bad-link",
      message: `This activation link is no longer valid. Call our office at ${CONCIERGE_PHONE_DISPLAY} for a new one.`,
    };
  }

  // Offline / blocked keep the shared connection copy.
  if (pe.outcome === "offline" || pe.outcome === "connection-blocked") {
    return { kind: "retry", message: memberMessage(pe) };
  }

  // Known server-side failures, plus any 5xx: transient from the member's view.
  if (
    r === "READ_ERROR" ||
    r === "LOG_WRITE_ERROR" ||
    r === "ACCOUNT_CREATE_ERROR" ||
    pe.outcome === "retry" ||
    pe.status >= 500
  ) {
    return { kind: "retry", message: CLAIM_SERVER_ERROR_MESSAGE };
  }

  return {
    kind: "unknown",
    message: CLAIM_SERVER_ERROR_MESSAGE,
    reason: pe.reason,
    status: pe.status,
  };
}

/**
 * The claim service may echo the member's login email. Read it defensively —
 * it is only used to prefill the sign-in field, never for identity decisions.
 */
export function readClaimEmail(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const b = body as Record<string, unknown>;
  const candidates = [b["email"], (b["user"] as Record<string, unknown> | undefined)?.["email"]];
  for (const value of candidates) {
    if (typeof value === "string" && value.includes("@")) return value.trim();
  }
  return undefined;
}

/**
 * Part B: the success body carries a Firebase custom token for the sign-in
 * handoff. The contract name is `loginToken`
 * (firebase-handoff/portal-claim/CLAIM-RESPONSE-CONTRACT.md); the other keys
 * are tolerated aliases only. Absent → the two-step /login path is the
 * fallback, which is silent by design, so the contract name must be first.
 */
export function readCustomToken(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const b = body as Record<string, unknown>;
  const auth = b["auth"] as Record<string, unknown> | undefined;
  const candidates = [
    b["loginToken"],
    b["login_token"],
    auth?.["loginToken"],
    b["customToken"],
    b["custom_token"],
    auth?.["customToken"],
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim().length > 20) return value.trim();
  }
  return undefined;
}
