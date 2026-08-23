// Portal control plane — the ONLY bridge between this admin OS and the
// patient portal's write endpoints.
//
// This function does not write to Firestore itself. It authenticates the
// staff member, mints a short-lived Google identity token for the
// `portal-admin` service account, and calls the four admin-only Cloud
// Functions in the Firebase project. Those functions are the only code that
// mutates portal state, and they live in the audited Google codebase.
//
// SAFETY:
//   - Reads (`get`) need staff. Every mutation needs admin/super_admin.
//   - Mutations require a reason and are recorded in `portal_admin_actions`
//     plus `phi_access_log` before the result is returned.
//   - There is no code path here that touches Elation, Hint, or member
//     demographics. Portal visibility and invites only.

import { corsHeaders, requireStaff, logPhiAccess, deny, type AuthContext } from "../_shared/auth.ts";

type ServiceAccount = {
  client_email: string;
  private_key: string;
  project_id: string;
};

type Action =
  | "get"
  | "invite"
  | "revoke"
  | "setAccess"
  | "provision"
  | "runAudit"
  | "smoke"
  | "unclaimedGuardians"
  | "backfillUids"
  | "backfillArtifacts"
  | "backfillMinorReports"
  | "linkGuardians";

const FUNCTION_BY_ACTION: Record<Action, string> = {
  get: "adminGetPortalAccess",
  invite: "adminIssueInvite",
  revoke: "adminRevokeInvite",
  setAccess: "adminSetPortalAccess",
  provision: "adminProvisionPatients",
  runAudit: "adminRunArtifactAudit",
  smoke: "adminRunReadPathSmoke",
  unclaimedGuardians: "adminUnclaimedGuardiansReport",
  backfillUids: "backfillInternalUids",
  backfillArtifacts: "backfillArtifactObjects",
  backfillMinorReports: "backfillElationReports",
  linkGuardians: "adminLinkGuardian",
};

const MUTATIONS: Action[] = ["invite", "revoke", "setAccess", "provision"];

/**
 * Admin-only but not a member mutation: it changes no patient state, it only
 * asks the artifact-coverage job to run now instead of at 03:15.
 */
const ADMIN_ONLY: Action[] = ["runAudit", "smoke", "unclaimedGuardians"];

/**
 * Release 2b Part B bulk migrations. Blast radius is bulk PHI, not one record:
 *   - a DRY RUN (`apply` absent/false) needs admin, like any other check;
 *   - an APPLY needs the narrowest tier, `super_admin`, resolved server-side
 *     from the verified session — never from anything the client sends;
 *   - an APPLY writes its `portal_admin_actions` row BEFORE the upstream call
 *     and refuses to call if that write fails. The Cloud Function only ever
 *     sees `portal-admin`, so this row is the sole human-attribution record
 *     for a PHI migration.
 */
const BULK_MIGRATIONS: Action[] = [
  "backfillUids",
  "backfillArtifacts",
  "backfillMinorReports",
  "linkGuardians",
];

/**
 * Bulk actions that this bridge fans out itself, one upstream call per row,
 * because the Cloud Function is a single-record endpoint. Everything else
 * makes exactly one upstream call.
 */
const FAN_OUT: Action[] = ["linkGuardians"];

/** Actions that act on a set of members rather than a single patient. */
const BATCH_ACTIONS: Action[] = [
  "provision",
  "runAudit",
  "smoke",
  "unclaimedGuardians",
  ...BULK_MIGRATIONS,
];

/** Upper bound on one minor-track ingest call. The 2b cohort is ~175. */
const MAX_MINOR_IDS = 500;


/**
 * Elation chart ids for the minor-track ingest. Shape-validated here and
 * re-validated against the real `dependent.isMinor` set inside the
 * `backfillElationReports` HTTP wrapper — that wrapper is the authority; this
 * list is a convenience and a fast failure.
 */
