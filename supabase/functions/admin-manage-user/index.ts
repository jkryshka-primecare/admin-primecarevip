// Admin-only: remove access (disable), restore access (enable), or permanently
// delete a staff login. All checks are server-side.
//   disable/enable → admin or super_admin
//   delete         → super_admin only
// Refuses: acting on yourself, the last super_admin, the portal bridge account.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import { corsHeaders, deny } from "../_shared/auth.ts";

const BRIDGE_USER_ID = "c85a8977-1fa6-40c5-a819-decdf43e7177";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return deny(405, "Method not allowed");

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return deny(401, "Missing bearer token");

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  let callerId: string;
  let callerEmail: string | null = null;
  try {
    const { data, error } = await userClient.auth.getClaims(authHeader.slice(7));
    if (error || !data?.claims?.sub) return deny(401, "Invalid or expired session");
    callerId = data.claims.sub as string;
    callerEmail = (data.claims.email as string | undefined) ?? null;
  } catch {
    return deny(401, "Invalid or expired session");
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: { action?: string; user_id?: string; reason?: string };
  try { body = await req.json(); } catch { return deny(400, "Invalid JSON body"); }

  const action = body.action;
  const targetId = String(body.user_id ?? "");
  const reason = String(body.reason ?? "").trim().slice(0, 500);

  if (!["disable", "enable", "delete"].includes(action ?? "")) return deny(400, "Unknown action.");
  if (!UUID_RE.test(targetId)) return deny(400, "A valid user is required.");
  if (action !== "enable" && reason.length < 3) return deny(400, "A reason is required.");

  const { data: callerRoles } = await admin.from("user_roles").select("role").eq("user_id", callerId);
  const roles = (callerRoles ?? []).map((r) => r.role as string);
  const isSuper = roles.includes("super_admin");
  const isAdmin = isSuper || roles.includes("admin");
  if (!isAdmin) return deny(403, "Only administrators can manage users.");
  if (action === "delete" && !isSuper) return deny(403, "Only super admins can delete users.");

  if (targetId === callerId) return deny(400, "You can't do this to your own account.");
  if (targetId === BRIDGE_USER_ID) return deny(400, "The portal system account can't be changed here.");

  const { data: target, error: tErr } = await admin.auth.admin.getUserById(targetId);
  if (tErr || !target?.user) return deny(404, "User not found.");
  const targetEmail = target.user.email ?? null;

  const { data: targetRoles } = await admin.from("user_roles").select("role").eq("user_id", targetId);
  const targetIsSuper = (targetRoles ?? []).some((r) => r.role === "super_admin");

  // A non-super admin may not act on a super admin.
  if (targetIsSuper && !isSuper) return deny(403, "Only super admins can change another super admin.");

  if (targetIsSuper && action !== "enable") {
    const { count } = await admin.from("user_roles")
      .select("user_id", { count: "exact", head: true }).eq("role", "super_admin");
    if ((count ?? 0) <= 1) return deny(400, "This is the last super admin and can't be removed.");
  }

  const previousRoles = (targetRoles ?? []).map((r) => r.role as string);

  if (action === "disable") {
    const { error: banErr } = await admin.auth.admin.updateUserById(targetId, { ban_duration: "876000h" });
    if (banErr) return json({ error: `Could not block sign-in: ${banErr.message}` }, 500);
    // Banning blocks new sessions and refreshes; sign out existing ones too.
    try { await admin.auth.admin.signOut(targetId, "global"); } catch { /* best effort */ }
    await admin.from("user_roles").delete().eq("user_id", targetId);
    await admin.from("profiles").update({
      access_removed_at: new Date().toISOString(),
      access_removed_reason: reason,
    }).eq("user_id", targetId);
  } else if (action === "enable") {
    const { error: unbanErr } = await admin.auth.admin.updateUserById(targetId, { ban_duration: "none" });
    if (unbanErr) return json({ error: `Could not restore sign-in: ${unbanErr.message}` }, 500);
    await admin.from("user_roles").upsert({ user_id: targetId, role: "pending" }, { onConflict: "user_id,role" });
    await admin.from("profiles").update({ access_removed_at: null, access_removed_reason: null })
      .eq("user_id", targetId);
  }

  // Audit before delete so the row exists even if the delete fails afterwards.
  await admin.from("audit_log").insert({
    user_id: callerId,
    action: `user_${action}`,
    table_name: "auth.users",
    record_id: targetId,
    old_data: { email: targetEmail, roles: previousRoles },
    new_data: { reason: reason || null, actor_email: callerEmail },
    ip_address: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  });

  if (action === "delete") {
    const { error: delErr } = await admin.auth.admin.deleteUser(targetId);
    if (delErr) return json({ error: `Could not delete user: ${delErr.message}` }, 500);
  }

  return json({ ok: true, action, user_id: targetId, email: targetEmail });
});
