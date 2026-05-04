// Elation Health LIVE proxy — READ-ONLY.
//
// Mirrors elation-sandbox but uses production credentials:
//   ELATION_CLIENT_ID
//   ELATION_CLIENT_SECRET
//   ELATION_BASE_URL                 (e.g. https://api.elationemr.com/api/2.0)
// Optional:
//   ELATION_TOKEN_URL                (defaults to {BASE}/oauth2/token/)
//   ELATION_FHIR_BASE                (e.g. https://fhir.elationemr.com)

import { corsHeaders, requireStaff, logPhiAccess } from "../_shared/auth.ts";

// NOTE: Elation's production REST host is `app.elationemr.com` — not
// `api.elationemr.com` (that hostname does not resolve). FHIR lives on
// `fhir.elationemr.com`. We override any saved ELATION_BASE_URL that points
// at the non-existent api.* host to keep the integration working.
const DEFAULT_REST_BASE = "https://app.elationemr.com/api/2.0";
const DEFAULT_FHIR_BASE = "https://fhir.elationemr.com";

type Scope = "rest" | "fhir";
type RequestBody = {
  resource?: string;
  id?: string;
  method?: string;
  scope?: Scope;
  query?: Record<string, string | number | boolean>;
};

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

type CachedToken = { accessToken: string; expiresAt: number };
const tokenCache = new Map<string, CachedToken>();

function sanitizeBase(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  const trimmed = raw.replace(/\s+/g, "").replace(/\/+$/, "");
  if (!trimmed) return fallback;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    new URL(withScheme);
    return withScheme;
  } catch {
    return fallback;
  }
}

async function getAccessToken(
  tokenUrl: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const cacheKey = `${tokenUrl}::${clientId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.accessToken;

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
    throw new Error(`Elation token exchange failed [${res.status}]: ${text.slice(0, 500)}`);
  }
  const parsed = JSON.parse(text) as { access_token?: string; expires_in?: number };
  if (!parsed.access_token) throw new Error("Elation token response missing `access_token`");
  tokenCache.set(cacheKey, {
    accessToken: parsed.access_token,
    expiresAt: Date.now() + (parsed.expires_in ?? 3600) * 1000,
  });
  return parsed.access_token;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireStaff(req);
  if (auth instanceof Response) return auth;

  try {
    const clientId = Deno.env.get("ELATION_CLIENT_ID");
    const clientSecret = Deno.env.get("ELATION_CLIENT_SECRET");
    // Hard-pin to the correct production hosts. The previously-saved
    // ELATION_BASE_URL / ELATION_TOKEN_URL secrets pointed at
    // `api.elationemr.com` which does not resolve. Ignore env host overrides
    // unless explicitly opted in via ELATION_ALLOW_ENV_HOST=true.
    const allowEnvHost = Deno.env.get("ELATION_ALLOW_ENV_HOST") === "true";
    const restBase = allowEnvHost
      ? sanitizeBase(Deno.env.get("ELATION_BASE_URL"), DEFAULT_REST_BASE)
      : DEFAULT_REST_BASE;
    const fhirBase = allowEnvHost
      ? sanitizeBase(Deno.env.get("ELATION_FHIR_BASE"), DEFAULT_FHIR_BASE)
      : DEFAULT_FHIR_BASE;
    const tokenUrl = allowEnvHost
      ? (Deno.env.get("ELATION_TOKEN_URL") ?? `${restBase}/oauth2/token/`)
      : `${restBase}/oauth2/token/`;
    console.log("[elation-live] tokenUrl=", tokenUrl, "restBase=", restBase);

    if (!clientId || !clientSecret) {
      return json(
        {
          ok: false,
          status: "awaiting_credentials",
          configured: false,
          error:
            "Elation production credentials are not configured. Add ELATION_CLIENT_ID and ELATION_CLIENT_SECRET.",
        },
        200,
      );
    }

    const body: RequestBody = req.method === "POST" ? await req.json() : {};
    const scope: Scope = body.scope === "fhir" ? "fhir" : "rest";
    const resource = body.resource ?? (scope === "fhir" ? "Patient" : "patients");

    if (body.method && body.method.toUpperCase() !== "GET") {
      return json(
        {
          ok: false,
          error:
            "elation-live is read-only. Only GET requests to Elation are permitted.",
        },
        200,
      );
    }

    const allowed = ALLOWED_RESOURCES[scope];
    if (!allowed.has(resource)) {
      return json(
        {
          ok: false,
          error: `Unsupported resource "${resource}" for scope "${scope}". Allowed: ${[...allowed].join(", ")}`,
        },
        200,
      );
    }

    let accessToken: string;
    try {
      accessToken = await getAccessToken(tokenUrl, clientId, clientSecret);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return json(
        {
          ok: false,
          status: "invalid_credentials",
          configured: false,
          error: message.includes("invalid_client")
            ? "Elation rejected the configured client credentials."
            : `Elation token exchange failed: ${message}`,
        },
        200,
      );
    }

    const isFhir = scope === "fhir";
    const base = isFhir ? fhirBase : restBase;
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
      // raw text
    }

    let total: number | null = null;
    let next: string | null = null;
    let previous: string | null = null;
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      if (typeof obj.count === "number") total = obj.count;
      if (typeof obj.total === "number") total = obj.total;
      if (typeof obj.next === "string") next = obj.next;
      if (typeof obj.previous === "string") previous = obj.previous;
    }

    await logPhiAccess(auth, req, {
      source: "elation-live",
      resource,
      scope,
      resource_id: body.id,
      http_status: upstream.status,
      row_count: total,
    });

    return json(
      {
        ok: upstream.ok,
        source: "live.elation",
        upstream: url.toString(),
        scope,
        status: upstream.status,
        elapsedMs,
        generated: new Date().toISOString(),
        pagination: { total, next, previous },
        data: parsed,
        error: upstream.ok
          ? undefined
          : `Elation returned ${upstream.status}`,
      },
      200,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return json({ ok: false, error: message }, 200);
  }
});
