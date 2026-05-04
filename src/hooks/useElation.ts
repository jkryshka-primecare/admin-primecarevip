import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type ElationScope = "rest" | "fhir";

export type ElationResponse<T = unknown> = {
  ok?: boolean;
  source?: string;
  upstream?: string;
  status?: number;
  elapsedMs?: number;
  generated?: string;
  pagination?: { total: number | null; next: string | null; previous: string | null };
  data?: T;
  error?: string;
  configured?: boolean;
};

const FUNCTION_NAME = "elation-live";

export async function callElation<T = unknown>(
  resource: string,
  query?: Record<string, string | number | boolean>,
  opts?: { id?: string; scope?: ElationScope },
): Promise<ElationResponse<T>> {
  const { data, error } = await supabase.functions.invoke(FUNCTION_NAME, {
    body: {
      resource,
      id: opts?.id,
      scope: opts?.scope ?? "rest",
      method: "GET",
      query,
    },
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  return (data ?? { ok: false, error: "Empty response" }) as ElationResponse<T>;
}

export type ElationPatient = {
  id: number | string;
  first_name?: string;
  last_name?: string;
  middle_name?: string;
  dob?: string;
  sex?: string;
  gender_identity?: string;
  preferred_language?: string;
  primary_physician?: number | string;
  caregiver_practice?: number | string;
  status?: string;
  email?: string;
  cell_phone?: string;
  home_phone?: string;
  address?: {
    address_line1?: string;
    address_line2?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  created_date?: string;
  // index signature for additional Elation fields
  [k: string]: unknown;
};

export function useElationPatients(opts: { search?: string; limit?: number } = {}) {
  const { search = "", limit = 50 } = opts;
  const [patients, setPatients] = useState<ElationPatient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [meta, setMeta] = useState<{ elapsedMs?: number; generated?: string } | null>(null);

  const debounceRef = useRef<number | null>(null);

  const fetchPatients = useCallback(async () => {
    setLoading(true);
    setError(null);
    const query: Record<string, string | number> = { limit };
    const trimmed = search.trim();
    if (trimmed) {
      // Elation supports last_name / first_name filters.
      query.last_name = trimmed;
    }
    const res = await callElation<{ results?: ElationPatient[] }>("patients", query);
    if (res.ok === false || (res.status && res.status >= 400)) {
      setError(res.error ?? `Elation returned ${res.status ?? "error"}`);
      setPatients([]);
      setTotal(null);
    } else {
      const list = (res.data as { results?: ElationPatient[] })?.results ?? [];
      setPatients(list);
      setTotal(res.pagination?.total ?? list.length);
    }
    setMeta({ elapsedMs: res.elapsedMs, generated: res.generated });
    setLoading(false);
  }, [search, limit]);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(fetchPatients, 250);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [fetchPatients]);

  return { patients, loading, error, total, meta, refetch: fetchPatients };
}

export function useElationResource<T = unknown>(
  resource: string,
  query?: Record<string, string | number>,
  enabled: boolean = true,
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setData(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    callElation<T>(resource, query).then((res) => {
      if (cancelled) return;
      if (res.ok === false || (res.status && res.status >= 400)) {
        setError(res.error ?? `Elation returned ${res.status ?? "error"}`);
        setData(null);
      } else {
        setData((res.data ?? null) as T);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource, JSON.stringify(query), enabled]);

  return { data, loading, error };
}
