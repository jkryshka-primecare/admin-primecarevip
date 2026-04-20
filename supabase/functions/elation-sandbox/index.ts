// Elation Health sandbox proxy — READ-ONLY.
//
// IMPORTANT: This integration is analytics-only. We never push data back into
// Elation or to patients. The function therefore:
//   - Only issues GET requests to Elation
//   - Rejects any client-supplied method other than GET
//   - Excludes patient-facing/write resources (messages, letters, bills,
//     DocumentReference, etc.) from the allow-list
//
// Mirrors the hint-sandbox pattern (resource/scope routing, pagination,
// error handling) but adapts to Elation's auth model:
//   - OAuth 2.0 client_credentials grant against the sandbox token endpoint
//   - Tokens cached in-memory until 60s before expiry
//   - Two API surfaces selectable via `scope`:
//       * "rest" (default) → REST v2  https://sandbox.elationemr.com/api/2.0/
//       * "fhir"           → FHIR R4  https://sandboxfhir.elationemr.com/
//
// Usage from the client:
//   supabase.functions.invoke("elation-sandbox", {
//     body: { resource: "patients", query: { limit: 25, offset: 0 } }
//   })
//
// Required Supabase secrets (configure once Elation issues sandbox creds):
//   ELATION_SANDBOX_CLIENT_ID
//   ELATION_SANDBOX_CLIENT_SECRET
// Optional overrides (defaults shown):
//   ELATION_SANDBOX_TOKEN_URL  = https://sandbox.elationemr.com/api/2.0/oauth2/token/
//   ELATION_SANDBOX_REST_BASE  = https://sandbox.elationemr.com/api/2.0
//   ELATION_SANDBOX_FHIR_BASE  = https://sandboxfhir.elationemr.com

import { corsHeaders, requireStaff, logPhiAccess } from "../_shared/auth.ts";

const DEFAULT_TOKEN_URL =
  "https://sandbox.elationemr.com/api/2.0/oauth2/token/";
const DEFAULT_REST_BASE = "https://sandbox.elationemr.com/api/2.0";
const DEFAULT_FHIR_BASE = "https://sandboxfhir.elationemr.com";

type Scope = "rest" | "fhir";
type RequestBody = {
  resource?: string;
  id?: string;
  // `method` is intentionally ignored — we always issue GET to Elation.
  method?: string;
  scope?: Scope;
  query?: Record<string, string | number | boolean>;
};

// Read-only allow-list. Resources that imply patient-facing writes
// (messages, letters, bills, DocumentReference) are intentionally excluded.
const ALLOWED_RESOURCES: Record<Scope, Set<string>> = {
  rest: new Set([
    "patients",
    "appointments",
    "physicians",
    "practices",
    "service_locations",
    "problems",
    "allergies",
    "medications",
    "lab_orders",
    "lab_reports",
    "vitals",
    "visit_notes",
    "insurances",
  ]),
  fhir: new Set([
    "Patient",
    "Practitioner",
    "Appointment",
    "Encounter",
    "Condition",
    "AllergyIntolerance",
    "MedicationRequest",
    "Observation",
    "Organization",
    "Location",
  ]),
};

// ── Token cache ──────────────────────────────────────────────────────────
// Cached per (token_url + client_id) in case the function is reused across
// multiple sandbox tenants in the future.
type CachedToken = { accessToken: string; expiresAt: number };
const tokenCache = new Map<string, CachedToken>();

