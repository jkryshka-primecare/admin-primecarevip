import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Portal control plane client.
 *
 * Reads are safe to run on selection. Every mutation goes through the
 * `portal-admin` edge function, requires an admin role and a written reason,
 * and is audited server-side. Nothing here touches Elation or clinical data —
 * only what the member's portal shows them.
 */

export type PortalModule =
  | "labs"
  | "imaging"
  | "medications"
  | "records"
  | "appointments"
  | "conditions"
  | "allergies";

/**
 * These keys are the contract with the portal's Cloud Functions — they must
 * stay identical to MODULES in core/services/patient/portalAccess.js, since
 * each enforcing handler checks its own key by name.
 */
export const PORTAL_MODULES: { key: PortalModule; label: string; description: string }[] = [
  { key: "labs", label: "Lab results", description: "Results released to the member" },
  { key: "imaging", label: "Imaging", description: "Radiology reports and scans" },
  { key: "medications", label: "Medications", description: "Active medication list" },
  { key: "records", label: "Documents & letters", description: "Records, letters and uploads" },
  { key: "appointments", label: "Appointments", description: "Upcoming and past visits" },
  { key: "conditions", label: "Conditions", description: "Problem list" },
  { key: "allergies", label: "Allergies", description: "Recorded allergies" },
];


export type PortalAccessState = {
  status?: "active" | "suspended" | string;
  modules?: Partial<Record<PortalModule, boolean>>;
  hiddenItems?:
    | { collection: string; id: string; label?: string; hiddenAt?: string }[]
    | Record<string, unknown>;
  updatedAt?: string;
  updatedBy?: string;
};

export type PortalAccessSnapshot = {
  claimed?: boolean;
  claimedAt?: string | null;
  inviteStatus?: "none" | "pending" | "claimed" | "revoked" | string;
  inviteSentAt?: string | null;
  inviteExpiresAt?: string | null;
  email?: string | null;
  uid?: string | null;
  access?: PortalAccessState;
  roster?: Record<string, unknown> | null;
};

type Envelope<T> = {
  ok: boolean;
  status: number;
  elapsedMs?: number;
  error?: string | null;
  configured?: boolean;
  data?: T | null;
};

async function callPortalAdmin<T>(body: Record<string, unknown>): Promise<Envelope<T>> {
  // Signed-out / expired sessions must not reach the function: it answers 401
  // and the panel renders that as a blank screen.
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Your session has expired. Sign in again to continue.");
  const { data, error } = await supabase.functions.invoke<Envelope<T>>("portal-admin", { body });
  if (error && !data) throw new Error(error.message);
  if (!data) throw new Error("Empty response from the portal control plane");
  if (!data.ok) throw new Error(data.error ?? `Portal function returned ${data.status}`);
  return data;
}


/**
 * The Cloud Function answers with `{ claim: { state, claimedAt, liveToken, ... }, access, roster }`.
 * The panel speaks a flatter dialect, so translate once here rather than in
 * every field — this is the only place that knows the upstream shape.
 */
type RawAccessResponse = {
  elationPatientId?: string;
  claim?: {
    state?: "claimed" | "invited" | "expired_or_revoked" | "not_invited" | string;
    claimedAt?: string | null;
    liveToken?: { expiresAt?: string | null; issuedAt?: string | null } | null;
    lastIssuedAt?: string | null;
    webAccessVerifiedAt?: string | null;
  };
  access?: PortalAccessState;
  roster?: Record<string, unknown> | null;
  // Older/alternate shape — kept so a backend rollback doesn't blank the panel.
  claimed?: boolean;
  inviteStatus?: string;
  email?: string | null;
  uid?: string | null;
};

function normalizeSnapshot(raw: RawAccessResponse | null | undefined): PortalAccessSnapshot | null {
  if (!raw) return null;
  const claim = raw.claim;
  if (!claim) return raw as PortalAccessSnapshot;

  const roster = (raw.roster ?? null) as Record<string, unknown> | null;
  const inviteStatus =
    claim.state === "claimed"
      ? "claimed"
      : claim.state === "invited"
        ? "pending"
        : claim.state === "expired_or_revoked"
          ? "revoked"
          : "none";

  return {
    claimed: claim.state === "claimed",
    claimedAt: claim.claimedAt ?? null,
    inviteStatus,
    inviteSentAt: claim.liveToken?.issuedAt ?? claim.lastIssuedAt ?? null,
    inviteExpiresAt: claim.liveToken?.expiresAt ?? null,
    email: (roster?.email as string | null) ?? raw.email ?? null,
    uid: raw.uid ?? null,
    access: raw.access ?? {},
    roster,
  };
}