function parseMinorIds(raw: unknown): string[] | string {
  if (!Array.isArray(raw) || raw.length === 0) {
    return "Provide at least one minor Elation patient id.";
  }
  if (raw.length > MAX_MINOR_IDS) {
    return `Ingest at most ${MAX_MINOR_IDS} patients at a time (received ${raw.length}).`;
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const id = String(item ?? "").trim();
    if (!/^\d{6,25}$/.test(id)) return `"${id.slice(0, 40)}" is not a valid Elation patient id.`;
    if (seen.has(id)) return `Patient ${id} appears twice in the list.`;
    seen.add(id);
    out.push(id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Guardian-link CSV (Release 2b, Step 1)
// ---------------------------------------------------------------------------
// The client pastes raw CSV text. It is parsed and validated HERE, in the
// trusted server, and nothing about the caller's authority is read from it:
// the acting human comes from the verified session, the tier comes from the
// database. A row that fails validation is never sent upstream — it is
// reported back as `rejected` with a PHI-free reason.
//
// `adminLinkGuardian` re-validates everything again (child exists, child is a
// minor, source is known, no self-link) and is the authority. This parser is a
// fast, cheap failure so 194 bad rows do not become 194 upstream 400s.

/** Mirrors SOURCES in functions/core/services/patient/guardians.js. */
const GUARDIAN_SOURCES = ["hint_household", "inferred_email_name", "manual", "email_on_file"];

/** The finalized export is ~194 rows; this is a mistake-catcher, not a target. */
const MAX_GUARDIAN_ROWS = 1000;
/** Rows per fan-out page. 50 x (~400ms) leaves large headroom under 150s. */
const GUARDIAN_PAGE = 50;
const MAX_GUARDIAN_PAGE = 50;
/** A 194-row export is ~40KB. */
const MAX_CSV_CHARS = 512 * 1024;
/** Stop a page early and hand back a cursor rather than risk IDLE_TIMEOUT. */
const FAN_OUT_BUDGET_MS = 100_000;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type GuardianRow = {
  line: number;
  childElationId: string;
  guardianElationId: string;
  guardianHintId: string;
  guardianEmail: string;
  guardianName: string;
  source: string;
};

type GuardianRejection = { line: number; childElationId: string | null; reason: string };

/** Minimal RFC4180 split: quoted fields, doubled quotes, no embedded newlines. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function parseGuardianCsv(
  raw: unknown,
): { rows: GuardianRow[]; rejected: GuardianRejection[]; duplicates: number } | string {
  if (typeof raw !== "string" || !raw.trim()) {
    return "Paste the finalized guardian-links CSV, including its header row.";
  }
  if (raw.length > MAX_CSV_CHARS) {
    return "That CSV is larger than this console accepts. Split it or use a smaller export.";
  }

  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return "The CSV has a header but no rows.";

  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const required = ["minor_elation_id", "guardian_email", "match_source"];
  const missing = required.filter((h) => !header.includes(h));
  if (missing.length) {
    return `The CSV is missing required column(s): ${missing.join(", ")}.`;
  }
  if (lines.length - 1 > MAX_GUARDIAN_ROWS) {
    return `At most ${MAX_GUARDIAN_ROWS} rows at a time (received ${lines.length - 1}).`;
  }
  const col = (name: string) => header.indexOf(name);
  const at = (cells: string[], name: string) => {
    const i = col(name);
    return i > -1 ? (cells[i] ?? "").trim() : "";
  };

  const rows: GuardianRow[] = [];
  const rejected: GuardianRejection[] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitCsvLine(lines[i]);
    const line = i + 1;
    const childElationId = at(cells, "minor_elation_id");
    const guardianEmail = at(cells, "guardian_email").toLowerCase();
    const guardianElationId = at(cells, "guardian_elation_id");
    const guardianHintId = at(cells, "guardian_hint_id");
    const guardianName = at(cells, "guardian_name").slice(0, 200);
    // The export's `manual_search` is the operator-facing name for `manual`
    // (same normalization as load-guardian-links.js). Case/whitespace tolerant
    // so a re-export with different casing doesn't reject ~35 rows.
    const rawSource = at(cells, "match_source").toLowerCase().replace(/[\s-]+/g, "_");
    const source = rawSource === "manual_search" ? "manual" : rawSource;

    const reject = (reason: string) =>
      rejected.push({ line, childElationId: childElationId || null, reason });

    if (!childElationId) {
      reject("NO_MINOR_CHART_ID");
      continue;
    }
    if (!/^\d{6,25}$/.test(childElationId)) {
      reject("MINOR_CHART_ID_INVALID");
      continue;
    }
    if (!EMAIL_RE.test(guardianEmail)) {
      reject("GUARDIAN_EMAIL_INVALID");
      continue;
    }
    if (!GUARDIAN_SOURCES.includes(source)) {
      reject("UNKNOWN_SOURCE");
      continue;
    }
    if (guardianElationId && !/^\d{6,25}$/.test(guardianElationId)) {
      reject("GUARDIAN_CHART_ID_INVALID");
      continue;
    }
    // Every source except email_on_file asserts a real guardian chart.
    if (source !== "email_on_file" && !guardianElationId) {
      reject("GUARDIAN_CHART_REQUIRED");
      continue;
    }
    if (guardianElationId && guardianElationId === childElationId) {
      reject("SELF_LINK_REJECTED");
      continue;
    }

    // Idempotent upstream, but a duplicate pair inside one paste is a sign the
    // export was concatenated twice — drop it and say so.
    // Idempotent upstream, but a duplicate pair inside one paste is a sign the
    // export was concatenated twice — drop it and say so.
    //
    // The guardian key is the CHART id whenever there is one. Two guardians can
    // legitimately share a mailbox (Ella Goldstein -> Greg + Jill on one
    // ggoldstein@ address); keying on email would collapse them and the child
    // would lose a guardian. Email is the key only for `email_on_file`, where
    // by definition no chart exists.
    const guardianKey = guardianElationId
      ? `chart:${guardianElationId}`
      : `email:${guardianEmail}`;
    const key = `${childElationId}|${guardianKey}`;
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);

    rows.push({
      line,
      childElationId,
      guardianElationId,
      guardianHintId,
      guardianEmail,
      guardianName,
      source,
    });
  }

  if (!rows.length && !rejected.length) return "No usable rows found in that CSV.";
  return { rows, rejected, duplicates };
}


/**
 * A provision run creates portal roster records. It never sends an invite and
 * never touches Elation or Hint. The cap keeps a mistaken call small enough to
 * review and undo by hand.
 */
const MAX_PROVISION_BATCH = 300;

/** Non-patient documents that must never be created or acted on in bulk. */
const FIXTURE_HINT_MARKERS = ["_testseed", "test kieffer"];

type ProvisionMember = {
  hintId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  dob: string;
  phone: string | null;
  /** Optional manual override when automatic Elation matching is inconclusive. */
  elationPatientId?: string;
};


function parseProvisionMembers(raw: unknown): ProvisionMember[] | string {
  if (!Array.isArray(raw) || raw.length === 0) {
    return "Select at least one member to provision.";
  }
  if (raw.length > MAX_PROVISION_BATCH) {
    return `Provision at most ${MAX_PROVISION_BATCH} members at a time (received ${raw.length}).`;
  }
  const out: ProvisionMember[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") return "Malformed member in the selection.";
    const m = item as Record<string, unknown>;
    const hintId = String(m.hintId ?? "").trim();
    const firstName = String(m.firstName ?? "").trim();
    const lastName = String(m.lastName ?? "").trim();
    const dob = String(m.dob ?? "").trim();
    if (!hintId) return "Every member must carry a Hint id.";
    if (!firstName || !lastName) return `Member ${hintId} is missing a name.`;
    // Date of birth is the join key everywhere in this system; without it the
    // downstream Elation match cannot be trusted, so refuse rather than guess.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      return `Member ${hintId} has no usable date of birth.`;
    }
    if (seen.has(hintId)) return `Member ${hintId} appears twice in the selection.`;
    seen.add(hintId);

    const haystack = `${firstName} ${lastName}`.toLowerCase();
    if (FIXTURE_HINT_MARKERS.some((marker) => haystack.includes(marker))) {
      return `Refusing to provision the smoke-test fixture (${firstName} ${lastName}).`;
    }

    // A staff-supplied Elation chart id, used only when the automatic resolver
    // could not confidently match. Digits only: the doc id of a roster record
    // IS this value, so a malformed one must never get through.
    const elationPatientId = m.elationPatientId ? String(m.elationPatientId).trim() : "";
    if (elationPatientId && !/^\d{6,25}$/.test(elationPatientId)) {
      return `Member ${firstName} ${lastName} has an invalid Elation patient id.`;
    }

    out.push({
      hintId,
      firstName,
      lastName,
      email: m.email ? String(m.email).trim().slice(0, 320) : null,
      dob,
      phone: m.phone ? String(m.phone).trim().slice(0, 40) : null,
      ...(elationPatientId ? { elationPatientId } : {}),
    });


  }
  return out;
}

const FUNCTIONS_BASE =
  Deno.env.get("FIREBASE_FUNCTIONS_BASE_URL") ??
  "https://us-central1-prive-care-vip.cloudfunctions.net";

// Identity tokens are audience-scoped, so cache one per target function.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

// --- Credential mode -------------------------------------------------------
// Preferred: Workload Identity Federation. No Google private key exists
// anywhere; this function proves its own identity with a short-lived
// backend-issued OIDC token (ES256, public JWKS), exchanges it at Google STS,
// and impersonates `portal-admin` to mint the identity token the Cloud
// Functions gate expects. The gate cannot tell the difference — it only ever
// checked issuer, audience and caller email.
//
// Fallback: a downloaded service-account key, kept only so an in-flight
// deployment does not break. WIF wins whenever it is configured.

const WIF_AUDIENCE = Deno.env.get("GCP_WIF_AUDIENCE"); // //iam.googleapis.com/projects/<num>/locations/global/workloadIdentityPools/<pool>/providers/<provider>
const WIF_SERVICE_ACCOUNT = Deno.env.get("GCP_IMPERSONATE_SERVICE_ACCOUNT"); // portal-admin@prive-care-vip.iam.gserviceaccount.com
const BRIDGE_EMAIL = Deno.env.get("PORTAL_BRIDGE_EMAIL");
const BRIDGE_PASSWORD = Deno.env.get("PORTAL_BRIDGE_PASSWORD");

function wifConfigured(): boolean {
  return Boolean(WIF_AUDIENCE && WIF_SERVICE_ACCOUNT && BRIDGE_EMAIL && BRIDGE_PASSWORD);
}

/**
 * A backend-issued OIDC token for the dedicated bridge identity. This is a
 * machine account with no staff role and no data access — its only purpose is
 * to be a stable, verifiable `sub` that the WIF provider condition pins.
 */
async function getSubjectToken(): Promise<string> {
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) throw new Error("Backend URL/key unavailable for the bridge identity.");
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email: BRIDGE_EMAIL, password: BRIDGE_PASSWORD }),
  });
  const payload = await res.json();
  if (!res.ok || !payload.access_token) {
    throw new Error(`Bridge identity sign-in failed: ${payload.error_description ?? res.status}`);
  }
  return payload.access_token as string;
}

