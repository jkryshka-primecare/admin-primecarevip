// Hint Health LIVE proxy.
// Proxies requests to https://api.hint.com using practice/partner API keys.
// Mirrors hint-sandbox but points at production.

import { corsHeaders, requireStaff, logPhiAccess } from "../_shared/auth.ts";

const HINT_HOST = "https://api.hint.com";
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
  "patients",
  "memberships",
  "invoices",
  "members",
  "plans",
  "practice",
  "subscriptions",
  "episodes",
  "practices",
  "partner",
  "users",
  "providers",
  "memberships_summary",
  "organizations",
  "memberships_revenue",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireStaff(req);
  if (auth instanceof Response) return auth;

  try {
    const practiceKey = Deno.env.get("HINT_PRACTICE_API_KEY");
    const partnerKey = Deno.env.get("HINT_PARTNER_API_KEY");
    if (!practiceKey && !partnerKey) {
      return json({ error: "Hint API keys are not configured." }, 500);
    }

    const body: RequestBody = req.method === "POST" ? await req.json() : {};
    const resource = (body.resource ?? "patients").toLowerCase();
    const scope = body.scope ?? "practice";
    const method = body.method ?? "GET";

    if (!ALLOWED_RESOURCES.has(resource)) {
      return json({ error: `Unsupported resource "${resource}".` }, 400);
    }

    const apiKey = (scope === "partner" ? partnerKey : practiceKey)?.trim();
    if (!apiKey) return json({ error: `Hint ${scope} API key missing.` }, 500);

    const base = scope === "partner" ? HINT_PARTNER_BASE : HINT_PRACTICE_BASE;
    const path = body.id ? `${resource}/${encodeURIComponent(body.id)}` : resource;
    const url = new URL(`${base}/${path}`);
    if (body.query) {
      for (const [k, v] of Object.entries(body.query)) url.searchParams.set(k, String(v));
    }

    const started = Date.now();
    const upstream = await fetch(url.toString(), {
      method,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: method === "GET" || method === "DELETE" ? undefined : JSON.stringify(body.payload ?? {}),
    });

    const elapsedMs = Date.now() - started;
    const text = await upstream.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* keep text */ }

    const PAG_KEYS = ["x-total-count","total-count","x-total","total","x-total-pages","total-pages","x-page","page","x-per-page","per-page","x-limit","x-offset","link"];
    const paginationHeaders: Record<string, string> = {};
    for (const k of PAG_KEYS) {
      const v = upstream.headers.get(k);
      if (v !== null) paginationHeaders[k] = v;
    }
    const totalRaw = paginationHeaders["x-total-count"] ?? paginationHeaders["total-count"] ?? paginationHeaders["x-total"] ?? paginationHeaders["total"];
    const total = totalRaw !== undefined ? Number(totalRaw) : undefined;

    await logPhiAccess(auth, req, {
      source: "hint-live",
      resource,
      scope,
      resource_id: body.id,
      http_status: upstream.status,
      row_count: Number.isFinite(total) ? Number(total) : (Array.isArray(parsed) ? parsed.length : null),
    });

    return json({
      source: "live.hint",
      upstream: url.toString(),
      scope,
      status: upstream.status,
      elapsedMs,
      generated: new Date().toISOString(),
      pagination: { total: Number.isFinite(total) ? total : null, headers: paginationHeaders },
      data: parsed,
    }, upstream.ok ? 200 : upstream.status);
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