/**
 * Firestore stores hiddenItems as a module-keyed map of id arrays
 * ({ labs: ["SMOKE-LAB-2"] }). Tolerate the older array-of-objects/strings
 * shapes so a rollback can't corrupt the next write. Ids are case-sensitive.
 */
function toHiddenMap(raw: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!raw) return out;
  const push = (collection: string, id: string) => {
    if (!id) return;
    out[collection] = Array.from(new Set([...(out[collection] ?? []), id]));
  };
  if (Array.isArray(raw)) {
    raw.filter(Boolean).forEach((h: unknown) => {
      if (typeof h === "string") push("unknown", h);
      else if (typeof h === "object") {
        const o = h as Record<string, unknown>;
        push(String(o.collection ?? o.module ?? "unknown"), String(o.id ?? ""));
      }
    });
    return out;
  }
  if (typeof raw === "object") {
    Object.entries(raw as Record<string, unknown>).forEach(([collection, items]) => {
      if (!Array.isArray(items)) return;
      items.filter(Boolean).forEach((it: unknown) => {
        if (typeof it === "string") push(collection, it);
        else if (typeof it === "object") {
          const o = it as Record<string, unknown>;
          push(String(o.collection ?? collection), String(o.id ?? ""));
        }
      });
    });
  }
  return out;
}

export function usePortalAccess(elationPatientId: string | null, enabled = true) {

  const result = useQuery({
    queryKey: ["portal-admin", "access", elationPatientId],
    queryFn: () =>
      callPortalAdmin<RawAccessResponse>({ action: "get", elationPatientId }),
    enabled: enabled && !!elationPatientId,
    staleTime: 60 * 1000,
    retry: false,
  });

  return {
    snapshot: normalizeSnapshot(result.data?.data),
    loading: result.isLoading,
    error: result.error instanceof Error ? result.error.message : null,
    refetch: result.refetch,
  };
}


export function usePortalMutations(elationPatientId: string | null) {
  const qc = useQueryClient();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["portal-admin", "access", elationPatientId] });

  const issueInvite = useMutation({
    mutationFn: (vars: { reason: string; reissue?: boolean }) =>
      callPortalAdmin({
        action: "invite",
        elationPatientId,
        reason: vars.reason,
        reissue: vars.reissue ?? false,
      }),
    onSuccess: invalidate,
  });

  const revokeInvite = useMutation({
    mutationFn: (vars: { reason: string }) =>
      callPortalAdmin({ action: "revoke", elationPatientId, reason: vars.reason }),
    onSuccess: invalidate,
  });

  /**
   * The backend only recognizes `status`, `modules` and `hiddenItems` on a
   * patch, and treats `hiddenItems` as a full replacement. The panel speaks in
   * single-item `hideItem` / `unhideItem` intents, so translate here: read the
   * current snapshot immediately before the call, compute the next
   * module-keyed map of ids, and send that.
   *
   * KNOWN LIMITATION: this read-modify-write happens on the client, so two
   * concurrent hides on the same member can clobber each other (last write
   * wins). Acceptable for a single-operator control plane; the permanent fix is
   * an atomic hide/unhide inside the backend's setPortalAccess transaction.
   */
  const setAccess = useMutation({
    mutationFn: async (vars: {
      reason: string;
      patch: {
        status?: "active" | "suspended";
        modules?: Partial<Record<PortalModule, boolean>>;
        hideItem?: { collection: string; id: string; label?: string };
        unhideItem?: { collection: string; id: string };
      };
    }) => {
      const { hideItem, unhideItem, ...rest } = vars.patch;
      const patch: Record<string, unknown> = { ...rest };

      if (hideItem || unhideItem) {
        const target = hideItem ?? unhideItem!;
        const fresh = await callPortalAdmin<RawAccessResponse>({
          action: "get",
          elationPatientId,
        });
        const current = toHiddenMap(fresh.data?.access?.hiddenItems);
        const list = current[target.collection] ?? [];
        current[target.collection] = hideItem
          ? Array.from(new Set([...list, target.id]))
          : list.filter((id) => id !== target.id);
        patch.hiddenItems = current;
      }

      return callPortalAdmin({
        action: "setAccess",
        elationPatientId,
        reason: vars.reason,
        patch,
      });
    },
    onSuccess: invalidate,
  });


  return { issueInvite, revokeInvite, setAccess };
}

