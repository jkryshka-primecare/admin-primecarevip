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
  | "syncEmail"
  | "runAudit"
  | "smoke"
  | "unclaimedGuardians"
  | "backfillUids"
  | "backfillArtifacts"
  | "backfillMinorReports"
  | "linkGuardians"
  | "reset"
  | "sweepStart"
  | "sweepStatus"
  | "sweepReset"
  | "driverStart"
  | "driverStatus"
  | "driverStop"
  | "driverResume"
  | "hydrationSelect"
  | "hydrationStart"
  | "hydrationStatus"
  | "hydrationReset"
  | "lettersBackfill";

const FUNCTION_BY_ACTION: Record<Action, string> = {
  get: "adminGetPortalAccess",
  invite: "adminIssueInvite",
  revoke: "adminRevokeInvite",
  setAccess: "adminSetPortalAccess",
  provision: "adminProvisionPatients",
  // Refresh a member's portal email (roster + login) from their Elation
  // chart. The address is read from the chart upstream, never sent from here.
  syncEmail: "adminSyncMemberEmail",
  runAudit: "adminRunArtifactAudit",
  smoke: "adminRunReadPathSmoke",
  unclaimedGuardians: "adminUnclaimedGuardiansReport",
  backfillUids: "backfillInternalUids",
  backfillArtifacts: "backfillArtifactObjects",
  backfillMinorReports: "backfillElationReports",
  linkGuardians: "adminLinkGuardian",
  // Run-level maintenance on an async report-ingest run: clears a zombie
  // `backfill_runs/{runId}` doc so the same runId can be resumed. It is the
  // authenticated path — a raw gcloud identity token cannot satisfy
  // `requireAdminCaller`, which wants a Firebase super_admin ID token.
  reset: "backfillElationReports",
  // Artifact repair sweep (large-tail drain). Same run-doc/lease/heartbeat
  // durability model as the report ingest, and every artifact fetch goes
  // through the one process-wide Elation gate.
  sweepStart: "adminRunArtifactRepairSweep",
  sweepStatus: "adminRunArtifactRepairSweep",
  sweepReset: "adminRunArtifactRepairSweep",
  // Auto-resume driver (#466). It orchestrates the backfill -> sweep ->
  // coverage-audit sequence unattended; the console arms it, watches it, and
  // stops it. Every unit of work still happens in the functions above.
  driverStart: "adminRunBackfillDriver",
  driverStatus: "adminRunBackfillDriver",
  driverStop: "adminRunBackfillDriver",
  driverResume: "adminRunBackfillDriver",
  // D-317 — slow-chart hydration recovery. `hydrationSelect` is read-only
  // (which members are owed hydration); start/reset drive PHI fetches and
  // write terminal hydration state, so they carry the apply tier.
  hydrationSelect: "hydrationRecoveryDriver",
  hydrationStart: "hydrationRecoveryDriver",
  hydrationStatus: "hydrationRecoveryDriver",
  hydrationReset: "hydrationRecoveryDriver",
  // D-317 — the letters operator surface. Without it the report backfill can
  // only half-hydrate a member.
  lettersBackfill: "backfillElationLettersHttp",
};

const MUTATIONS: Action[] = ["invite", "revoke", "setAccess", "provision", "syncEmail"];

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

/** Artifact-repair sweep control actions (no patient id, run-scoped). */
const SWEEP_ACTIONS: Action[] = ["sweepStart", "sweepStatus", "sweepReset"];

/**
 * Auto-resume driver control. `driverStart` and `driverResume` arm an
 * UNATTENDED PHI migration, so they carry the apply tier (super_admin + written
 * reason + attribution first). `driverStop` is the kill switch: admin is enough
 * to STOP something — never gate a stop behind a higher tier than the start —
 * but it is still attributed. `driverStatus` is a read.
 */
const DRIVER_ACTIONS: Action[] = ["driverStart", "driverStatus", "driverStop", "driverResume"];

/**
 * D-317 hydration recovery. `hydrationSelect` / `hydrationStatus` are reads
 * (admin, no reason, no audit row). `hydrationStart` with `apply:true`,
 * `hydrationReset` and `lettersBackfill` with `apply:true` fetch PHI and write
 * hydration/ingest state, so they carry the apply tier: super_admin resolved
 * server-side, a written reason, and attribution BEFORE the upstream call.
 */
const HYDRATION_ACTIONS: Action[] = [
  "hydrationSelect",
  "hydrationStart",
  "hydrationStatus",
  "hydrationReset",
  "lettersBackfill",
];

/** Actions that act on a set of members rather than a single patient. */
const BATCH_ACTIONS: Action[] = [
  "provision",
  "reset",
  "runAudit",
  "smoke",
  "unclaimedGuardians",
  ...SWEEP_ACTIONS,
  ...DRIVER_ACTIONS,
  ...HYDRATION_ACTIONS,
  ...BULK_MIGRATIONS,
];

/** Upper bound on one report-ingest dry run (synchronous upstream). */
const MAX_MINOR_IDS = 1000;

/**
 * An APPLY is asynchronous upstream: the wrapper claims a `backfill_runs/{runId}`
 * doc, answers 202 immediately, and drains the pending list server-side with a
 * per-id checkpoint. The edge idle timeout is therefore not a constraint, so a
 * full cohort goes up in ONE call and the console polls `statusOnly` for
 * progress. The upstream wrapper's own cap is 1000 ids.
 */
const MAX_MINOR_IDS_APPLY = 1000;