/** Google identity token for `portal-admin`, obtained with no private key. */
async function getIdentityTokenViaWif(audience: string): Promise<string> {
  const subjectToken = await getSubjectToken();

  const stsRes = await fetch("https://sts.googleapis.com/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grantType: "urn:ietf:params:oauth:grant-type:token-exchange",
      audience: WIF_AUDIENCE,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      requestedTokenType: "urn:ietf:params:oauth:token-type:access_token",
      subjectTokenType: "urn:ietf:params:oauth:token-type:jwt",
      subjectToken,
    }),
  });
  const sts = await stsRes.json();
  if (!stsRes.ok || !sts.access_token) {
    throw new Error(
      `Workload Identity exchange failed: ${sts.error_description ?? sts.error ?? stsRes.status}`,
    );
  }

  const idRes = await fetch(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${WIF_SERVICE_ACCOUNT}:generateIdToken`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sts.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ audience, includeEmail: true }),
    },
  );
  const idPayload = await idRes.json();
  if (!idRes.ok || !idPayload.token) {
    throw new Error(
      `Identity-token impersonation failed: ${idPayload.error?.message ?? idRes.status}`,
    );
  }
  return idPayload.token as string;
}

function loadServiceAccount(): ServiceAccount {
  const raw = Deno.env.get("PORTAL_ADMIN_SERVICE_ACCOUNT");
  if (!raw) {
    throw new Error(
      "Portal controls are not configured. Set up Workload Identity Federation (GCP_WIF_AUDIENCE, GCP_IMPERSONATE_SERVICE_ACCOUNT, PORTAL_BRIDGE_EMAIL, PORTAL_BRIDGE_PASSWORD) or, as a fallback, PORTAL_ADMIN_SERVICE_ACCOUNT.",
    );
  }
  const sa = JSON.parse(raw) as ServiceAccount;
  if (!sa.client_email || !sa.private_key) {
    throw new Error("PORTAL_ADMIN_SERVICE_ACCOUNT is missing required fields.");
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

/** Google OIDC identity token scoped to one Cloud Function URL. */
async function getIdentityToken(sa: ServiceAccount, audience: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const cached = tokenCache.get(audience);
  if (cached && cached.expiresAt - 60 > now) return cached.token;

  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      sub: sa.client_email,
      aud: "https://oauth2.googleapis.com/token",
      target_audience: audience,
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

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${b64url(sig)}`,
    }),
  });
  const payload = await res.json();
  if (!res.ok || !payload.id_token) {
    throw new Error(
      `Google identity-token exchange failed: ${payload.error_description ?? payload.error ?? res.status}`,
    );
  }
  tokenCache.set(audience, { token: payload.id_token, expiresAt: now + 3500 });
  return payload.id_token as string;
}