/** A member selected for portal-record provisioning. */
export type ProvisionMember = {
  hintId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  dob: string;
  phone: string | null;
  /** Manual Elation chart id, supplied when automatic matching is inconclusive. */
  elationPatientId?: string;
};


export type ProvisionResult = {
  created: { hintId: string; elationPatientId: string; name?: string }[];
  unresolved: { hintId: string; name?: string; reason?: string }[];
  skipped?: { hintId: string; reason?: string }[];
};

/**
 * Creates portal roster records for members who have none.
 *
 * This is the only bulk write in the admin app. It creates a record and
 * nothing else — no invite is sent, no email leaves the system, and no
 * clinical data is written. Admin role and a written reason are enforced
 * server-side, and every member in the batch gets its own audit row.
 */
export function useProvisionPortalRecords() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { members: ProvisionMember[]; reason: string }) => {
      const res = await callPortalAdmin<ProvisionResult>({
        action: "provision",
        members: vars.members,
        reason: vars.reason,
      });
      return (
        res.data ?? { created: [], unresolved: [] as ProvisionResult["unresolved"] }
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["firestore"] });
      qc.invalidateQueries({ queryKey: ["portal-admin"] });
    },
  });
}

/**
 * Asks the artifact-coverage job to run now rather than waiting for the 03:15
 * schedule. Read-only against member data: the job walks references and writes
 * a report. Admin-only, and the request itself is audited.
 */
export function useRunArtifactAudit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars?: { reason?: string }) => {
      const res = await callPortalAdmin<{ runId?: string; queued?: boolean }>({
        action: "runAudit",
        reason: vars?.reason ?? "Manual artifact coverage audit from the admin OS",
      });
      return res.data ?? {};
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["firestore"] });
    },
  });
}


export type SmokeCase = { name: string; pass: boolean; detail: string; skipped?: boolean };
export type SmokeGuardianFixture = {
  fixtureSources?: Record<string, "body" | "env" | "unset" | string>;
  enabled?: boolean;
  scoped?: boolean;
  allowlistSize?: number;
  failClosed?: boolean;
};
export type SmokeReport = {
  fixture?: { patientId: string; uid: string; missingId: string };
  guardianFixture?: SmokeGuardianFixture;
  base?: string;
  ranAt?: string;
  total?: number;
  passed?: number;
  failed?: number;
  skipped?: number;
  results?: SmokeCase[];
};


/**
 * Runs the live read-path smoke against the DEPLOYED patient endpoints, using
 * the Test Kieffer fixture only. Admin-only and audited. It flips the
 * fixture's portalAccess to prove hidden/suspended behaviour and restores it
 * verbatim — no real member is touched.
 */
export type UnclaimedGuardianRow = {
  childElationId: string;
  guardianElationId: string | null;
  guardianEmail: string | null;
  guardianName: string | null;
  source: string | null;
  blocker: "GUARDIAN_HAS_NO_PORTAL_ACCOUNT" | "EMAIL_ONLY_PHASE_2" | string;
};

export type UnclaimedGuardiansReport = {
  generatedAt?: string;
  summary?: { minors: number; activeLinks: number; claimed: number; unclaimed: number };
  rows: UnclaimedGuardianRow[];
};

/**
 * Release 2b phase 1 — active guardian links that cannot authorize a read yet.
 *
 * Read-only upstream (`adminUnclaimedGuardiansReport`), admin-only, and the
 * call itself is audited by the bridge. Deliberately a mutation, not a query:
 * it returns guardian PHI, so it must never fire on render — only when staff
 * ask for it.
 */
export function useUnclaimedGuardians() {
  return useMutation({
    mutationFn: async (vars?: { reason?: string }) => {
      const res = await callPortalAdmin<UnclaimedGuardiansReport>({
        action: "unclaimedGuardians",
        reason: vars?.reason ?? "Guardian link review from the admin OS",
      });
      const data = res.data ?? ({} as UnclaimedGuardiansReport);
      return { ...data, rows: Array.isArray(data.rows) ? data.rows : [] };
    },
  });
}

