// One-off provisioning endpoint for the WIF bridge account.
// Creates (or repairs) a role-less, non-human Supabase auth account whose only
// purpose is to produce a verifiable ES256 OIDC token with a stable `sub`.
// Requires the caller to present the project's service-role key.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BRIDGE_EMAIL = Deno.env.get("PORTAL_BRIDGE_EMAIL");
const BRIDGE_PASSWORD = Deno.env.get("PORTAL_BRIDGE_PASSWORD");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  const isServiceRole =
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "") === SERVICE_ROLE;
  if (!BRIDGE_EMAIL || !BRIDGE_PASSWORD) {
    return json(412, { error: "PORTAL_BRIDGE_EMAIL / PORTAL_BRIDGE_PASSWORD not configured" });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Find an existing bridge account first so this is idempotent.
  let userId: string | null = null;
  for (let page = 1; page <= 20 && !userId; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return json(500, { error: error.message });
    if (!data.users.length) break;
    userId = data.users.find((u) => u.email?.toLowerCase() === BRIDGE_EMAIL.toLowerCase())?.id ?? null;
  }

  // First-run provisioning is open; once the bridge account exists only the
  // service role may touch it (this function is deleted after provisioning).
  if (userId && !isServiceRole) return json(401, { error: "unauthorized" });

  if (userId) {
    const { error } = await admin.auth.admin.updateUserById(userId, {
      password: BRIDGE_PASSWORD,
      email_confirm: true,
    });
    if (error) return json(500, { error: error.message });
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: BRIDGE_EMAIL,
      password: BRIDGE_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: "Portal WIF bridge (machine account)", machine_account: true },
    });
    if (error) return json(500, { error: error.message });
    userId = data.user.id;
  }

  // Strip every role row — the bridge account must be denied by every RLS policy.
  const { error: roleErr } = await admin.from("user_roles").delete().eq("user_id", userId);
  if (roleErr) return json(500, { error: roleErr.message });

  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", userId);

  // Verify the credential actually mints a token, and read back the sub.
  const anon = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({
    email: BRIDGE_EMAIL,
    password: BRIDGE_PASSWORD,
  });
  if (signInErr) return json(500, { error: `sign-in check failed: ${signInErr.message}` });
  const claims = JSON.parse(atob(signIn.session!.access_token.split(".")[1]));

  return json(200, {
    bridge_email: BRIDGE_EMAIL,
    bridge_sub: userId,
    token_sub: claims.sub,
    token_iss: claims.iss,
    token_aud: claims.aud,
    token_alg: JSON.parse(atob(signIn.session!.access_token.split(".")[0])).alg,
    roles: roles ?? [],
  });
});