async function isAdmin(ctx: AuthContext): Promise<boolean> {
  const { data, error } = await ctx.supabase.rpc("is_hr_admin", { _user_id: ctx.user.id });
  if (error) return false;
  return Boolean(data);
}

/**
 * The narrowest tier, resolved from the DATABASE against the uid in the
 * verified session. Nothing in the request body can influence it — the client
 * only ever hides buttons, it never grants anything.
 */
async function isSuperAdmin(ctx: AuthContext): Promise<boolean> {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.user.id,
    _role: "super_admin",
  });
  if (error) return false;
  return Boolean(data);
}


async function recordAction(
  ctx: AuthContext,
  entry: {
    elationPatientId: string | null;
    action: string;
    reason: string | null;
    before?: unknown;
    after?: unknown;
    ok: boolean;
    httpStatus?: number;
    errorMessage?: string | null;
  },
): Promise<void> {
  try {
    await ctx.supabase.from("portal_admin_actions").insert({
      actor_user_id: ctx.user.id,
      actor_email: ctx.user.email ?? null,
      elation_patient_id: entry.elationPatientId,
      action: entry.action,
      reason: entry.reason,
      before_state: (entry.before ?? null) as never,
      after_state: (entry.after ?? null) as never,
      ok: entry.ok,
      http_status: entry.httpStatus ?? null,
      error_message: entry.errorMessage ?? null,
    });
  } catch {
    // Auditing must never break the operation the user asked for; the
    // phi_access_log write below is the second, independent trail.
  }
}

