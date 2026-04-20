// Shared auth + audit helpers for PHI-touching edge functions.
//
// Every PHI-bearing edge function must:
//   1. Verify the caller's JWT via `requireStaff(req)`
//   2. Get back `{ user, supabase }` and use it for any DB writes
//   3. Call `logPhiAccess(...)` after the upstream fetch with the row count + status
//
// `requireStaff` rejects with a Response if the user is not signed in or
// does not hold one of the staff-level roles (admin, clinician, staff).
// "pending" users get a 403 — they exist but are not yet authorized.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export { corsHeaders };

export type AuthContext = {
  user: { id: string; email?: string };
  supabase: SupabaseClient;
};

/** Reject a request with a JSON error + CORS headers. */
export function deny(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Verify JWT + staff role. Returns the auth context on success
 * or a Response (which the caller must return) on failure.
 */
export async function requireStaff(req: Request): Promise<AuthContext | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return deny(401, "Missing bearer token");
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const token = authHeader.replace("Bearer ", "");
  const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims(token);
  if (claimsErr || !claimsData?.claims?.sub) {
    return deny(401, "Invalid or expired session");
  }

  const userId = claimsData.claims.sub as string;
  const email = claimsData.claims.email as string | undefined;

  // Use a service-role client for the role check (bypasses RLS, read-only).
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: isStaff, error: roleErr } = await admin.rpc("is_staff", {
    _user_id: userId,
  });
  if (roleErr) {
    return deny(500, `Role check failed: ${roleErr.message}`);
  }
  if (!isStaff) {
    return deny(
      403,
      "Your account is not authorized to view PHI yet. An administrator must approve your access.",
    );
  }

  return { user: { id: userId, email }, supabase: admin };
}

/**
 * Append a row to the PHI audit log. Best-effort — never throws.
 * Uses the service-role client passed in `ctx.supabase`.
 */
export async function logPhiAccess(
  ctx: AuthContext,
  req: Request,
  entry: {
    source: string;
    resource?: string;
    scope?: string;
    resource_id?: string;
    http_status: number;
    row_count?: number | null;
  },
): Promise<void> {
  try {
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("cf-connecting-ip") ??
      null;
    await ctx.supabase.from("phi_access_log").insert({
      user_id: ctx.user.id,
      user_email: ctx.user.email ?? null,
      source: entry.source,
      resource: entry.resource ?? null,
      scope: entry.scope ?? null,
      resource_id: entry.resource_id ?? null,
      http_status: entry.http_status,
      row_count: entry.row_count ?? null,
      ip,
      user_agent: req.headers.get("user-agent") ?? null,
    });
  } catch {
    // swallow — logging must never break the user request
  }
}
