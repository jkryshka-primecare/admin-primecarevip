// Elation Health LIVE proxy — READ-ONLY production endpoint.
//
// This is the production sibling of `elation-sandbox`. It hits Elation's
// live OAuth endpoint and REST/FHIR base, using the production credentials
// stored as Supabase secrets:
//
//   ELATION_CLIENT_ID
//   ELATION_CLIENT_SECRET
//   ELATION_BASE_URL          (default: https://api.elationemr.com/api/2.0)
// Optional overrides:
//   ELATION_TOKEN_URL         (default: `${ELATION_BASE_URL}/oauth2/token/`)
//   ELATION_FHIR_BASE         (default: https://fhir.elationemr.com)
//
// SAFETY:
//   - Never issues anything other than GET to Elation (analytics-only).
//   - Resource allow-list excludes any patient-facing/write endpoints
//     (messages, letters, bills, DocumentReference, etc.).
//   - Every call is gated by requireStaff() and recorded in phi_access_log.

import { corsHeaders, requireStaff, logPhiAccess } from "../_shared/auth.ts";

const DEFAULT_BASE = "https://api.elationemr.com/api/2.0";
const DEFAULT_FHIR_BASE = "https://fhir.elationemr.com";

type Scope = "rest" | "fhir";
type RequestBody = {
  resource?: string;
  id?: string;
  method?: string; // ignored — always GET
  scope?: Scope;
  query?: Record<string, string | number | boolean>;
};

// Read-only allow-list — same shape as the sandbox.
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

// In-memory token cache, keyed by token URL + client ID.
type CachedToken = { accessToken: string; expiresAt: number };
const tokenCache = new Map<string, CachedToken>();

async function getAccessToken(
  tokenUrl: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const cacheKey = `${tokenUrl}::${clientId}`;
  const cached = tokenCache.get(cacheKey);
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

  // PHI gate: must be a staff/clinician/admin.
  const auth = await requireStaff(req);
  if (auth instanceof Response) return auth;

  try {
    const clean = (v: string | undefined) => v?.replace(/\s+/g, "").trim() || undefined;
    const isValidHttpUrl = (v: string) => {
      try { const u = new URL(v); return u.protocol === "https:" || u.protocol === "http:"; }
      catch { return false; }
    };

    const clientId = clean(Deno.env.get("ELATION_CLIENT_ID"));
    const clientSecret = clean(Deno.env.get("ELATION_CLIENT_SECRET"));
    const envBase = clean(Deno.env.get("ELATION_BASE_URL"));
    const restBase = envBase && isValidHttpUrl(envBase) ? envBase.replace(/\/+$/, "") : DEFAULT_BASE;
    const envTokenUrl = clean(Deno.env.get("ELATION_TOKEN_URL"));
    const tokenUrl =
      envTokenUrl && isValidHttpUrl(envTokenUrl)
        ? envTokenUrl
        : `${restBase}/oauth2/token/`;
    const envFhir = clean(Deno.env.get("ELATION_FHIR_BASE"));
    const fhirBase = envFhir && isValidHttpUrl(envFhir) ? envFhir.replace(/\/+$/, "") : DEFAULT_FHIR_BASE;

    if (!clientId || !clientSecret) {
      return json(
        {
          status: "awaiting_credentials",
          configured: false,
          error:
            "Elation production credentials are not configured. Add ELATION_CLIENT_ID and ELATION_CLIENT_SECRET as secrets.",
        },
        200,
      );
    }

    const body: RequestBody = req.method === "POST" ? await req.json() : {};
    const scope: Scope = body.scope === "fhir" ? "fhir" : "rest";
    const resource =
      body.resource ?? (scope === "fhir" ? "Patient" : "patients");

    if (body.method && body.method.toUpperCase() !== "GET") {
      return json(
        {
          error:
            "elation-live is read-only. Only GET requests to Elation are permitted (analytics pull only — no writes back to patients).",
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
      // leave raw — Elation occasionally returns HTML on 5xx
    }

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
      source: "elation-live",
      resource,
      scope,
      resource_id: body.id,
      http_status: upstream.status,
      row_count: total,
    });

    return json(
      {
        source: "live.elation",
        upstream: url.toString(),
        scope,
        status: upstream.status,
        elapsedMs,
        generated: new Date().toISOString(),
        pagination: { total, next, previous },
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