/**
 * Attribution-first audit write for bulk PHI migrations. Unlike recordAction
 * this FAILS CLOSED: the caller must not touch the upstream function if this
 * returns false. Upstream only ever sees `portal-admin`, so if this row is
 * missing there is no record anywhere of which human ran the migration.
 */
async function recordActionStrict(
  ctx: AuthContext,
  entry: { action: string; reason: string; after?: unknown },
): Promise<boolean> {
  const { error } = await ctx.supabase.from("portal_admin_actions").insert({
    actor_user_id: ctx.user.id,
    actor_email: ctx.user.email ?? null,
    elation_patient_id: null,
    action: entry.action,
    reason: entry.reason,
    before_state: null as never,
    after_state: (entry.after ?? null) as never,
    ok: false,
    http_status: null,
    error_message: "started — awaiting upstream result",
  });
  return !error;
}

/**
 * One audience-scoped identity token, cached. Same credential path as the
 * single-call flow below: WIF first, legacy key only if one was configured.
 */
async function mintIdToken(url: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const cached = tokenCache.get(url);
  if (cached && cached.expiresAt - 60 > now) return cached.token;
  if (wifConfigured()) {
    const token = await getIdentityTokenViaWif(url);
    tokenCache.set(url, { token, expiresAt: now + 3000 });
    return token;
  }
  return await getIdentityToken(loadServiceAccount(), url);
}

type LinkOutcome = {
  childElationId: string;
  guardian: string;
  ok: boolean;
  created?: boolean;
  status: number;
  reason?: string;
};

/**
 * Fan-out for `linkGuardians`. One `adminLinkGuardian` call per row, serial
 * with a small gap — the admin plane is not a bulk endpoint. Bounded by page
 * size AND by wall clock, so a slow upstream hands back a resumable offset
 * instead of dying at the 150s idle limit.
 *
 * The `actor` on every upstream call is the session email. Nothing from the
 * pasted CSV can influence who is recorded as having done this.
 */
