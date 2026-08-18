import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type FirestoreCollection =
  | "patients"
  | "appointment_requests"
  | "billing_accounts"
  | "billing_invoices"
  | "billing_subscriptions"
  | "pharmacy_orders"
  | "chat_conversations"
  | "messages"
  | "directory"
  | "locations"
  | "family"
  | "onboard_fees"
  | "artifact_coverage_reports";


export type FirestoreDoc = Record<string, unknown> & { id: string | null };

export type FirestoreEnvelope<T> = {
  status?: number;
  ok?: boolean;
  error?: string;
  elapsedMs?: number;
  pagination?: { total: number | null };
  data?: T;
};

export type FirestoreQuery = {
  where?: { field: string; op?: string; value: unknown }[];
  orderBy?: { field: string; direction?: "asc" | "desc" };
  limit?: number;
  cursor?: number;
  /**
   * Page through the whole collection instead of a single request.
   * The bridge caps each page at 300 rows, so this loops the offset cursor
   * until a short page comes back (or the safety ceiling is hit).
   */
  fetchAll?: boolean;
};

/** Never pull more than this many documents in one fetchAll sweep. */
const MAX_DOCS = 10_000;
const PAGE_SIZE = 300;

/**
 * READ-ONLY. The bridge exposes no write path — live member records are
 * never mutated from this admin OS.
 */
async function callBridge<T>(body: Record<string, unknown>): Promise<FirestoreEnvelope<T>> {
  const { data, error } = await supabase.functions.invoke<FirestoreEnvelope<T>>(
    "firestore-bridge",
    { body },
  );
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Empty response from the Firestore bridge");
  if (data.ok === false) throw new Error(data.error ?? `Firestore returned ${data.status}`);
  return data;
}

export function useFirestoreList(
  collection: FirestoreCollection,
  query: FirestoreQuery = {},
  enabled = true,
) {
  const { fetchAll, ...rest } = query;

  const result = useQuery({
    queryKey: ["firestore", collection, "list", query],
    queryFn: async () => {
      if (!fetchAll) return callBridge<FirestoreDoc[]>({ collection, ...rest });

      const all: FirestoreDoc[] = [];
      let cursor = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const page = await callBridge<FirestoreDoc[]>({
          ...rest,
          collection,
          limit: PAGE_SIZE,
          cursor,
        });
        const rows = page.data ?? [];
        all.push(...rows);
        if (rows.length < PAGE_SIZE || all.length >= MAX_DOCS) break;
        cursor += PAGE_SIZE;
      }
      return {
        ok: true,
        status: 200,
        pagination: { total: all.length },
        data: all,
      } as FirestoreEnvelope<FirestoreDoc[]>;
    },
    enabled,
    staleTime: 2 * 60 * 1000,
    retry: false,
  });

  return {
    docs: result.data?.data ?? [],
    total: result.data?.pagination?.total ?? null,
    loading: result.isLoading,
    fetching: result.isFetching,
    error: result.error instanceof Error ? result.error.message : null,
    refetch: result.refetch,
  };
}


export function useFirestoreDoc(
  collection: FirestoreCollection,
  id: string | null,
  enabled = true,
) {
  const result = useQuery({
    queryKey: ["firestore", collection, "doc", id],
    queryFn: () => callBridge<FirestoreDoc>({ collection, id }),
    enabled: enabled && Boolean(id),
    staleTime: 2 * 60 * 1000,
    retry: false,
  });

  return {
    doc: result.data?.data ?? null,
    loading: result.isLoading,
    error: result.error instanceof Error ? result.error.message : null,
  };
}

/** Pick the first present string field from a Firestore doc. */
export function pickString(doc: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = doc?.[k];
    if (typeof v === "string" && v.trim()) return v;
    if (typeof v === "number") return String(v);
  }
  return null;
}