/**
 * Elation chart ids for the minor-track ingest. Shape-validated here and
 * re-validated against the real `dependent.isMinor` set inside the
 * `backfillElationReports` HTTP wrapper — that wrapper is the authority; this
 * list is a convenience and a fast failure.
 */
function parseMinorIds(raw: unknown, apply = false): string[] | string {
  if (!Array.isArray(raw) || raw.length === 0) {
    return "Provide at least one minor Elation patient id.";
  }
  const cap = apply ? MAX_MINOR_IDS_APPLY : MAX_MINOR_IDS;
  if (raw.length > cap) {
    return `Ingest at most ${cap} patients at a time (received ${raw.length}).`;
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
function splitCsvLine(line: string, delim = ","): string[] {
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
    else if (c === delim) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

// Sheets/Excel pastes arrive tab-delimited; some exports use ; or |.
function detectDelimiter(headerLine: string): string {
  const candidates = [",", "\t", ";", "|"];
  let best = ",";
  let bestCount = 0;
  for (const d of candidates) {
    const n = splitCsvLine(headerLine, d).length;
    if (n > bestCount) {
      bestCount = n;
      best = d;
    }
  }
  return best;
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

  // Normalize headers: strip BOM/quotes, lowercase, spaces/dashes -> underscore.
  const delim = detectDelimiter(lines[0]);
  const header = splitCsvLine(lines[0], delim).map((h) =>
    h.replace(/^\uFEFF/, "").replace(/^"|"$/g, "").trim().toLowerCase().replace(/[\s-]+/g, "_")
  );
  // Accept the common export spellings for each logical column.
  const ALIASES: Record<string, string[]> = {
    minor_elation_id: [
      "minor_elation_id", "child_elation_id", "minor_id", "child_id",
      "patient_elation_id", "elation_id", "minor_chart_id", "child_chart_id",
    ],
    guardian_email: ["guardian_email", "guardian_email_address", "parent_email", "email", "email_on_file"],
    match_source: ["match_source", "source", "match_type", "link_source"],
    guardian_elation_id: ["guardian_elation_id", "guardian_chart_id", "parent_elation_id"],
    guardian_hint_id: ["guardian_hint_id", "hint_id", "guardian_hint_patient_id"],
    guardian_name: ["guardian_name", "parent_name", "guardian_full_name"],
  };
  const col = (name: string) => {
    for (const alias of ALIASES[name] ?? [name]) {
      const i = header.indexOf(alias);
      if (i > -1) return i;
    }
    return -1;
  };
  const required = ["minor_elation_id", "guardian_email", "match_source"];
  const missing = required.filter((h) => col(h) === -1);
  if (missing.length) {
    return `The CSV is missing required column(s): ${missing.join(", ")}. Found: ${header.join(", ")}.`;
  }
  if (lines.length - 1 > MAX_GUARDIAN_ROWS) {
    return `At most ${MAX_GUARDIAN_ROWS} rows at a time (received ${lines.length - 1}).`;
  }
  const at = (cells: string[], name: string) => {
    const i = col(name);
    return i > -1 ? (cells[i] ?? "").replace(/^"|"$/g, "").trim() : "";
  };


  const rows: GuardianRow[] = [];
  const rejected: GuardianRejection[] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitCsvLine(lines[i], delim);
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


/** Call one upstream portal Cloud Function with the service identity. */
async function callUpstream(
  fn: string,
  payload: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const url = `${FUNCTIONS_BASE}/${fn}`;
  const now = Math.floor(Date.now() / 1000);
  const cached = tokenCache.get(url);
  let idToken: string;
  if (cached && cached.expiresAt - 60 > now) idToken = cached.token;
  else if (wifConfigured()) {
    idToken = await getIdentityTokenViaWif(url);
    tokenCache.set(url, { token: idToken, expiresAt: now + 3000 });
  } else idToken = await getIdentityToken(loadServiceAccount(), url);
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body: Record<string, unknown> | null = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text.slice(0, 500) }; }
  return { status: res.status, body };
}

function upstreamError(body: Record<string, unknown> | null): string {
  const e = body?.error as { message?: string; details?: { reason?: string } } | string | undefined;
  if (typeof e === "string") return e;
  return e?.message ?? e?.details?.reason ?? "";
}

const ELATION_REST = "https://app.elationemr.com/api/2.0";
let elationTokenCache: { token: string; expiresAt: number } | null = null;

async function elationGetPatient(id: string): Promise<Record<string, unknown> | null> {
  if (!elationTokenCache || elationTokenCache.expiresAt < Date.now() + 60_000) {
    const form = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: Deno.env.get("ELATION_CLIENT_ID") ?? "",
      client_secret: Deno.env.get("ELATION_CLIENT_SECRET") ?? "",
    });
    const t = await fetch(`${ELATION_REST}/oauth2/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: form.toString(),
    });
    if (!t.ok) throw new Error("Elation sign-in failed");
    const j = await t.json() as { access_token: string; expires_in?: number };
    elationTokenCache = { token: j.access_token, expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000 };
  }
  const r = await fetch(`${ELATION_REST}/patients/${encodeURIComponent(id)}/`, {
    headers: { Authorization: `Bearer ${elationTokenCache.token}`, Accept: "application/json" },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Elation returned ${r.status}`);
  return await r.json() as Record<string, unknown>;
}

async function hintPatientsByLastName(lastName: string): Promise<Record<string, unknown>[]> {
  const key = Deno.env.get("HINT_PRACTICE_API_KEY")?.trim();
  if (!key) throw new Error("Hint key missing");
  const out: Record<string, unknown>[] = [];
  for (let offset = 0; offset < 500; offset += 100) {
    const u = new URL("https://api.hint.com/api/provider/patients");
    u.searchParams.set("last_name", lastName);
    u.searchParams.set("limit", "100");
    u.searchParams.set("offset", String(offset));
    const r = await fetch(u, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } });
    if (!r.ok) throw new Error(`Hint returned ${r.status}`);
    const page = await r.json() as Record<string, unknown>[];
    if (!Array.isArray(page)) break;
    out.push(...page);
    if (page.length < 100) break;
  }
  return out;
}

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();

