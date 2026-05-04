import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_ROLES = ["admin", "pharmacist", "pharmacy_tech"] as const;
const DEFAULT_HINT_API_URL = "https://api.hint.com/api";

type HintPatient = Record<string, unknown>;

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function extractPatientList(payload: unknown): HintPatient[] {
  if (Array.isArray(payload)) return payload as HintPatient[];
  if (payload && typeof payload === "object") {
    const maybeResults = (payload as Record<string, unknown>).results;
    if (Array.isArray(maybeResults)) return maybeResults as HintPatient[];
    const maybeData = (payload as Record<string, unknown>).data;
    if (Array.isArray(maybeData)) return maybeData as HintPatient[];
  }
  return [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Missing authorization" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claims?.claims?.sub) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    const userId = claims.claims.sub as string;

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: roleRows, error: roleErr } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (roleErr) return jsonResponse({ error: "Role lookup failed" }, 500);

    const roles = (roleRows ?? []).map((row) => row.role as string);
    if (!roles.some((role) => (ALLOWED_ROLES as readonly string[]).includes(role))) {
      return jsonResponse({ error: "Forbidden: insufficient role" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const { first_name, last_name, email, query } = body ?? {};

    const hintApiUrl = Deno.env.get("HINT_API_URL") || DEFAULT_HINT_API_URL;
    const hintApiToken = Deno.env.get("HINT_API_TOKEN");
    if (!hintApiToken) {
      return jsonResponse({ error: "Hint API token not configured" }, 500);
    }

    const params = new URLSearchParams();
    if (first_name) params.set("first_name", String(first_name).trim());
    if (last_name) params.set("last_name", String(last_name).trim());
    if (email) params.set("email", String(email).trim());
    if (query) params.set("q", String(query).trim());

    const targetUrl = `${hintApiUrl}/provider/patients?${params.toString()}`;
    console.log("[hint-search-patients] GET", targetUrl);

    const res = await fetch(targetUrl, {
      headers: {
        Authorization: `Bearer ${hintApiToken}`,
        Accept: "application/json",
      },
    });

    console.log(
      "[hint-search-patients] status",
      res.status,
      "content-type",
      res.headers.get("content-type"),
    );

    if (!res.ok) {
      const errText = await res.text();
      console.log("[hint-search-patients] error body", errText.substring(0, 300));
      return jsonResponse(
        { error: `Hint patient search failed (${res.status})`, details: errText.substring(0, 500) },
        502,
      );
    }

    const text = await res.text();
    console.log("[hint-search-patients] body preview", text.substring(0, 200));
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return jsonResponse({ error: "Hint returned non-JSON", details: text.substring(0, 500) }, 502);
    }

    const list = extractPatientList(payload);
    const patients = list.map((p) => ({
      id: p.id ?? null,
      head_member_id: p.head_member_id ?? null,
      first_name: p.first_name ?? null,
      last_name: p.last_name ?? null,
      date_of_birth: p.date_of_birth ?? null,
      email: p.email ?? null,
      phone: p.phone ?? p.mobile_phone ?? null,
      membership_status: p.membership_status ?? null,
    }));

    return jsonResponse({ success: true, patients }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: message }, 500);
  }
});