async function fanOutGuardianLinks(
  ctx: AuthContext,
  url: string,
  page: GuardianRow[],
  offset: number,
  actor: string,
  reason: string,
): Promise<{ outcomes: LinkOutcome[]; processed: number }> {
  const idToken = await mintIdToken(url);
  const outcomes: LinkOutcome[] = [];
  const startedAt = Date.now();
  let processed = 0;

  for (const row of page) {
    if (Date.now() - startedAt > FAN_OUT_BUDGET_MS) break;
    // PHI-free handle for the audit trail and the UI. Chart-id first so two
    // guardians sharing one mailbox stay distinguishable in the log.
    const guardian = row.guardianElationId
      ? `chart:${row.guardianElationId}`
      : `email:${row.guardianEmail.split("@")[1] ?? "redacted"}`;
    let status = 0;
    let ok = false;
    let created: boolean | undefined;
    let failReason: string | undefined;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          childElationId: row.childElationId,
          actor,
          reason,
          source: row.source,
          guardianElationId: row.guardianElationId,
          guardianHintId: row.guardianHintId,
          guardianEmail: row.guardianEmail,
          guardianName: row.guardianName,
        }),
      });
      status = res.status;
      const text = await res.text();
      let body: Record<string, unknown> | null = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }
      ok = res.ok;
      if (ok) {
        created = Boolean((body as { created?: boolean } | null)?.created);
      } else {
        const env = body as { error?: { message?: string; details?: { reason?: string } } } | null;
        failReason = env?.error?.details?.reason ?? env?.error?.message ?? `HTTP_${status}`;
      }
    } catch (e) {
      status = 502;
      failReason = e instanceof Error ? e.message.slice(0, 200) : "UPSTREAM_UNREACHABLE";
    }

    processed += 1;
    outcomes.push({ childElationId: row.childElationId, guardian, ok, created, status, reason: failReason });

    // Per-row attribution: every linked child is individually accountable,
    // not buried in a batch summary.
    await recordAction(ctx, {
      elationPatientId: row.childElationId,
      action: "linkGuardians:link",
      reason,
      after: { guardianRef: guardian, source: row.source, created: created ?? false, row: offset + processed },
      ok,
      httpStatus: status,
      errorMessage: failReason ?? null,
    });

    await new Promise((r) => setTimeout(r, 120));
  }

  return { outcomes, processed };
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireStaff(req);
  if (auth instanceof Response) return auth;
  const ctx = auth;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return deny(400, "Invalid JSON body");
  }

  const action = String(body.action ?? "") as Action;
  if (!FUNCTION_BY_ACTION[action]) {
    return deny(400, `Unknown action "${action}"`);
  }

  const isBatch = BATCH_ACTIONS.includes(action);
  const elationPatientId = String(body.elationPatientId ?? "").trim();
  if (!isBatch && !elationPatientId) return deny(400, "elationPatientId is required");

  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";

  if (MUTATIONS.includes(action)) {
    if (!(await isAdmin(ctx))) {
      return deny(403, "Only administrators can change a member's portal access.");
    }
    if (!reason) {
      return deny(400, "A reason is required for this change.");
    }
  }

  if (ADMIN_ONLY.includes(action) && !(await isAdmin(ctx))) {
    return deny(403, "Only administrators can run coverage and read-path checks.");
  }

  const isBulk = BULK_MIGRATIONS.includes(action);
  const bulkApply = isBulk && body.apply === true;
  let minorIds: string[] = [];

  if (isBulk) {
    if (!(await isAdmin(ctx))) {
      return deny(403, "Only administrators can run migration checks.");
    }
    if (bulkApply) {
      // Tier resolved server-side from the verified session only.
      if (!(await isSuperAdmin(ctx))) {
        return deny(403, "Only a super administrator can apply a bulk migration.");
      }
      if (!reason) {
        return deny(400, "A written reason is required to apply a bulk migration.");
      }
    }
    if (action === "backfillMinorReports") {
      const parsed = parseMinorIds(body.patientIds);
      if (typeof parsed === "string") return deny(400, parsed);
      minorIds = parsed;
    }
  }

  let provisionMembers: ProvisionMember[] = [];
  if (action === "provision") {
    const parsed = parseProvisionMembers(body.members);
    if (typeof parsed === "string") return deny(400, parsed);
    provisionMembers = parsed;
  }


  // The acting person is taken from the verified session, never from the
  // client payload — the service account identifies the system, this
  // identifies the human.
  const actor = ctx.user.email ?? ctx.user.id;

  // --- linkGuardians ---------------------------------------------------------
  // Enforcement order, unchanged from the reviewed backfill pattern and all
  // already applied above this point:
  //   1. requireStaff  -> verified session (top of the handler)
  //   2. is_hr_admin   -> required even for a dry run (BULK_MIGRATIONS gate)
  //   3. super_admin   -> required for apply, resolved from the DB by uid
  //   4. non-empty reason required for apply
  // What remains here: parse/validate the CSV, write attribution FIRST, then
  // fan out. A dry run makes no upstream call at all — `adminLinkGuardian`
  // has no dry-run mode, so "dry run" here means validation only.
  if (action === "linkGuardians") {
    const parsed = parseGuardianCsv(body.csv);
    if (typeof parsed === "string") return deny(400, parsed);
    const { rows, rejected, duplicates } = parsed;

    const rawOffset = Number(body.offset);
    const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;
    const rawPage = Number(body.pageSize);
    const pageSize = Number.isFinite(rawPage) && rawPage > 0
      ? Math.min(Math.floor(rawPage), MAX_GUARDIAN_PAGE)
      : GUARDIAN_PAGE;

    // Stage 2 of the rollout: apply exactly one child before going wide.
    const onlyChild = typeof body.onlyChildElationId === "string"
      ? body.onlyChildElationId.trim()
      : "";
    if (onlyChild && !/^\d{6,25}$/.test(onlyChild)) {
      return deny(400, "The single-child filter is not a valid Elation patient id.");
    }
    const scoped = onlyChild ? rows.filter((r) => r.childElationId === onlyChild) : rows;
    if (onlyChild && scoped.length === 0) {
      return deny(400, "That child id does not appear in the pasted CSV.");
    }

    const uniqueChildren = new Set(scoped.map((r) => r.childElationId)).size;
    const page = scoped.slice(offset, offset + pageSize);
    const fnUrl = `${FUNCTIONS_BASE}/${FUNCTION_BY_ACTION.linkGuardians}`;
    const startedAt = Date.now();

    const finish = (data: Record<string, unknown>, httpStatus = 200) =>
      new Response(
        JSON.stringify({
          ok: httpStatus < 300,
          status: httpStatus,
          elapsedMs: Date.now() - startedAt,
          error: null,
          data,
        }),
        { status: httpStatus, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );

    if (!bulkApply) {
      await recordAction(ctx, {
        elationPatientId: null,
        action: "linkGuardians:dry-run",
        reason: reason || null,
        after: {
          totalRows: scoped.length,
          uniqueChildren,
          rejected: rejected.length,
          duplicates,
          onlyChild: onlyChild || null,
        },
        ok: true,
        httpStatus: 200,
      });
      await logPhiAccess(ctx, req, {
        source: "portal.admin",
        resource: FUNCTION_BY_ACTION.linkGuardians,
        scope: "linkGuardians:dry-run",
        resource_id: null,
        http_status: 200,
        row_count: scoped.length,
      });
      return finish({
        apply: false,
        totalRows: scoped.length,
        uniqueChildren,
        duplicates,
        rejected,
        pageSize,
        offset,
        processed: 0,
        nextOffset: null,
        done: true,
        preview: page.slice(0, 20).map((r) => ({
          childElationId: r.childElationId,
          guardianRef: r.guardianElationId
            ? `chart:${r.guardianElationId}`
            : `email:${r.guardianEmail.split("@")[1] ?? "redacted"}`,
          source: r.source,
        })),
      });
    }

    if (page.length === 0) {
      return deny(400, "There is nothing left to apply at that offset.");
    }

    // Attribution BEFORE the first write. Upstream only ever sees
    // `portal-admin`; if this insert fails there is no record of the human, so
    // the page does not run.
    const attributed = await recordActionStrict(ctx, {
      action: "linkGuardians:apply",
      reason,
      after: {
        totalRows: scoped.length,
        uniqueChildren,
        offset,
        pageSize,
        pageChildIds: page.map((r) => r.childElationId),
        onlyChild: onlyChild || null,
        rejected: rejected.length,
      },
    });
    if (!attributed) {
      return new Response(
        JSON.stringify({
          ok: false,
          status: 503,
          error:
            "The attribution record could not be written, so no guardian links were created. Try again.",
        }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let outcomes: LinkOutcome[] = [];
    let processed = 0;
    let fanError: string | null = null;
    try {
      const result = await fanOutGuardianLinks(ctx, fnUrl, page, offset, actor, reason);
      outcomes = result.outcomes;
      processed = result.processed;
    } catch (e) {
      fanError = e instanceof Error ? e.message : String(e);
    }

    const linked = outcomes.filter((o) => o.ok);
    const failed = outcomes.filter((o) => !o.ok);
    const nextOffset = offset + processed;
    const done = !fanError && nextOffset >= scoped.length;

    await recordAction(ctx, {
      elationPatientId: null,
      action: "linkGuardians:apply-result",
      reason,
      after: {
        offset,
        processed,
        linked: linked.length,
        created: linked.filter((o) => o.created).length,
        failed: failed.length,
        nextOffset,
        done,
      },
      ok: !fanError && failed.length === 0,
      httpStatus: fanError ? 502 : 200,
      errorMessage: fanError,
    });

    await logPhiAccess(ctx, req, {
      source: "portal.admin",
      resource: FUNCTION_BY_ACTION.linkGuardians,
      scope: "linkGuardians:apply",
      resource_id: null,
      http_status: fanError ? 502 : 200,
      row_count: processed,
    });

    if (fanError && processed === 0) {
      return new Response(
        JSON.stringify({ ok: false, status: 502, error: fanError }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return finish({
      apply: true,
      totalRows: scoped.length,
      uniqueChildren,
      duplicates,
      rejected,
      pageSize,
      offset,
      processed,
      linked: linked.length,
      created: linked.filter((o) => o.created).length,
      updated: linked.filter((o) => !o.created).length,
      failures: failed.map((o) => ({
        childElationId: o.childElationId,
        guardianRef: o.guardian,
        status: o.status,
        reason: o.reason ?? "UNKNOWN",
      })),
      nextOffset: done ? null : nextOffset,
      done,
      partial: Boolean(fanError),
    });
  }



  const upstreamPayload: Record<string, unknown> = {
    elationPatientId: isBatch ? null : elationPatientId,
    actor,
    reason,
  };
  if (action === "invite") {
    upstreamPayload.reissue = body.reissue === true;
  }
  if (action === "setAccess") {
    upstreamPayload.patch = body.patch ?? {};
  }
  if (action === "provision") {
    upstreamPayload.members = provisionMembers;
    // Creating a roster record is not an invitation. The portal function
    // refuses to send anything; this makes the intent explicit on the wire.
    upstreamPayload.sendInvite = false;
  }
  if (isBulk) {
    // Dry run unless the caller explicitly asked to apply AND cleared the
    // super-admin gate above.
    upstreamPayload.apply = bulkApply;
    // The edge runtime kills a request after 150s idle. A large batch upstream
    // blows past that and the caller sees IDLE_TIMEOUT with no report (work is
    // still done upstream but the cursor is lost). Clamp every bulk batch to a
    // size that comfortably finishes inside the window; the runner is resumable
    // via `cursor`, so paging is the correct way to do volume.
    const MAX_BATCH = 100;
    const limit = Number(body.limit);
    upstreamPayload.limit = Number.isFinite(limit) && limit > 0
      ? Math.min(Math.floor(limit), MAX_BATCH)
      : MAX_BATCH;

    if (typeof body.cursor === "string" && body.cursor) upstreamPayload.cursor = body.cursor;
    if (action === "backfillMinorReports") upstreamPayload.patientIds = minorIds;
  }

  const fnName = FUNCTION_BY_ACTION[action];
  const url = `${FUNCTIONS_BASE}/${fnName}`;
  const started = Date.now();

  // GUARDRAIL 3 — attribution before action. A bulk apply does not happen
  // unless the human is on the record first.
  if (bulkApply) {
    const attributed = await recordActionStrict(ctx, {
      action: `${action}:apply`,
      reason,
      after: {
        limit: upstreamPayload.limit ?? null,
        cursor: upstreamPayload.cursor ?? null,
        patientIds: action === "backfillMinorReports" ? minorIds : undefined,
        patientCount: action === "backfillMinorReports" ? minorIds.length : undefined,
      },
    });
    if (!attributed) {
      return new Response(
        JSON.stringify({
          ok: false,
          status: 503,
          error:
            "The attribution record could not be written, so the migration was not run. Try again.",
        }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  }


  const useWif = wifConfigured();
  let sa: ServiceAccount | null = null;
  try {
    if (!useWif) sa = loadServiceAccount();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await recordAction(ctx, {
      elationPatientId,
      action,
      reason: reason || null,
      ok: false,
      errorMessage: message,
    });
    return new Response(
      JSON.stringify({ ok: false, status: 503, error: message, configured: false }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let status = 0;
  let payload: unknown = null;
  let errorMessage: string | null = null;

  try {
    const now = Math.floor(Date.now() / 1000);
    const cached = tokenCache.get(url);
    let idToken: string;
    if (cached && cached.expiresAt - 60 > now) {
      idToken = cached.token;
    } else if (useWif) {
      idToken = await getIdentityTokenViaWif(url);
      tokenCache.set(url, { token: idToken, expiresAt: now + 3000 });
    } else {
      idToken = await getIdentityToken(sa as ServiceAccount, url);
    }

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${idToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(upstreamPayload),
    });
    status = res.status;
    const text = await res.text();
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text.slice(0, 2000) };
    }
    if (!res.ok) {
      const envelope = payload as { error?: { message?: string; details?: { reason?: string } } };
      errorMessage =
        envelope?.error?.message ??
        envelope?.error?.details?.reason ??
        `Portal function returned ${res.status}`;
    }
  } catch (e) {
    status = 502;
    errorMessage = e instanceof Error ? e.message : String(e);
  }

  const ok = status >= 200 && status < 300;

  if (action === "provision") {
    // One audit row per member, so every created record is individually
    // attributable rather than hidden inside a batch summary.
    const result = payload as
      | { created?: { hintId?: string; elationPatientId?: string }[]; unresolved?: unknown[] }
      | null;
    const createdByHint = new Map<string, { hintId?: string; elationPatientId?: string }>();
    for (const c of result?.created ?? []) {
      if (c?.hintId) createdByHint.set(String(c.hintId), c);
    }
    for (const m of provisionMembers) {
      const created = createdByHint.get(m.hintId);
      await recordAction(ctx, {
        elationPatientId: created?.elationPatientId ?? null,
        action: "provision",
        reason: reason || null,
        before: null,
        after: { hintId: m.hintId, name: `${m.firstName} ${m.lastName}`, created: Boolean(created) },
        ok: ok && Boolean(created),
        httpStatus: status,
        errorMessage: ok && !created ? "Not created — no confident Elation match" : errorMessage,
      });
    }
  } else if (MUTATIONS.includes(action)) {
    const result = payload as { before?: unknown; after?: unknown } | null;
    await recordAction(ctx, {
      elationPatientId,
      action,
      reason: reason || null,
      before: result?.before,
      after: result?.after ?? (action === "setAccess" ? undefined : upstreamPayload.patch),
      ok,
      httpStatus: status,
      errorMessage,
    });
  } else if (ADMIN_ONLY.includes(action)) {
    await recordAction(ctx, {
      elationPatientId: null,
      action,
      reason: reason || null,
      after: payload,
      ok,
      httpStatus: status,
      errorMessage,
    });
  } else if (isBulk) {
    // Outcome row. For an apply this pairs with the pre-call attribution row
    // written above, so an aborted run still leaves the human on the record.
    await recordAction(ctx, {
      elationPatientId: null,
      action: `${action}:${bulkApply ? "apply-result" : "dry-run"}`,
      reason: reason || null,
      after: payload,
      ok,
      httpStatus: status,
      errorMessage,
    });
  }


  await logPhiAccess(ctx, req, {
    source: "portal.admin",
    resource: fnName,
    scope: `${action}${isBulk ? (bulkApply ? ":apply" : ":dry-run") : ""}`,
    resource_id: isBatch ? null : elationPatientId,
    http_status: status,
    row_count: action === "backfillMinorReports"
      ? minorIds.length
      : isBatch
        ? provisionMembers.length
        : null,
  });


  return new Response(
    JSON.stringify({
      ok,
      status,
      elapsedMs: Date.now() - started,
      error: errorMessage,
      data: ok ? payload : null,
    }),
    {
      status: ok ? 200 : status || 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});