export type SmokeFixtureOverrides = {
  guardianUid?: string;
  guardianElationId?: string;
  childPatientId?: string;
  otherChildId?: string;
};

export function useRunReadPathSmoke() {
  return useMutation({
    mutationFn: async (vars?: { reason?: string } & SmokeFixtureOverrides) => {
      const fixtures: Record<string, string> = {};
      (["guardianUid", "guardianElationId", "childPatientId", "otherChildId"] as const).forEach(
        (k) => {
          const v = vars?.[k]?.trim();
          if (v) fixtures[k] = v;
        },
      );
      const res = await callPortalAdmin<SmokeReport>({
        action: "smoke",
        reason: vars?.reason ?? "Manual read-path smoke from the admin OS",
        ...fixtures,
      });
      return res.data ?? {};
    },
  });
}


// --- Release 2b Part B — bulk migration runners -----------------------------
//
// Dry run is the default everywhere. `apply: true` is refused server-side for
// anyone below super_admin, requires a written reason, and only runs after the
// attribution row is on the record. `isSuperAdmin` on the client hides the
// button; it grants nothing.

export type BackfillAction = "backfillUids" | "backfillArtifacts" | "backfillMinorReports";

export type BackfillReport = {
  apply?: boolean;
  scanned?: number;
  alreadyPresent?: number;
  minted?: number;
  wouldMint?: number;
  copied?: number;
  wouldCopy?: number;
  noInternalUid?: unknown[];
  noLegacyObject?: number;
  failed?: unknown[];
  remaining?: number;
  nextCursor?: string | null;
  done?: boolean;
  /** Minor-track wrapper: ids the wrapper refused because they are not minors. */
  rejected?: { patientId: string; reason: string }[];
  ingested?: number;
  skipped?: number;
  cohort?: "minors" | "adults";
  eligible?: number;
  wouldIngest?: number;
  alreadyStored?: number;
  skippedUnsigned?: number;
  skippedDeleted?: number;
  skippedNotAllowlisted?: number;
  skippedRecordsDeferred?: number;
  runId?: string;
  async?: boolean;
  /** Async apply progress (from a `statusOnly` poll of `backfill_runs/{runId}`). */
  status?:
    | "claimed"
    | "running"
    | "paused"
    | "complete"
    | "error"
    | "unknown"
    | string;
  /** Run-level pause/lease fields (wrapper PR #460). */
  paused?: boolean;
  pauseReason?: string | null;
  staleLease?: boolean;
  resumable?: boolean;
  reclaimedFrom?: string | null;
  leaseExpiresAt?: string | null;
  requested?: number;
  completed?: number;
  pending?: number;
  /** Ids still queued — lets an operator see WHICH patient a run is wedged on. */
  pendingIds?: string[];
  /** Ids claimed by a worker but not yet checkpointed complete. */
  inFlightIds?: string[];
  /** Ids a resume deliberately skipped because a prior instance died on them. */
  abandonedIds?: string[];
  startedAt?: string | null;
  lastPatientAt?: string | null;
  updatedAt?: string | null;
  counters?: Record<string, number>;
  errorReason?: string | null;
  reportTypeCensus?: {
    reportType: string;
    count: number;
    category?: string | null;
    unmappedType?: boolean;
  }[];
};

export type BackfillVars = {
  apply?: boolean;
  reason?: string;
  limit?: number;
  cursor?: string | null;
  /** Report ingest only. Re-validated against the cohort rule in the wrapper. */
  patientIds?: string[];
  /** Report ingest only. Defaults to the minor track. */
  cohort?: "minors" | "adults";
  skipExisting?: boolean;
  storeMedicalRecords?: boolean;
  /**
   * Report ingest only. Supply on apply to RESUME an existing run — the
   * wrapper continues that run's pending list instead of starting a new job.
   */
  runId?: string;
};

