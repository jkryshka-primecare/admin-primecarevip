// Firestore READ-ONLY bridge.
//
// Reads documents from the Prime Care VIP Firebase project (member/patient
// apps) using a Google service account. Server-side only — the service
// account never reaches the browser.
//
// SAFETY: this function implements ONLY `get` and `runQuery`. There is no
// create/update/delete code path. Live production data must never be
// mutated from this admin OS without explicit per-action approval.

import { corsHeaders, requireStaff, logPhiAccess } from "../_shared/auth.ts";

type ServiceAccount = {
  client_email: string;
  private_key: string;
  project_id: string;
};

type Filter = { field: string; op?: string; value: unknown };

type RequestBody = {
  collection?: string;
  id?: string;
  where?: Filter[];
  orderBy?: { field: string; direction?: "asc" | "desc" };
  limit?: number;
  cursor?: number; // simple offset cursor
};

// Read-only whitelist. Anything not listed here is rejected.
const ALLOWED_COLLECTIONS = new Set([
  "patients",
  "appointment_requests",
  "billing_accounts",
  "billing_invoices",
  "billing_subscriptions",
  "pharmacy_orders",
  "chat_conversations",
  "messages",
  "directory",
  "locations",
  "family",
  "onboard_fees",
]);

const OP_MAP: Record<string, string> = {
  "==": "EQUAL",
  "!=": "NOT_EQUAL",
  "<": "LESS_THAN",
  "<=": "LESS_THAN_OR_EQUAL",
  ">": "GREATER_THAN",
  ">=": "GREATER_THAN_OR_EQUAL",
  "array-contains": "ARRAY_CONTAINS",
  in: "IN",
};

let cachedToken: { token: string; expiresAt: number } | null = null;

function loadServiceAccount(): ServiceAccount {
  const raw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT is not configured.");
  const sa = JSON.parse(raw) as ServiceAccount;
  if (!sa.client_email || !sa.private_key || !sa.project_id) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT is missing required fields.");
  }
  return sa;
}

function b64url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\\n/g, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - 60 > now) return cachedToken.token;

  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      // Read-only Datastore scope. Even with a broader IAM role, the token
      // cannot be used to write.
      scope: "https://www.googleapis.com/auth/datastore",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${header}.${claim}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(sa.private_key.replace(/\\n/g, "\n")),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)),
  );
  const assertion = `${unsigned}.${b64url(sig)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const payload = await res.json();
  if (!res.ok || !payload.access_token) {
    throw new Error(`Google token exchange failed: ${payload.error_description ?? res.status}`);
  }
  cachedToken = { token: payload.access_token, expiresAt: now + (payload.expires_in ?? 3600) };
  return cachedToken.token;
}

/** Firestore typed value -> plain JS. */
function decodeValue(v: Record<string, unknown>): unknown {
  if (v === null || v === undefined) return null;
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("stringValue" in v) return v.stringValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("referenceValue" in v) return v.referenceValue;
  if ("geoPointValue" in v) return v.geoPointValue;
  if ("bytesValue" in v) return v.bytesValue;
  if ("arrayValue" in v) {
    const arr = (v.arrayValue as { values?: Record<string, unknown>[] }).values ?? [];
    return arr.map(decodeValue);
  }
  if ("mapValue" in v) {
    return decodeFields((v.mapValue as { fields?: Record<string, never> }).fields ?? {});
  }
  return null;
}

function decodeFields(fields: Record<string, Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields ?? {})) out[k] = decodeValue(v);
  return out;
}

function decodeDoc(doc: {
  name?: string;
  fields?: Record<string, Record<string, unknown>>;
  createTime?: string;
  updateTime?: string;
}) {
  const id = doc.name?.split("/").pop() ?? null;
  return {
    id,
    ...decodeFields(doc.fields ?? {}),
    _createTime: doc.createTime ?? null,
    _updateTime: doc.updateTime ?? null,
  };
}

/** Encode a JS value into Firestore typed-value JSON (query filters only). */
function encodeValue(v: unknown): Record<string, unknown> {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encodeValue) } };
  return { stringValue: String(v) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireStaff(req);
  if (auth instanceof Response) return auth;

  const started = Date.now();
  try {
    const body: RequestBody = req.method === "POST" ? await req.json() : {};
    const collection = (body.collection ?? "").trim();

    if (!ALLOWED_COLLECTIONS.has(collection)) {
      return json({ error: `Collection "${collection}" is not readable through this bridge.` }, 400);
    }

    const sa = loadServiceAccount();
    const token = await getAccessToken(sa);
    const base = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents`;

    let upstream: Response;
    let url: string;

    if (body.id) {
      url = `${base}/${collection}/${encodeURIComponent(body.id)}`;
      upstream = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    } else {
      url = `${base}:runQuery`;
      const filters = (body.where ?? []).map((f) => ({
        fieldFilter: {
          field: { fieldPath: f.field },
          op: OP_MAP[f.op ?? "=="] ?? "EQUAL",
          value: encodeValue(f.value),
        },
      }));
      const structuredQuery: Record<string, unknown> = {
        from: [{ collectionId: collection }],
        limit: Math.min(Math.max(body.limit ?? 50, 1), 300),
      };
      if (filters.length === 1) structuredQuery.where = filters[0];
      if (filters.length > 1) {
        structuredQuery.where = { compositeFilter: { op: "AND", filters } };
      }
      if (body.orderBy) {
        structuredQuery.orderBy = [
          {
            field: { fieldPath: body.orderBy.field },
            direction: body.orderBy.direction === "desc" ? "DESCENDING" : "ASCENDING",
          },
        ];
      }
      if (body.cursor && body.cursor > 0) structuredQuery.offset = body.cursor;

      upstream = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ structuredQuery }),
      });
    }

    const elapsedMs = Date.now() - started;
    const text = await upstream.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* keep text */ }

    let data: unknown = parsed;
    let rowCount: number | null = null;

    if (upstream.ok) {
      if (body.id) {
        data = decodeDoc(parsed as never);
        rowCount = 1;
      } else {
        const rows = (parsed as { document?: never }[])
          .filter((r) => r && r.document)
          .map((r) => decodeDoc(r.document as never));
        data = rows;
        rowCount = rows.length;
      }
    }

    await logPhiAccess(auth, req, {
      source: "firestore-bridge",
      resource: collection,
      scope: "read",
      resource_id: body.id,
      http_status: upstream.status,
      row_count: rowCount,
    });

    return json({
      source: "firestore",
      upstream: url,
      collection,
      status: upstream.status,
      ok: upstream.ok,
      error: upstream.ok
        ? undefined
        : ((parsed as { error?: { message?: string } })?.error?.message ?? `Firestore returned ${upstream.status}`),
      elapsedMs,
      generated: new Date().toISOString(),
      pagination: { total: rowCount },
      data,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return json({
      source: "firestore",
      status: 500,
      ok: false,
      error: message,
      elapsedMs: Date.now() - started,
      generated: new Date().toISOString(),
      data: null,
    });
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