function elationEmail(p: Record<string, unknown>): string {
  if (p.email) return norm(p.email);
  const list = Array.isArray(p.emails) ? p.emails as { email?: string; deleted_date?: string | null }[] : [];
  const live = list.filter((e) => e?.email && !e.deleted_date);
  return live.length ? norm(live[live.length - 1].email) : "";
}

type CareMatch =
  | { ok: true; hint: Record<string, unknown>; chart: Record<string, unknown>; email: string; candidates: number; tieBreakUsed: boolean }
  | { ok: false; code: string; message: string; needsTieBreak?: boolean; candidates?: number };

/**
 * Chart → membership match for the care team. Name + DOB only; email is used
 * solely as a tie-breaker among name+DOB matches and must equal the chart email.
 */
async function careMatch(elationPatientId: string, tieBreakEmail: string): Promise<CareMatch> {
  const chart = await elationGetPatient(elationPatientId);
  if (!chart) return { ok: false, code: "NO_CHART", message: "We couldn't find this chart in Elation." };
  const first = norm(chart.first_name), last = norm(chart.last_name), dob = String(chart.dob ?? "");
  if (!first || !last || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
    return { ok: false, code: "CHART_INCOMPLETE", message: "This chart is missing a name or date of birth. Please update the chart or ask an administrator." };
  }
  const chartEmail = elationEmail(chart);
  if (!chartEmail) {
    return { ok: false, code: "NO_CHART_EMAIL", message: "There's no email on this chart. Add the member's email to the chart first, then try again." };
  }
  const all = await hintPatientsByLastName(String(chart.last_name));
  const nameDob = all.filter((h) => norm(h.first_name) === first && norm(h.last_name) === last && String(h.dob ?? "") === dob);
  const active = nameDob.filter((h) => norm(h.membership_status) === "active");
  if (active.length === 0) {
    return { ok: false, code: nameDob.length ? "NOT_ACTIVE" : "NO_MEMBER", message: nameDob.length
      ? "This member's membership isn't active, so portal access can't be set up. Please ask an administrator."
      : "We couldn't find a membership with this name and date of birth. Please ask an administrator." };
  }
  if (active.length === 1) {
    return { ok: true, hint: active[0], chart, email: chartEmail, candidates: 1, tieBreakUsed: false };
  }
  const tb = norm(tieBreakEmail);
  if (!tb) {
    return { ok: false, code: "NEEDS_TIE_BREAK", needsTieBreak: true, candidates: active.length,
      message: "More than one member has this name and date of birth. Enter the member's email to confirm which one." };
  }
  const hits = active.filter((h) => norm(h.email) === tb);
  if (tb !== chartEmail || hits.length !== 1) {
    return { ok: false, code: "TIE_BREAK_FAILED", candidates: active.length,
      message: "We couldn't confirm which member this is — please ask an administrator." };
  }
  return { ok: true, hint: hits[0], chart, email: chartEmail, candidates: active.length, tieBreakUsed: true };
}

/**
 * Care-team gate: true only when the member has NEVER had working portal
 * access (no claim, never signed in). Reads the live portal record upstream.
 * Fails closed: any error means "not safe", so only an admin may proceed.
 */
async function memberNeverHadAccess(elationPatientId: string, actor: string): Promise<boolean> {
  try {
    const url = `${FUNCTIONS_BASE}/${FUNCTION_BY_ACTION.get}`;
    const now = Math.floor(Date.now() / 1000);
    const cached = tokenCache.get(url);
    let idToken: string;
    if (cached && cached.expiresAt - 60 > now) idToken = cached.token;
    else if (wifConfigured()) {
      idToken = await getIdentityTokenViaWif(url);
      tokenCache.set(url, { token: idToken, expiresAt: now + 3000 });
    } else idToken = await getIdentityToken(loadServiceAccount(), url);
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ elationPatientId, actor, reason: "care-team invite eligibility check" }),
    });
    const text = await res.text();
    if (!res.ok) return false;
    const p = JSON.parse(text) as Record<string, unknown>;
    const d = ((p.data ?? p.result ?? p) as Record<string, unknown>) ?? {};
    const claim = (d.claim ?? null) as Record<string, unknown> | null;
    if (!claim) return false;
    if (claim.state === "claimed") return false;
    if (claim.claimedAt) return false;
    if (claim.webAccessVerifiedAt) return false;
    return true;
  } catch {
    return false;
  }
}

const CARE_TEAM_ROLES = ["super_admin", "admin", "clinical", "pharmacy"];

/** Care-team tier: may send standard invites and refresh email from chart. */
async function isCareTeam(ctx: AuthContext): Promise<boolean> {
  const { data, error } = await ctx.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", ctx.user.id)
    .in("role", CARE_TEAM_ROLES)
    .limit(1);
  if (error) return false;
  return (data ?? []).length > 0;
}

const INVITE_MEMBER_WINDOW_MIN = 10;
const INVITE_ACTOR_WINDOW_MIN = 60;
const INVITE_ACTOR_MAX = 5;

