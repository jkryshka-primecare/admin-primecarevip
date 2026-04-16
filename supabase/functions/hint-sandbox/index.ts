// Hint Health sandbox proxy.
// Proxies requests to https://provider.staging.hint.com/api/provider/v1/
// using the Practice API key (or Partner API key for partner-scoped routes)
// stored as Supabase secrets.
//
// Usage from the client:
//   supabase.functions.invoke("hint-sandbox", {
//     body: { resource: "patients", query: { page: 1, per_page: 25 } }
//   })
//
// Supported resources (Hint v1):
//   patients, memberships, invoices, members, plans, practice
//
// Auth scope:
//   - "practice" (default) → uses HINT_PRACTICE_API_KEY
//   - "partner"            → uses HINT_PARTNER_API_KEY

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const HINT_HOST = "https://api.staging.hint.com";
const HINT_PRACTICE_BASE = `${HINT_HOST}/api/provider`;
const HINT_PARTNER_BASE = `${HINT_HOST}/api/partner`;

type RequestBody = {
  resource?: string;
  id?: string;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  scope?: "practice" | "partner";
  query?: Record<string, string | number | boolean>;
  payload?: unknown;
};

const ALLOWED_RESOURCES = new Set([
  // practice (provider) scope
  "patients",
  "memberships",
  "invoices",
  "members",
  "plans",
  "practice",
  "subscriptions",
  "episodes",
  // partner scope
  "practices",
  "partner",
  "users",
  "providers",
  "memberships_summary",
  "organizations",
  "memberships_revenue",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const practiceKey = Deno.env.get("HINT_PRACTICE_API_KEY");
    const partnerKey = Deno.env.get("HINT_PARTNER_API_KEY");

    if (!practiceKey && !partnerKey) {
      return json(
        { error: "Hint API keys are not configured on the server." },
        500,
      );
    }

    const body: RequestBody = req.method === "POST" ? await req.json() : {};
    const resource = (body.resource ?? "patients").toLowerCase();
    const scope = body.scope ?? "practice";
    const method = body.method ?? "GET";

    if (!ALLOWED_RESOURCES.has(resource)) {
      return json(
        {
          error: `Unsupported resource "${resource}". Allowed: ${[...ALLOWED_RESOURCES].join(", ")}`,
        },
        400,
      );
    }

    const apiKey = scope === "partner" ? partnerKey : practiceKey;
    if (!apiKey) {
      return json(
        { error: `Hint ${scope} API key is not configured.` },
        500,
      );
    }

    // Build target URL — partner scope hits /api/partner/*, practice hits /api/provider/*
    const base = scope === "partner" ? HINT_PARTNER_BASE : HINT_PRACTICE_BASE;
    const path = body.id ? `${resource}/${encodeURIComponent(body.id)}` : resource;
    const url = new URL(`${base}/${path}`);
    if (body.query) {
      for (const [k, v] of Object.entries(body.query)) {
        url.searchParams.set(k, String(v));
      }
    }

    const started = Date.now();
    const upstream = await fetch(url.toString(), {
      method,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        // Hint uses Bearer token auth (RFC 6750).
        Authorization: `Bearer ${apiKey}`,
      },
      body: method === "GET" || method === "DELETE"
        ? undefined
        : JSON.stringify(body.payload ?? {}),
    });

    const elapsedMs = Date.now() - started;
    const text = await upstream.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // leave as text
    }

    // Hint returns pagination metadata in response headers. Surface whatever
    // we can find so the UI can render "Showing 10 of 47" style counts.
    const PAGINATION_HEADER_KEYS = [
      "x-total-count",
      "total-count",
      "x-total",
      "total",
      "x-total-pages",
      "total-pages",
      "x-page",
      "page",
      "x-per-page",
      "per-page",
      "x-limit",
      "x-offset",
      "link",
    ];
    const paginationHeaders: Record<string, string> = {};
    for (const key of PAGINATION_HEADER_KEYS) {
      const value = upstream.headers.get(key);
      if (value !== null) paginationHeaders[key] = value;
    }
    const totalRaw =
      paginationHeaders["x-total-count"] ??
      paginationHeaders["total-count"] ??
      paginationHeaders["x-total"] ??
      paginationHeaders["total"];
    const total = totalRaw !== undefined ? Number(totalRaw) : undefined;

    return json(
      {
        source: "sandbox.hint.lovable.local",
        upstream: url.toString(),
        scope,
        status: upstream.status,
        elapsedMs,
        generated: new Date().toISOString(),
        pagination: {
          total: Number.isFinite(total) ? total : null,
          headers: paginationHeaders,
        },
        data: parsed,
      },
      upstream.ok ? 200 : upstream.status,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return json({ error: message }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
