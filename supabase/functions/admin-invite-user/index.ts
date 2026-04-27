// Admin-only edge function to invite a new user by email.
// - Verifies the caller's JWT and confirms they hold the 'admin' role.
// - Verifies the email's domain is in allowed_signup_domains.
// - Sends a Supabase invite (magic link) via the service role.
// - Assigns the requested role (pending/staff/clinician/admin) on success
//   so the user lands with the right access immediately.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import { corsHeaders, deny } from "../_shared/auth.ts";

type InviteBody = {
  email: string;
  role: "pending" | "staff" | "clinician" | "admin";
  display_name?: string;
};

const ROLES = new Set(["pending", "staff", "clinician", "admin"]);

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
  const displayName = body.display_name?.trim() || null;

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(email)) return deny(400, "Please enter a valid email address.");
  if (!ROLES.has(role)) return deny(400, "Invalid role.");

  // 3. Domain allow-list check (matches the auth.users trigger)
  const domain = email.split("@")[1];
  const { data: domainRow, error: domainErr } = await admin
    .from("allowed_signup_domains")
    .select("domain")
    .eq("domain", domain)
    .maybeSingle();
  if (domainErr) return deny(500, `Domain check failed: ${domainErr.message}`);
  if (!domainRow) {
    return deny(
      400,
      `"${domain}" is not on the approved signup domains list. Add it under Administration → Signup Domains first.`,
    );
  }

  // 4. Send the invite. If the user already exists, surface a friendly message.
  const redirectTo = req.headers.get("origin")
    ? `${req.headers.get("origin")}/auth`
    : undefined;

  const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(
    email,
    {
      data: displayName ? { full_name: displayName } : undefined,
      redirectTo,
    },
  );

  if (inviteErr) {
    const msg = inviteErr.message ?? "Could not send invite.";
    const status = /already|exist/i.test(msg) ? 409 : 500;
    return json({ error: msg }, status);
  }

  const newUserId = invited?.user?.id;
  if (!newUserId) return deny(500, "Invite sent but no user id was returned.");

  // 5. Replace any default role with the requested one.
  await admin.from("user_roles").delete().eq("user_id", newUserId);
  const { error: insErr } = await admin.from("user_roles").insert({
    user_id: newUserId,
    role,
    granted_by: callerId,
  });
  if (insErr) {
    return json(
      {
        error: `Invite sent, but role assignment failed: ${insErr.message}. You can fix the role manually on the Users page.`,
      },
      500,
    );
  }

  // 6. Audit
  await admin.from("phi_access_log").insert({
    user_id: callerId,
    user_email: callerEmail,
    source: "admin-invite-user",
    resource: "auth.users",
    resource_id: newUserId,
    scope: `invite:${role}`,
    http_status: 200,
    row_count: 1,
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    user_agent: req.headers.get("user-agent") ?? null,
  });

  return json({ ok: true, user_id: newUserId, email, role });
});
