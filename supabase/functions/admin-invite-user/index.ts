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
  let body: InviteBody & { resend_invitation_id?: string };
  try {
    body = await req.json();
  } catch {
    return deny(400, "Invalid JSON body");
  }

  const origin = (req.headers.get("origin")
    ?? Deno.env.get("PUBLIC_APP_URL")
    ?? "https://admin.primecarevip.com").replace(/\/+$/, "");

  const { data: callerProfile } = await admin.from("profiles")
    .select("display_name").eq("user_id", callerId).maybeSingle();
  const invitedBy = callerProfile?.display_name && !callerProfile.display_name.includes("@")
    ? callerProfile.display_name : undefined;

  async function sendInviteEmail(inv: { token: string; email: string; first_name: string; role: string }) {
    try {
      const { error } = await admin.functions.invoke("send-transactional-email", {
        body: {
          templateName: "team-invite",
          recipientEmail: inv.email,
          idempotencyKey: `team-invite-${inv.token}-${Date.now()}`,
          templateData: {
            firstName: inv.first_name,
            inviteUrl: `${origin}/auth?invite=${inv.token}`,
            roleLabel: inv.role.replace("_", " "),
            invitedBy,
          },
        },
      });
      return !error;
    } catch {
      return false;
    }
  }

  // Resend an existing pending invitation's email.
  if (body.resend_invitation_id) {
    const { data: inv } = await admin.from("invitations")
      .select("token, email, first_name, role, status")
      .eq("id", body.resend_invitation_id).maybeSingle();
    if (!inv) return deny(404, "Invitation not found.");
    if (inv.status !== "pending") return deny(409, "This invitation is no longer pending.");
    const emailSent = await sendInviteEmail(inv);
    return json({ ok: true, email: inv.email, email_sent: emailSent, invite_url: `${origin}/auth?invite=${inv.token}` });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const role = body.role;
  const firstName = (body.first_name ?? "").trim();
  const lastName = (body.last_name ?? "").trim();

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(email) || email.length > 255) return deny(400, "Please enter a valid email address.");
  if (!ROLES.has(role)) return deny(400, "Invalid role.");
  if (!firstName || !lastName || firstName.length > 100 || lastName.length > 100) {
    return deny(400, "First and last name are required.");
  }

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

  const inviteUrl = `${origin}/auth?invite=${inv.token}`;

  // 5. Email the link (best-effort — the link is always returned as a backup).
  const emailSent = await sendInviteEmail({ token: inv.token, email, first_name: firstName, role });

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

  return json({ ok: true, email, role, invite_url: inviteUrl, email_sent: emailSent });
});
