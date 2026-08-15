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
  hiddenItems?: { collection: string; id: string; label?: string; hiddenAt?: string }[];
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

export function usePortalAccess(elationPatientId: string | null, enabled = true) {
  const result = useQuery({
    queryKey: ["portal-admin", "access", elationPatientId],
    queryFn: () =>
      callPortalAdmin<PortalAccessSnapshot>({ action: "get", elationPatientId }),
    enabled: enabled && !!elationPatientId,
    staleTime: 60 * 1000,
    retry: false,
  });

  return {
    snapshot: result.data?.data ?? null,
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

  const setAccess = useMutation({
    mutationFn: (vars: {
      reason: string;
      patch: {
        status?: "active" | "suspended";
        modules?: Partial<Record<PortalModule, boolean>>;
        hideItem?: { collection: string; id: string; label?: string };
        unhideItem?: { collection: string; id: string };
      };
    }) =>
      callPortalAdmin({
        action: "setAccess",
        elationPatientId,
        reason: vars.reason,
        patch: vars.patch,
      }),
    onSuccess: invalidate,
  });

  return { issueInvite, revokeInvite, setAccess };
}
