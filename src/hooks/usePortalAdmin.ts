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

