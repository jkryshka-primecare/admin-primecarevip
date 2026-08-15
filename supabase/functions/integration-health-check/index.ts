// Daily production connection spot-check for Elation + Hint.
//
// Probes the smallest possible read on each upstream (limit=1), records the
// outcome in public.integration_health_checks, and emails admins when a
// previously reachable integration fails. No PHI is stored — only status,
// latency, and the upstream error text.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ELATION_REST_BASE = "https://app.elationemr.com/api/2.0";
const HINT_PRACTICE_BASE = "https://api.hint.com/api/provider";

type CheckResult = {
  integration: string;
  scope: string | null;
  resource: string | null;
  ok: boolean;
  http_status: number | null;
  elapsed_ms: number;
  error_message: string | null;
};

async function checkElationRest(): Promise<CheckResult> {
  const started = Date.now();
  const base = {
    integration: "Elation REST",
    scope: "rest",
    resource: "practices",
  };
  const clientId = Deno.env.get("ELATION_CLIENT_ID");
  const clientSecret = Deno.env.get("ELATION_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    return {
      ...base,
      ok: false,
      http_status: null,
      elapsed_ms: Date.now() - started,
      error_message: "ELATION_CLIENT_ID / ELATION_CLIENT_SECRET are not configured.",
    };
  }

  try {
    const tokenRes = await fetch(`${ELATION_REST_BASE}/oauth2/token/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });
    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      return {
        ...base,
        ok: false,
        http_status: tokenRes.status,
        elapsed_ms: Date.now() - started,
        error_message: `Token exchange failed: ${body.slice(0, 300)}`,
      };
    }
    const { access_token } = (await tokenRes.json()) as { access_token?: string };
    if (!access_token) {
      return {
        ...base,
        ok: false,
        http_status: tokenRes.status,
        elapsed_ms: Date.now() - started,
        error_message: "Token response missing access_token.",
      };
    }

    const res = await fetch(`${ELATION_REST_BASE}/practices/?limit=1`, {
      headers: { Authorization: `Bearer ${access_token}`, Accept: "application/json" },
    });
    const text = await res.text();
    return {
      ...base,
      ok: res.ok,
      http_status: res.status,
      elapsed_ms: Date.now() - started,
      error_message: res.ok ? null : text.slice(0, 300),
    };
  } catch (e) {
    return {
      ...base,
      ok: false,
      http_status: null,
      elapsed_ms: Date.now() - started,
      error_message: e instanceof Error ? e.message : "Request failed",
    };
  }
}

async function checkHintPractice(): Promise<CheckResult> {
  const started = Date.now();
  const base = {
    integration: "Hint practice",
    scope: "practice",
    resource: "patients",
  };
  const key = Deno.env.get("HINT_PRACTICE_API_KEY")?.trim();
  if (!key) {
    return {
      ...base,
      ok: false,
      http_status: null,
      elapsed_ms: Date.now() - started,
      error_message: "HINT_PRACTICE_API_KEY is not configured.",
    };
  }
  try {
    const res = await fetch(`${HINT_PRACTICE_BASE}/patients?limit=1`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    });
    const text = await res.text();
    return {
      ...base,
      ok: res.ok,
      http_status: res.status,
      elapsed_ms: Date.now() - started,
      error_message: res.ok ? null : text.slice(0, 300),
    };
  } catch (e) {
    return {
      ...base,
      ok: false,
      http_status: null,
      elapsed_ms: Date.now() - started,
      error_message: e instanceof Error ? e.message : "Request failed",
    };
  }
}

// Read-only Firestore reachability probe: mints a service-account token and
// runs a 1-document query. No writes.
async function checkFirestore(): Promise<CheckResult> {
  const started = Date.now();
  const base = {
    integration: "Firestore",
    scope: "read",
    resource: "patients",
  };
  const raw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");
  if (!raw) {
    return {
      ...base,
      ok: false,
      http_status: null,
      elapsed_ms: Date.now() - started,
      error_message: "FIREBASE_SERVICE_ACCOUNT is not configured.",
    };
  }
  try {
    const sa = JSON.parse(raw) as {
      client_email: string;
      private_key: string;
      project_id: string;
    };
    const now = Math.floor(Date.now() / 1000);
    const b64url = (input: Uint8Array | string) => {
      const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
      let bin = "";
      for (const b of bytes) bin += String.fromCharCode(b);
      return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    };
    const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(
      JSON.stringify({
        iss: sa.client_email,
        scope: "https://www.googleapis.com/auth/datastore",
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
      }),
    )}`;
    const pem = sa.private_key
      .replace(/\\n/g, "\n")
      .replace(/-----BEGIN PRIVATE KEY-----/, "")
      .replace(/-----END PRIVATE KEY-----/, "")
      .replace(/\s+/g, "");
    const bin = atob(pem);
    const der = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
    const key = await crypto.subtle.importKey(
      "pkcs8",
      der.buffer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = new Uint8Array(
      await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)),
    );
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${unsigned}.${b64url(sig)}`,
      }),
    });
    const tokenBody = await tokenRes.json();
    if (!tokenRes.ok || !tokenBody.access_token) {
      return {
        ...base,
        ok: false,
        http_status: tokenRes.status,
        elapsed_ms: Date.now() - started,
        error_message: `Token exchange failed: ${JSON.stringify(tokenBody).slice(0, 300)}`,
      };
    }
    const res = await fetch(
      `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents:runQuery`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenBody.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          structuredQuery: { from: [{ collectionId: "patients" }], limit: 1 },
        }),
      },
    );
    const text = await res.text();
    return {
      ...base,
      ok: res.ok,
      http_status: res.status,
      elapsed_ms: Date.now() - started,
      error_message: res.ok ? null : text.slice(0, 300),
    };
  } catch (e) {
    return {
      ...base,
      ok: false,
      http_status: null,
      elapsed_ms: Date.now() - started,
      error_message: e instanceof Error ? e.message : "Request failed",
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const results = await Promise.all([
    checkElationRest(),
    checkHintPractice(),
    checkFirestore(),
  ]);

  const checkedAt = new Date().toISOString();

  const { error: insertErr } = await supabase
    .from("integration_health_checks")
    .insert(results.map((r) => ({ ...r, checked_at: checkedAt })));
  if (insertErr) console.error("Failed to record health checks", insertErr);

  const failures = results.filter((r) => !r.ok);

  if (failures.length > 0) {
    // Notify every admin / super_admin with an email on file.
    const { data: adminRoles } = await supabase
      .from("user_roles")
      .select("user_id")
      .in("role", ["admin", "super_admin"]);
    const adminIds = [...new Set((adminRoles ?? []).map((r) => r.user_id))];

    if (adminIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("email")
        .in("user_id", adminIds)
        .not("email", "is", null);

      const day = checkedAt.slice(0, 10);
      for (const p of profiles ?? []) {
        if (!p.email) continue;
        const { error: emailErr } = await supabase.functions.invoke(
          "send-transactional-email",
          {
            body: {
              templateName: "integration-health-alert",
              recipientEmail: p.email,
              idempotencyKey: `integration-health-${day}-${p.email}`,
              templateData: {
                checkedAt,
                failures: failures.map((f) => ({
                  integration: f.integration,
                  httpStatus: f.http_status,
                  message: f.error_message,
                })),
              },
            },
          },
        );
        if (emailErr) console.error("Alert email failed", p.email, emailErr);
      }
    }
  }

  return new Response(
    JSON.stringify({ ok: failures.length === 0, checkedAt, results }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