async function getAccessToken(
  tokenUrl: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const cacheKey = `${tokenUrl}::${clientId}`;
  const cached = tokenCache.get(cacheKey);
  // Refresh 60s before expiry to avoid races.
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.accessToken;
  }

  const form = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: form.toString(),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `Elation token exchange failed [${res.status}]: ${text.slice(0, 500)}`,
    );
  }

  let parsed: { access_token?: string; expires_in?: number } = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      `Elation token endpoint returned non-JSON: ${text.slice(0, 200)}`,
    );
  }
  if (!parsed.access_token) {
    throw new Error("Elation token response missing `access_token`");
  }

  // Default to 1h if `expires_in` is absent.
  const ttlSeconds = parsed.expires_in ?? 3600;
  tokenCache.set(cacheKey, {
    accessToken: parsed.access_token,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });

  return parsed.access_token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // PHI gate: require signed-in staff/clinician/admin.
  const auth = await requireStaff(req);
  if (auth instanceof Response) return auth;

  try {
    const clientId = Deno.env.get("ELATION_SANDBOX_CLIENT_ID");
    const clientSecret = Deno.env.get("ELATION_SANDBOX_CLIENT_SECRET");
    const tokenUrl =
      Deno.env.get("ELATION_SANDBOX_TOKEN_URL") ?? DEFAULT_TOKEN_URL;
    const restBase =
      Deno.env.get("ELATION_SANDBOX_REST_BASE") ?? DEFAULT_REST_BASE;
    const fhirBase =
      Deno.env.get("ELATION_SANDBOX_FHIR_BASE") ?? DEFAULT_FHIR_BASE;

    if (!clientId || !clientSecret) {
      return json(
        {
          error:
            "Elation sandbox credentials are not configured. Add ELATION_SANDBOX_CLIENT_ID and ELATION_SANDBOX_CLIENT_SECRET as secrets once Elation provisions your sandbox.",
          configured: false,
        },
        503,
      );
    }

    const body: RequestBody = req.method === "POST" ? await req.json() : {};
    const scope: Scope = body.scope === "fhir" ? "fhir" : "rest";
    const resource = body.resource ?? (scope === "fhir" ? "Patient" : "patients");

    // Hard-enforce read-only. Any non-GET method from the client is rejected.
    if (body.method && body.method.toUpperCase() !== "GET") {
      return json(
        {
          error:
            "elation-sandbox is read-only. Only GET requests to Elation are permitted (analytics pull only — no writes back to patients).",
        },
        405,
      );
    }

    const allowed = ALLOWED_RESOURCES[scope];
    if (!allowed.has(resource)) {
      return json(
        {
          error: `Unsupported resource "${resource}" for scope "${scope}". Allowed (read-only): ${[...allowed].join(", ")}`,
        },
        400,
      );
    }

    const accessToken = await getAccessToken(tokenUrl, clientId, clientSecret);

    const base = scope === "fhir" ? fhirBase : restBase;
    // REST v2 expects trailing slashes on collection routes; FHIR does not.
    const isFhir = scope === "fhir";
    const idSegment = body.id
      ? `/${encodeURIComponent(body.id)}${isFhir ? "" : "/"}`
      : isFhir
      ? ""
      : "/";
    const url = new URL(`${base}/${resource}${idSegment}`);
    if (body.query) {
      for (const [k, v] of Object.entries(body.query)) {
        url.searchParams.set(k, String(v));
      }
    }

    const started = Date.now();
    const upstream = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: isFhir ? "application/fhir+json" : "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const elapsedMs = Date.now() - started;
    const text = await upstream.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // leave as raw text — Elation occasionally returns HTML on 5xx
    }

    // Elation REST v2 paginates list endpoints with a JSON envelope:
    //   { count, next, previous, results: [...] }
    // FHIR uses Bundle with `total` and `link[]`. Surface a uniform shape.
    let total: number | null = null;
    let next: string | null = null;
    let previous: string | null = null;
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      if (typeof obj.count === "number") total = obj.count;
      if (typeof obj.total === "number") total = obj.total; // FHIR
      if (typeof obj.next === "string") next = obj.next;
      if (typeof obj.previous === "string") previous = obj.previous;
    }


    await logPhiAccess(auth, req, {
      source: "elation-sandbox",
      resource,
      scope,
      resource_id: body.id,
      http_status: upstream.status,
      row_count: total,
    });

    return json(
      {
        source: "sandbox.elation.lovable.local",
        upstream: url.toString(),
        scope,
        status: upstream.status,
        elapsedMs,
        generated: new Date().toISOString(),
        pagination: {
          total,
          next,
          previous,
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
