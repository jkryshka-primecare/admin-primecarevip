import { getFirebaseAuth, functionsBaseUrl, isFirebaseConfigured } from "@/lib/firebase";
import { assertSubjectEcho } from "./echo";
import {
  PortalError,
  REFRESHABLE_REASONS,
  parseErrorEnvelope,
  readReason,
} from "./errors";

const TIMEOUT_MS = 15_000;
// Compatibility floor while the durable claim worker is rolled out.
const CLAIM_TIMEOUT_MS = 210_000;

export type CallOptions = {
  /** Skip auth (nothing today needs it; claimAccount still carries a token when signed in). */
  anonymous?: boolean;
  signal?: AbortSignal;
};

async function idToken(forceRefresh: boolean): Promise<string | null> {
  const auth = getFirebaseAuth();
  const user = auth?.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken(forceRefresh);
  } catch {
    return null;
  }
}

export async function signOutNow(): Promise<void> {
  const auth = getFirebaseAuth();
  if (!auth) return;
  const { signOut } = await import("firebase/auth");
  await signOut(auth).catch(() => {});
}

type RawResult = { status: number; body: unknown; transportFailure: boolean };

async function post(
  name: string,
  body: Record<string, unknown>,
  token: string | null,
  signal?: AbortSignal,
): Promise<RawResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), name === "claimAccount" ? CLAIM_TIMEOUT_MS : TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);

  try {
    const res = await fetch(`${functionsBaseUrl}/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    });

    let parsed: unknown = null;
    const text = await res.text();
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    return { status: res.status, body: parsed, transportFailure: false };
  } catch {
    // Network failure, CORS rejection, or abort — indistinguishable in the browser.
    return { status: 0, body: null, transportFailure: true };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * The single authed entry point to the Cloud Functions backend.
 *
 * Returns the raw 200 body. Callers apply their own shape checks, but only
 * AFTER the known non-record 200 shapes are handled (see readList/readArtifact).
 */
export async function callFunction(
  name: string,
  body: Record<string, unknown> = {},
  options: CallOptions = {},
): Promise<unknown> {
  // Preview sandbox (no backend env, or a Lovable preview host the production
  // CORS allowlist rejects): serve the demo chart instead of a dead end.
  // Dev-only — see src/lib/api/demo.ts.
  const { isDemoMode, demoResponse } = await import("./demo");
  if (isDemoMode) return demoResponse(name, body);
  if (!isFirebaseConfigured) {
    throw new PortalError(0, "BLOCKED_ORIGIN", "Portal backend is not configured.");
  }

  let token = options.anonymous ? null : await idToken(false);
  if (!options.anonymous && !token) {
    throw new PortalError(401, "NO_TOKEN");
  }

  let result = await post(name, body, token, options.signal);

  // One silent force-refresh retry on 401 or an explicit TOKEN_EXPIRED, then sign out.
  const needsRefresh = (r: RawResult) =>
    !options.anonymous &&
    !r.transportFailure &&
    (r.status === 401 || REFRESHABLE_REASONS.has(readReason(r.body) ?? ""));

  if (needsRefresh(result)) {
    token = await idToken(true);
    if (token) {
      result = await post(name, body, token, options.signal);
    }
    if (needsRefresh(result)) {
      await signOutNow();
      throw new PortalError(401, "NO_TOKEN");
    }
  }

  if (result.transportFailure) {
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    throw new PortalError(0, offline ? "OFFLINE" : "BLOCKED_ORIGIN");
  }

  if (result.status < 200 || result.status >= 300) {
    throw parseErrorEnvelope(result.status, result.body);
  }

  return result.body;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export type ListResult<T> = {
  items: T[];
  /**
   * True when the backend reports the module is off.
   * MUST render byte-identically to an empty list — never surfaced to the member.
   */
  moduleUnavailable: boolean;
};

/**
 * Branch order is load-bearing:
 *  1. known non-record 200 shapes (moduleUnavailable)
 *  2. expected record shape
 *  3. only then fail closed
 */
export function parseListResponse<T>(key: string, body: unknown): ListResult<T> {
  if (isRecord(body) && body["moduleUnavailable"] === true) {
    return { items: [], moduleUnavailable: true };
  }
  if (isRecord(body) && Array.isArray(body[key])) {
    return { items: body[key] as T[], moduleUnavailable: false };
  }
  throw new PortalError(200, "UNEXPECTED_SHAPE");
}

export async function readList<T>(
  name: string,
  key: string,
  body: Record<string, unknown> = {},
  options: CallOptions = {},
): Promise<ListResult<T>> {
  return parseListResponse<T>(key, await callFunction(name, body, options));
}

export type ArtifactResult =
  | { state: "preparing" }
  | {
      state: "ready";
      url: string;
      /** Absolute expiry from the server (`expiresAt`), when provided. */
      expiresAt: string | null;
      /** Seconds until expiry, derived from `expiresAt`; falls back to the 300s TTL. */
      expiresInSeconds: number;
      contentType: string | null;
    };

const DEFAULT_TTL_SECONDS = 300;

/** Signed URLs live ~300s and must never be cached. */
export function parseArtifactResponse(
  body: unknown,
  now: number = Date.now(),
): ArtifactResult {
  if (isRecord(body) && body["state"] === "preparing") {
    return { state: "preparing" };
  }
  if (isRecord(body)) {
    const url = body["url"] ?? body["signedUrl"] ?? body["downloadUrl"];
    if (typeof url === "string" && url.length > 0) {
      // The backend sends `expiresAt` (ISO string). Derive the TTL from it so
      // any future in-viewer refresh timer honours the server's real expiry.
      const rawExpiresAt = body["expiresAt"];
      const expiresAt = typeof rawExpiresAt === "string" ? rawExpiresAt : null;
      const parsed = expiresAt ? Date.parse(expiresAt) : Number.NaN;
      const legacyTtl = body["expiresInSeconds"];
      const expiresInSeconds = Number.isFinite(parsed)
        ? Math.max(0, Math.round((parsed - now) / 1000))
        : typeof legacyTtl === "number"
          ? legacyTtl
          : DEFAULT_TTL_SECONDS;
      const contentType = body["contentType"];
      return {
        state: "ready",
        url,
        expiresAt,
        expiresInSeconds,
        contentType: typeof contentType === "string" ? contentType : null,
      };
    }
  }
  throw new PortalError(200, "UNEXPECTED_SHAPE");
}

export async function readArtifact(
  name: "getLabs" | "getImaging" | "getMedicalRecords",
  reportId: string,
  extra: Record<string, unknown> = {},
  options: CallOptions = {},
): Promise<ArtifactResult> {
  try {
    const body = await callFunction(name, { reportId, ...extra }, options);
    // FAIL-CLOSED: a signed URL for the wrong subject is never handed back.
    assertSubjectEcho(body, extra);
    return parseArtifactResponse(body);
  } catch (error) {
    // A 409 ARTIFACT_NOT_READY is the wire twin of the 200 { state: 'preparing' }
    // body — same meaning, so poll rather than treat it as a hard error.
    if (error instanceof PortalError && error.outcome === "preparing") {
      return { state: "preparing" };
    }
    throw error;
  }
}
