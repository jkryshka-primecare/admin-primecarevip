// Admin-only edge function to invite a new user.
// - Verifies the caller is an HR admin (admin or super_admin).
// - Creates a row in public.invitations with a long-lived token.
// - Returns an invite_url pointing to /auth?invite=<token> that the admin
//   can share. The link does not expire (until used or revoked), avoiding
//   the OTP-expired errors that come from Supabase's built-in inviteUserByEmail.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import { corsHeaders, deny } from "../_shared/auth.ts";

type InviteBody = {
  email: string;
  role: string;
  first_name?: string;
  last_name?: string;
  display_name?: string;
};

const ROLES = new Set([
  "pending", "staff", "hr", "billing", "pharmacy", "clinical", "admin", "super_admin",
]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return deny(405, "Method not allowed");
  }

  // 1. Auth: verify JWT + admin role
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return deny(401, "Missing bearer token");

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const token = authHeader.replace("Bearer ", "");
  const { data: claims, error: claimsErr } = await userClient.auth.getClaims(token);
  if (claimsErr || !claims?.claims?.sub) return deny(401, "Invalid or expired session");

  const callerId = claims.claims.sub as string;
  const callerEmail = (claims.claims.email as string | undefined) ?? null;

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: isAdmin, error: roleErr } = await admin.rpc("is_hr_admin", {
    _user_id: callerId,
  });
  if (roleErr) return deny(500, `Role check failed: ${roleErr.message}`);
  if (!isAdmin) return deny(403, "Only admins can invite users.");

  // 2. Parse + validate body
  let body: InviteBody;
  try {
    body = await req.json();
  } catch {
    return deny(400, "Invalid JSON body");
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const role = body.role;
  const firstName = (body.first_name ?? "").trim();
  const lastName = (body.last_name ?? "").trim();

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(email)) return deny(400, "Please enter a valid email address.");
  if (!ROLES.has(role)) return deny(400, "Invalid role.");
  if (!firstName || !lastName) return deny(400, "First and last name are required.");

  // 3. Revoke any prior pending invitations for this email so only the
  //    newest link is valid.
  await admin.from("invitations")
    .update({ status: "revoked" })
    .eq("email", email)
    .eq("status", "pending");

  // 4. Create the invitation row. The token defaults to gen_random_uuid().
  const { data: inv, error: invErr } = await admin
    .from("invitations")
    .insert({
      email,
      first_name: firstName,
      last_name: lastName,
      role,
      created_by: callerId,
      status: "pending",
    })
    .select("token")
    .single();

  if (invErr || !inv?.token) {
    return json({ error: invErr?.message ?? "Could not create invitation." }, 500);
  }

  // 5. Build the share link. Prefer the request origin; fall back to env.
  const origin = req.headers.get("origin")
    ?? Deno.env.get("PUBLIC_APP_URL")
    ?? "https://admin.primecarevip.com";
  const inviteUrl = `${origin.replace(/\/+$/, "")}/auth?invite=${inv.token}`;

  // 6. Audit
  await admin.from("phi_access_log").insert({
    user_id: callerId,
    user_email: callerEmail,
    source: "admin-invite-user",
    resource: "public.invitations",
    resource_id: inv.token,
    scope: `invite:${role}`,
    http_status: 200,
    row_count: 1,
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    user_agent: req.headers.get("user-agent") ?? null,
  });

  return json({ ok: true, email, role, invite_url: inviteUrl });
});
