import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * READ-ONLY Hint roster.
 *
 * Hint is the source of truth for "who is a member". A Hint *membership* is a
 * contract that can cover a whole family, so counting memberships undercounts
 * people. Each Hint *patient* carries its own `membership_status`, which is the
 * per-person answer, so that is what we page through here.
 */

const PAGE_SIZE = 100;
const MAX_PATIENTS = 5_000;

export type HintMemberStatus = "active" | "inactive" | "pending" | "unpaid" | "none";

export type HintMember = {
  hintId: string;
  firstName: string;
  lastName: string;
  name: string;
  email: string | null;
  dob: string | null;
  phone: string | null;
  membershipStatus: HintMemberStatus;
  /** "primary" | "spouse" | "child" … as reported by Hint. */
  memberType: string | null;
  planName: string | null;
  joinedPracticeDate: string | null;
};

type HintPatient = {
  id?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  email?: string | null;
  dob?: string | null;
  membership_status?: string | null;
  joined_practice_date?: string | null;
  phones?: { number?: string }[];
  memberships?: { member_type?: string | null; plan?: { name?: string } | null }[];
};

type HintEnvelope = {
  ok?: boolean;
  status?: number;
  error?: string;
  data?: unknown;
  pagination?: { total: number | null };
};

async function callHint(query: Record<string, unknown>): Promise<HintEnvelope> {
  const { data, error } = await supabase.functions.invoke<HintEnvelope>("hint-live", {
    body: { resource: "patients", scope: "practice", query },
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Empty response from Hint");
  if (data.ok === false) throw new Error(data.error ?? `Hint returned ${data.status}`);
  return data;
}

function rowsOf(env: HintEnvelope): HintPatient[] {
  const d = env.data as unknown;
  if (Array.isArray(d)) return d as HintPatient[];
  if (d && typeof d === "object" && Array.isArray((d as { patients?: unknown }).patients)) {
    return (d as { patients: HintPatient[] }).patients;
  }
  return [];
}

function normalizeStatus(s: string | null | undefined): HintMemberStatus {
  const v = (s ?? "").toLowerCase();
  if (v === "active" || v === "inactive" || v === "pending" || v === "unpaid") return v;
  return "none";
}

function toMember(p: HintPatient): HintMember {
  const first = p.first_name ?? "";
  const last = p.last_name ?? "";
  const membership = p.memberships?.[0];
  return {
    hintId: p.id ?? "",
    firstName: first,
    lastName: last,
    name: p.name ?? `${first} ${last}`.trim(),
    email: p.email?.trim() || null,
    dob: p.dob ?? null,
    phone: p.phones?.[0]?.number ?? null,
    membershipStatus: normalizeStatus(p.membership_status),
    memberType: membership?.member_type ?? null,
    planName: membership?.plan?.name ?? null,
    joinedPracticeDate: p.joined_practice_date ?? null,
  };
}

/**
 * Pages the entire Hint patient roster (limit/offset — Hint ignores `per_page`)
 * and returns one row per person with their own membership status.
 */
export function useHintRoster(enabled = true) {
  const result = useQuery({
    queryKey: ["hint", "roster", "patients"],
    queryFn: async () => {
      const all: HintMember[] = [];
      let offset = 0;
      let reportedTotal: number | null = null;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const env = await callHint({ limit: PAGE_SIZE, offset });
        reportedTotal = env.pagination?.total ?? reportedTotal;
        const rows = rowsOf(env);
        for (const r of rows) all.push(toMember(r));
        if (rows.length < PAGE_SIZE || all.length >= MAX_PATIENTS) break;
        offset += PAGE_SIZE;
      }

      return { members: all, reportedTotal };
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  return {
    members: result.data?.members ?? [],
    reportedTotal: result.data?.reportedTotal ?? null,
    loading: result.isLoading,
    fetching: result.isFetching,
    error: result.error instanceof Error ? result.error.message : null,
    refetch: result.refetch,
  };
}