export function useBackfillRunner(action: BackfillAction) {
  return useMutation({
    mutationFn: async (vars: BackfillVars = {}) => {
      const res = await callPortalAdmin<BackfillReport>({
        action,
        apply: vars.apply === true,
        reason: vars.reason ?? "",
        ...(vars.limit ? { limit: vars.limit } : {}),
        ...(vars.cursor ? { cursor: vars.cursor } : {}),
        ...(vars.patientIds ? { patientIds: vars.patientIds } : {}),
        ...(vars.cohort ? { cohort: vars.cohort } : {}),
        ...(vars.skipExisting ? { skipExisting: true } : {}),
        ...(typeof vars.storeMedicalRecords === "boolean"
          ? { storeMedicalRecords: vars.storeMedicalRecords }
          : {}),
        ...(vars.runId ? { runId: vars.runId } : {}),
      });
      return res.data ?? ({} as BackfillReport);
    },
  });
}

/**
 * Progress poll for an async report-ingest run.
 *
 * Reads `backfill_runs/{runId}` counters only — no PHI, no writes — so it is
 * admin-gated like a dry run and is not audited per call. The run keeps going
 * server-side whether or not anyone is polling: closing the tab does not stop
 * it, and re-attaching is just polling the same runId again.
 */
const RUN_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

export function useBackfillRunStatus(runId: string | null, enabled: boolean) {
  // The edge function rejects a malformed/empty runId with a 400. Never poll
  // unless the id matches the same shape server-side, so a half-set id can't
  // throw an error the panel renders as a blank screen.
  const validRunId = typeof runId === "string" && RUN_ID_RE.test(runId.trim());
  return useQuery({
    queryKey: ["portal-admin", "backfill-run", runId],
    enabled: validRunId && enabled,
    retry: false,
    // Stop polling once a call fails (expired session, bad id) instead of
    // retrying the same error every 10s.
    refetchInterval: (q) => (validRunId && enabled && !q.state.error ? 10_000 : false),

    queryFn: async () => {
      const res = await callPortalAdmin<BackfillReport>({
        action: "backfillMinorReports",
        statusOnly: true,
        runId: (runId ?? "").trim(),
      });
      return res.data ?? ({} as BackfillReport);
    },
  });
}

/**
 * Clears a zombie `backfill_runs/{runId}` so the same runId can be resumed.
 * Super-admin + written reason, enforced server-side and audited before the
 * upstream call. `force` reclaims a run whose lease has not expired yet.
 */
export function useResetBackfillRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { runId: string; reason: string; force?: boolean }) => {
      const res = await callPortalAdmin<BackfillReport>({
        action: "reset",
        runId: vars.runId,
        reason: vars.reason,
        ...(vars.force ? { force: true } : {}),
      });
      return res.data ?? ({} as BackfillReport);
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["portal-admin", "backfill-run", vars.runId] });
    },
  });
}

// ---------------------------------------------------------------------------
// Release 2b Step 1 — guardian link loader (console replacement for
// scripts/load-guardian-links.js). The CSV is sent as raw text and parsed
// server-side; nothing about authority is read from it.
// ---------------------------------------------------------------------------

export type GuardianLinkRejection = {
  line: number;
  childElationId: string | null;
  reason: string;
};

export type GuardianLinkReport = {
  apply?: boolean;
  totalRows?: number;
  uniqueChildren?: number;
  duplicates?: number;
  rejected?: GuardianLinkRejection[];
  pageSize?: number;
  offset?: number;
  processed?: number;
  linked?: number;
  created?: number;
  updated?: number;
  failures?: { childElationId: string; guardianRef: string; status: number; reason: string }[];
  preview?: { childElationId: string; guardianRef: string; source: string }[];
  nextOffset?: number | null;
  done?: boolean;
  partial?: boolean;
};

export type GuardianLinkVars = {
  csv: string;
  apply?: boolean;
  reason?: string;
  offset?: number;
  pageSize?: number;
  /** Stage 2: apply exactly one child from the pasted CSV. */
  onlyChildElationId?: string;
};

export function useGuardianLinkLoader() {
  return useMutation({
    mutationFn: async (vars: GuardianLinkVars) => {
      const res = await callPortalAdmin<GuardianLinkReport>({
        action: "linkGuardians",
        csv: vars.csv,
        apply: vars.apply === true,
        reason: vars.reason ?? "",
        ...(vars.offset ? { offset: vars.offset } : {}),
        ...(vars.pageSize ? { pageSize: vars.pageSize } : {}),
        ...(vars.onlyChildElationId
          ? { onlyChildElationId: vars.onlyChildElationId }
          : {}),
      });
      return res.data ?? ({} as GuardianLinkReport);
    },
  });
}