/** Returns a friendly message when an invite must be refused, else null. Fails closed. */
async function inviteRateLimit(ctx: AuthContext, elationPatientId: string): Promise<string | null> {
  const memberSince = new Date(Date.now() - INVITE_MEMBER_WINDOW_MIN * 60_000).toISOString();
  const actorSince = new Date(Date.now() - INVITE_ACTOR_WINDOW_MIN * 60_000).toISOString();
  const [member, actor] = await Promise.all([
    ctx.supabase.from("portal_admin_actions").select("id", { count: "exact", head: true })
      .eq("action", "invite").eq("elation_patient_id", elationPatientId).gte("created_at", memberSince),
    ctx.supabase.from("portal_admin_actions").select("id", { count: "exact", head: true })
      .eq("action", "invite").eq("actor_user_id", ctx.user.id).gte("created_at", actorSince),
  ]);
  if (member.error || actor.error) {
    return "Couldn't confirm it's safe to send right now. Please try again in a minute.";
  }
  if ((member.count ?? 0) > 0) {
    return `An invite was sent to this member in the last ${INVITE_MEMBER_WINDOW_MIN} minutes. Each new invite cancels the previous link, so please wait before sending another.`;
  }
  if ((actor.count ?? 0) >= INVITE_ACTOR_MAX) {
    return `You've sent ${INVITE_ACTOR_MAX} invites in the last hour. Please wait a bit or ask an administrator.`;
  }
  return null;
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

  const rawAction = String(body.action ?? "");

  /**
   * Care-team help history for one member: who sent invites / changed the
   * portal email, when, and why. Local read of our own audit table only —
   * never forwarded upstream. Care-team tier.
   */
  if (rawAction === "careProvision") {
    const json = (b: unknown) => new Response(JSON.stringify(b), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
    const pid = String(body.elationPatientId ?? "").trim();
    if (!/^\d{6,25}$/.test(pid)) return deny(400, "A valid patient id is required.");
    if (!(await isCareTeam(ctx))) return deny(403, "Only the care team can set up portal access.");
    const dryRun = body.dryRun !== false;
    const reasonText = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    if (!dryRun && !reasonText) return deny(400, "A reason is required.");
    const actorId = ctx.user.email ?? ctx.user.id;
    const tieBreak = typeof body.tieBreakEmail === "string" ? body.tieBreakEmail.slice(0, 320) : "";

    try {
      // 1. Must have NO portal record at all.
      const existing = await callUpstream(FUNCTION_BY_ACTION.get, {
        elationPatientId: pid, actor: actorId, reason: "care-team setup eligibility check",
      });
      const existingErr = upstreamError(existing.body);
      if (!(existing.status === 404 && existingErr.includes("NO_ROSTER_DOC"))) {
        return json({ ok: false, status: 409, code: "HAS_RECORD",
          error: existing.status >= 200 && existing.status < 300
            ? "This member already has a portal account. Use the invite button instead."
            : "We couldn't confirm this member's portal status. Please try again or ask an administrator." });
      }

      // 2–4. Chart → membership match.
      const m = await careMatch(pid, tieBreak);
      if (!m.ok) {
        if (!dryRun) {
          await recordAction(ctx, { elationPatientId: pid, action: "careProvision", reason: reasonText || null,
            after: { code: m.code, candidates: m.candidates ?? null, tieBreakAttempted: Boolean(tieBreak) }, ok: false,
            errorMessage: m.code });
        }
        return json({ ok: false, status: 422, code: m.code, needsTieBreak: m.needsTieBreak ?? false, error: m.message });
      }

      const preview = {
        name: `${m.chart.first_name} ${m.chart.last_name}`,
        dob: m.chart.dob,
        email: m.email,
        candidates: m.candidates,
        tieBreakUsed: m.tieBreakUsed,
      };
      if (dryRun) return json({ ok: true, status: 200, data: { preview } });

      // 6. Invite pacing before any write.
      const limited = await inviteRateLimit(ctx, pid);
      if (limited) return json({ ok: false, status: 429, error: limited });

      // 5. Provision (no invite) keyed to this chart id, then invite.
      const member = {
        hintId: String(m.hint.id),
        firstName: String(m.chart.first_name),
        lastName: String(m.chart.last_name),
        email: m.email,
        dob: String(m.chart.dob),
        phone: null,
        elationPatientId: pid,
      };
      const prov = await callUpstream(FUNCTION_BY_ACTION.provision, {
        elationPatientId: null, actor: actorId, reason: reasonText, members: [member], sendInvite: false,
      });
      const provBody = (prov.body?.data ?? prov.body?.result ?? prov.body) as Record<string, unknown> | null;
      const created = Array.isArray(provBody?.created) && (provBody!.created as unknown[]).length === 1;
      await recordAction(ctx, { elationPatientId: pid, action: "careProvision", reason: reasonText,
        after: { hintId: member.hintId, candidates: m.candidates, tieBreakUsed: m.tieBreakUsed, created }, ok: created,
        httpStatus: prov.status, errorMessage: created ? null : (upstreamError(prov.body) || "NOT_CREATED") });
      if (!created) {
        return json({ ok: false, status: 502, error: "The portal account couldn't be created. Please ask an administrator." });
      }

      const inv = await callUpstream(FUNCTION_BY_ACTION.invite, {
        elationPatientId: pid, actor: actorId, reason: reasonText, reissue: false, resetClaim: false,
      });
      const invOk = inv.status >= 200 && inv.status < 300;
      await recordAction(ctx, { elationPatientId: pid, action: "invite", reason: reasonText,
        after: { source: "careProvision" }, ok: invOk, httpStatus: inv.status,
        errorMessage: invOk ? null : upstreamError(inv.body) || `HTTP ${inv.status}` });
      await logPhiAccess(ctx, req, { source: "portal.admin", resource: "careProvision", scope: "careProvision",
        resource_id: pid, http_status: invOk ? 200 : inv.status, row_count: 1 });
      if (!invOk) {
        return json({ ok: false, status: 502,
          error: "The portal account was created, but the invite email didn't go out. Please ask an administrator." });
      }
      return json({ ok: true, status: 200, data: { preview, created: true, invited: true } });
    } catch (e) {
      return json({ ok: false, status: 502, error: "Something went wrong looking up this member. Please try again or ask an administrator.",
        detail: e instanceof Error ? e.message.slice(0, 200) : undefined });
    }
  }

  if (rawAction === "history") {
    const pid = String(body.elationPatientId ?? "").trim();
    if (!pid) return deny(400, "elationPatientId is required");
    if (!(await isCareTeam(ctx))) {
      return deny(403, "Only the care team can view portal help history.");
    }
    const { data, error } = await ctx.supabase
      .from("portal_admin_actions")
      .select("id, created_at, action, reason, ok, error_message, actor_email, after_state")
      .eq("elation_patient_id", pid)
      .in("action", ["invite", "syncEmail", "revoke", "setAccess", "careProvision"])
      .order("created_at", { ascending: false })
      .limit(25);
    if (error) return deny(500, "Could not load portal history.");
    // syncEmail previews are not changes; hide them from the timeline.
    const rows = (data ?? []).filter((r) => {
      const a = r.after_state as Record<string, unknown> | null;
      return !(r.action === "syncEmail" && a && a.dryRun === true);
    }).map(({ after_state: _a, ...r }) => r);
    return new Response(JSON.stringify({ ok: true, status: 200, data: rows }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const action = rawAction as Action;
  if (!FUNCTION_BY_ACTION[action]) {
    return deny(400, `Unknown action "${action}"`);
  }

  const isBatch = BATCH_ACTIONS.includes(action);
  const elationPatientId = String(body.elationPatientId ?? "").trim();
  if (!isBatch && !elationPatientId) return deny(400, "elationPatientId is required");

  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";

  if (MUTATIONS.includes(action)) {
    // Care team (clinical/pharmacy) may send a normal invite and refresh the
    // portal email from the chart. A claim reset and everything else stays
    // admin-only.
    const careTeamAllowed =
      (action === "invite" && body.resetClaim !== true) || action === "syncEmail";
    const allowed = careTeamAllowed ? await isCareTeam(ctx) : await isAdmin(ctx);
    if (!allowed) {
      return deny(403, "Only administrators can change a member's portal access.");
    }
    if (!reason) {
      return deny(400, "A reason is required for this change.");
    }
  }

  // Care team (non-admin) may only invite members who have never had access.
  if (action === "invite" && !(await isAdmin(ctx))) {
    const eligible = await memberNeverHadAccess(elationPatientId, ctx.user.email ?? ctx.user.id);
    if (!eligible) {
      return new Response(JSON.stringify({
        ok: false, status: 403,
        error: "This member already has (or has had) portal access, or their record couldn't be confirmed. Please ask an administrator.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  }

  // Invite pacing — protects members from repeated sends that each void the
  // previous link. Counted on attempts (a failed send still mints).
  if (action === "invite") {
    const limited = await inviteRateLimit(ctx, elationPatientId);
    if (limited) {
      return new Response(JSON.stringify({ ok: false, status: 429, error: limited }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  if (ADMIN_ONLY.includes(action) && !(await isAdmin(ctx))) {
    return deny(403, "Only administrators can run coverage and read-path checks.");
  }

  const isBulk = BULK_MIGRATIONS.includes(action);

  /**
   * Progress poll for an async report-ingest run. It writes nothing and reads
   * no PHI — only the run doc's counters — so it needs admin (like a dry run),
   * never super-admin, and it carries no reason.
   */
  const RUN_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
  const statusPoll = action === "backfillMinorReports" && body.statusOnly === true;
  const runId = typeof body.runId === "string" ? body.runId.trim() : "";
  if (statusPoll && !RUN_ID_RE.test(runId)) {
    return deny(400, "A valid runId is required to check run progress.");
  }
  if (!statusPoll && runId && !RUN_ID_RE.test(runId)) {
    return deny(400, "That runId is not valid.");
  }

  /**
   * Run reset. It touches no PHI and ingests nothing — it only clears the
   * lease/status on a run doc so the run can be resumed — but it is a
   * write to migration state, so it carries the same tier as an apply:
   * super_admin resolved server-side, plus a written reason, plus an
   * attribution row before the upstream call.
   */
  const isReset = action === "reset";
  if (isReset) {
    if (!(await isSuperAdmin(ctx))) {
      return deny(403, "Only a super administrator can reset a migration run.");
    }
    if (!reason) {
      return deny(400, "A written reason is required to reset a run.");
    }
    if (!RUN_ID_RE.test(runId)) {
      return deny(400, "A valid runId is required to reset a run.");
    }
  }

  /**
   * Artifact-repair sweep control.
   *   - `sweepStatus` reads run counters only: admin, no reason, no audit row.
   *   - `sweepStart` (start OR resume) and `sweepReset` write migration state
   *     and drive PHI fetches, so they carry the apply tier: super_admin
   *     resolved server-side, a written reason, and attribution first.
   */
  const isSweep = SWEEP_ACTIONS.includes(action);
  const sweepStatusOnly = action === "sweepStatus";
  let sweepMaxItems = 0;
  if (isSweep) {
    if (!(await isAdmin(ctx))) {
      return deny(403, "Only administrators can drive the artifact repair sweep.");
    }
    if (sweepStatusOnly) {
      if (!RUN_ID_RE.test(runId)) {
        return deny(400, "A valid runId is required to check sweep progress.");
      }
    } else {
      if (!(await isSuperAdmin(ctx))) {
        return deny(403, "Only a super administrator can run or reset the artifact repair sweep.");
      }
      if (!reason) {
        return deny(400, "A written reason is required for this sweep action.");
      }
      if (action === "sweepReset" && !RUN_ID_RE.test(runId)) {
        return deny(400, "A valid runId is required to reset a sweep run.");
      }
      // A start may omit runId (upstream mints one); a resume supplies it.
      if (action === "sweepStart" && runId && !RUN_ID_RE.test(runId)) {
        return deny(400, "That runId is not valid.");
      }
      const raw = Number(body.maxItems);
      sweepMaxItems = Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 5000) : 0;
    }
  }

  /**
   * Auto-resume driver control (#466).
   *   - `driverStatus` is a read: admin, no reason, no audit row.
   *   - `driverStart` / `driverResume` arm an UNATTENDED PHI migration, so they
   *     carry the apply tier: super_admin resolved server-side from the verified
   *     session, a written reason, and attribution BEFORE the upstream call.
   *   - `driverStop` is the kill switch. Stopping is admin-level on purpose —
   *     a stop must never be harder to reach than a start — and is attributed.
   */
  const isDriver = DRIVER_ACTIONS.includes(action);
  const driverStatusOnly = action === "driverStatus";
  let driverIds: string[] = [];
  if (isDriver) {
    if (!(await isAdmin(ctx))) {
      return deny(403, "Only administrators can view or control the auto-resume driver.");
    }
    if (!driverStatusOnly) {
      if (!reason) {
        return deny(400, "A written reason is required for this driver action.");
      }
      if (action !== "driverStop" && !(await isSuperAdmin(ctx))) {
        return deny(403, "Only a super administrator can arm the auto-resume driver.");
      }
      if (action === "driverStart") {
        if (!RUN_ID_RE.test(String(body.backfillRunId ?? ""))) {
          return deny(400, "A valid backfill runId is required to arm the driver.");
        }
        const raw = Array.isArray(body.patientIds) ? body.patientIds : [];
        if (raw.length === 0) return deny(400, "The driver needs the cohort's patient ids.");
        if (raw.length > MAX_MINOR_IDS_APPLY) return deny(400, "That cohort is too large.");
        const seen = new Set<string>();
        for (const item of raw) {
          const id = String(item ?? "").trim();
          if (!/^\d{6,25}$/.test(id)) return deny(400, "One of those patient ids is not valid.");
          if (!seen.has(id)) { seen.add(id); driverIds.push(id); }
        }
      }
    }
  }



  /**
   * D-317 hydration recovery control.
   *   - `hydrationSelect` / `hydrationStatus` read only: admin, no reason.
   *   - `hydrationStart` (apply), `hydrationReset` and `lettersBackfill`
   *     (apply) fetch PHI and write hydration state: super_admin + reason +
   *     attribution first. A dry run needs admin, like any other check.
   */
  const isHydration = HYDRATION_ACTIONS.includes(action);
  const hydrationReadOnly = action === "hydrationSelect" || action === "hydrationStatus";
  const hydrationApply =
    (action === "hydrationStart" || action === "lettersBackfill") && body.apply === true;
  let hydrationIds: string[] = [];
  if (isHydration) {
    if (!(await isAdmin(ctx))) {
      return deny(403, "Only administrators can view or drive hydration recovery.");
    }
    if (!hydrationReadOnly) {
      if (hydrationApply || action === "hydrationReset") {
        if (!(await isSuperAdmin(ctx))) {
          return deny(403, "Only a super administrator can run hydration recovery.");
        }
        if (!reason) {
          return deny(400, "A written reason is required for this hydration action.");
        }
      }
      if (action === "hydrationReset" && !RUN_ID_RE.test(runId)) {
        return deny(400, "A valid runId is required to reset a hydration run.");
      }
      const raw = Array.isArray(body.patientIds) ? body.patientIds : [];
      if (raw.length > 500) return deny(400, "That cohort is too large.");
      const seen = new Set<string>();
      for (const item of raw) {
        const id = String(item ?? "").trim();
        if (!/^\d{6,25}$/.test(id)) return deny(400, "One of those patient ids is not valid.");
        if (!seen.has(id)) { seen.add(id); hydrationIds.push(id); }
      }
      if (action === "lettersBackfill" && hydrationIds.length === 0) {
        return deny(400, "The letters backfill needs at least one patient id.");
      }
      if (action === "hydrationStart" && hydrationIds.length === 0 && body.fromSelection !== true) {
        return deny(400, "Supply patient ids, or set fromSelection to use the proposed cohort.");
      }
    }
  }

  const bulkApply = isBulk && !statusPoll && body.apply === true;
  let minorIds: string[] = [];
  // Report-ingest cohort switch. The Cloud Function wrapper is the authority
  // (it re-validates every id against isMinorRecord / the soft-adult rule);
  // this only forwards the operator's choice. Default stays 'minors'.
  const cohort = body.cohort === "adults" ? "adults" : "minors";

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
    if (action === "backfillMinorReports" && !statusPoll) {
      const parsed = parseMinorIds(body.patientIds, bulkApply);
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
    // Recovery for a claimed-but-unusable account: clears the Firebase Auth
    // user + claim marker upstream, then sends a fresh claim link. Same admin
    // tier and audit row as any other invite mutation.
    upstreamPayload.resetClaim = body.resetClaim === true;
  }

  if (action === "syncEmail") {
    // Preview by default; only an explicit dryRun:false writes.
    upstreamPayload.dryRun = body.dryRun !== false;
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
  if (action === "smoke") {
    // Optional guardian-arm fixtures, supplied at invoke time so minors' ids
    // never have to live in a durable prod .env. Forwarded verbatim as opaque
    // strings; the Cloud Function re-validates them in `resolveFixtures` and
    // falls back to its own SMOKE_* env vars when a field is absent.
    const FIXTURE_RE = /^[A-Za-z0-9_.:@-]{1,128}$/;
    for (const key of ["guardianUid", "guardianElationId", "childPatientId", "otherChildId"]) {
      const raw = body[key];
      if (typeof raw !== "string") continue;
      const val = raw.trim();
      if (!val) continue;
      if (!FIXTURE_RE.test(val)) return deny(400, `"${key}" is not a valid smoke fixture id.`);
      upstreamPayload[key] = val;
    }
  }

  if (isBulk && !statusPoll) {
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
    if (action === "backfillMinorReports") {
      upstreamPayload.patientIds = minorIds;
      upstreamPayload.cohort = cohort;
      if (typeof body.storeMedicalRecords === "boolean") {
        upstreamPayload.storeMedicalRecords = body.storeMedicalRecords;
      }
      if (body.skipExisting === true) upstreamPayload.skipExisting = true;
      // Resume: re-POSTing the same runId continues the run's pending list
      // instead of starting a second job over the same cohort.
      if (bulkApply && runId) upstreamPayload.runId = runId;
    }
  }

  if (isReset) {
    // Reset-only wire shape — the wrapper branches on `action: 'reset'`.
    for (const k of Object.keys(upstreamPayload)) delete upstreamPayload[k];
    upstreamPayload.action = "reset";
    upstreamPayload.runId = runId;
    upstreamPayload.reason = reason;
    upstreamPayload.actor = actor;
    // `force` reclaims a run whose lease has NOT yet expired. Off by default:
    // without it the wrapper refuses to touch a run a live instance still owns.
    if (body.force === true) upstreamPayload.force = true;
  }

  if (statusPoll) {
    // Poll-only wire shape — the wrapper branches on `action: 'status'` before
    // it looks at anything else.
    for (const k of Object.keys(upstreamPayload)) delete upstreamPayload[k];
    upstreamPayload.action = "status";
    upstreamPayload.runId = runId;
    upstreamPayload.actor = actor;
  }

  if (isSweep) {
    // Sweep wire shape. The Cloud Function takes exactly one of
    // start | status | reset; nothing else on the payload is read.
    for (const k of Object.keys(upstreamPayload)) delete upstreamPayload[k];
    upstreamPayload.action = action === "sweepStart"
      ? "start"
      : action === "sweepReset"
        ? "reset"
        : "status";
    upstreamPayload.actor = actor;
    if (runId) upstreamPayload.runId = runId;
    if (!sweepStatusOnly) upstreamPayload.reason = reason;
    if (action === "sweepStart" && sweepMaxItems) upstreamPayload.maxItems = sweepMaxItems;
    if (action === "sweepReset") {
      if (body.force === true) upstreamPayload.force = true;
      // The global circuit breaker is separate from the run doc: clearing it
      // is always an explicit operator choice, never implied by a reset.
      if (body.clearGlobalPause === true) upstreamPayload.clearGlobalPause = true;
    }
  }

  if (isDriver) {
    // Driver wire shape. The Cloud Function takes exactly one of
    // start | status | stop | resume; nothing else on the payload is read.
    for (const k of Object.keys(upstreamPayload)) delete upstreamPayload[k];
    upstreamPayload.action = action === "driverStart"
      ? "start"
      : action === "driverStop"
        ? "stop"
        : action === "driverResume"
          ? "resume"
          : "status";
    upstreamPayload.actor = actor;
    if (typeof body.driverId === "string" && /^[a-z0-9_-]{3,40}$/.test(body.driverId)) {
      upstreamPayload.driverId = body.driverId;
    }
    if (!driverStatusOnly) upstreamPayload.reason = reason;
    if (action === "driverStart") {
      upstreamPayload.backfillRunId = String(body.backfillRunId);
      upstreamPayload.patientIds = driverIds;
      upstreamPayload.cohort = cohort;
      if (body.options && typeof body.options === "object") upstreamPayload.options = body.options;
      if (Number(body.maxCycles) > 0) upstreamPayload.maxCycles = Number(body.maxCycles);
      if (Number(body.failedRateThreshold) > 0) {
        upstreamPayload.failedRateThreshold = Number(body.failedRateThreshold);
      }
      if (Number(body.noProgressLimit) > 0) {
        upstreamPayload.noProgressLimit = Number(body.noProgressLimit);
      }
      if (body.autoAudit === false) upstreamPayload.autoAudit = false;
    }
  }




  if (isHydration) {
    // Hydration wire shape. The Cloud Function takes exactly one of
    // select | start | status | reset (or the flat letters-backfill body).
    for (const k of Object.keys(upstreamPayload)) delete upstreamPayload[k];
    upstreamPayload.actor = actor;
    if (action === "lettersBackfill") {
      upstreamPayload.patientIds = hydrationIds;
      upstreamPayload.cap = Math.max(1, Math.min(50, Number(body.cap) || hydrationIds.length));
      if (body.apply === true) {
        upstreamPayload.apply = true;
        upstreamPayload.reason = reason;
      }
    } else {
      upstreamPayload.action = action === "hydrationStart"
        ? "start"
        : action === "hydrationReset"
          ? "reset"
          : action === "hydrationSelect"
            ? "select"
            : "status";
      if (runId) upstreamPayload.runId = runId;
      if (!hydrationReadOnly) upstreamPayload.reason = reason;
      if (action === "hydrationStart") {
        upstreamPayload.cap = Math.max(1, Math.min(100, Number(body.cap) || 1));
        if (hydrationIds.length) upstreamPayload.patientIds = hydrationIds;
        if (body.fromSelection === true) upstreamPayload.fromSelection = true;
        if (body.apply === true) upstreamPayload.apply = true;
      }
      // D-317: `force` re-admits a member the driver's gate would otherwise
      // reject as terminal (`failed` / `complete`). Operator-only and
      // deliberate: the apply tier above already required super_admin + a
      // written reason, and the driver re-applies its own gate per patient.
      if (
        (action === "hydrationReset" || action === "hydrationStart")
        && body.force === true
      ) upstreamPayload.force = true;
      if (action === "hydrationSelect" && Number(body.limit) > 0) {
        upstreamPayload.limit = Math.min(1000, Number(body.limit));
      }
    }
  }




  const fnName = FUNCTION_BY_ACTION[action];
  const url = `${FUNCTIONS_BASE}/${fnName}`;
  const started = Date.now();

  // GUARDRAIL 3 — attribution before action. A bulk apply does not happen
  // unless the human is on the record first. The sweep's start/reset are
  // writes that drive PHI fetches, so they sit in the same gate; a status
  // poll does not.
  const sweepWrite = isSweep && !sweepStatusOnly;
  const driverWrite = isDriver && !driverStatusOnly;
  const hydrationWrite = hydrationApply || action === "hydrationReset";
  if (bulkApply || isReset || sweepWrite || driverWrite || hydrationWrite) {
    const attributed = await recordActionStrict(ctx, {
      action: isReset
        ? "backfillRun:reset"
        : sweepWrite
          ? `artifactSweep:${action === "sweepStart" ? "start" : "reset"}`
          : driverWrite
            ? `autoResumeDriver:${action.replace("driver", "").toLowerCase()}`
            : hydrationWrite
              ? `hydrationRecovery:${action === "hydrationReset" ? "reset" : action === "lettersBackfill" ? "letters" : "start"}`
              : `${action}:apply`,
      reason,
      after: {
        limit: upstreamPayload.limit ?? null,
        cursor: upstreamPayload.cursor ?? null,
        runId: upstreamPayload.runId ?? null,
        force: isReset || sweepWrite ? body.force === true : undefined,
        maxItems: sweepWrite ? (sweepMaxItems || null) : undefined,
        clearGlobalPause: action === "sweepReset" ? body.clearGlobalPause === true : undefined,
        driverPatientCount: action === "driverStart" ? driverIds.length : undefined,
        backfillRunId: action === "driverStart" ? String(body.backfillRunId) : undefined,
        patientIds: action === "backfillMinorReports" ? minorIds : undefined,
        patientCount: action === "backfillMinorReports" ? minorIds.length : undefined,
        cohort: action === "backfillMinorReports" ? cohort : undefined,
        hydrationPatientCount: hydrationWrite ? hydrationIds.length : undefined,
        hydrationFromSelection: action === "hydrationStart" ? body.fromSelection === true : undefined,
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
  } else if (isReset) {
    await recordAction(ctx, {
      elationPatientId: null,
      action: "backfillRun:reset-result",
      reason,
      after: payload,
      ok,
      httpStatus: status,
      errorMessage,
    });
  } else if (sweepWrite) {
    await recordAction(ctx, {
      elationPatientId: null,
      action: `artifactSweep:${action === "sweepStart" ? "start" : "reset"}-result`,
      reason,
      after: payload,
      ok,
      httpStatus: status,
      errorMessage,
    });
  } else if (driverWrite) {
    await recordAction(ctx, {
      elationPatientId: null,
      action: `autoResumeDriver:${action.replace("driver", "").toLowerCase()}-result`,
      reason,
      after: payload,
      ok,
      httpStatus: status,
      errorMessage,
    });
  } else if (isSweep || isDriver) {
    // Status poll: counters only, not audited per call.
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
  } else if (isBulk && statusPoll) {
    // A progress poll reads counters only. It is not audited per call —
    // polling every few seconds would flood the audit table with no signal.
  } else if (isBulk) {
    // Outcome row. For an apply this pairs with the pre-call attribution row
    // written above, so an aborted run still leaves the human on the record.
    await recordAction(ctx, {
      elationPatientId: null,
      action: `${action}:${statusPoll ? "status" : bulkApply ? "apply-result" : "dry-run"}`,
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
    scope: `${action}${isBulk ? (statusPoll ? ":status" : bulkApply ? ":apply" : ":dry-run") : ""}`,
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
      // A member with no portal record is an expected state for a read, not a
      // transport failure — answer 200 with the envelope so the UI can show it.
      status: ok || (action === "get" && String(errorMessage ?? "").includes("NO_ROSTER_DOC")) ? 200 : status || 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});
