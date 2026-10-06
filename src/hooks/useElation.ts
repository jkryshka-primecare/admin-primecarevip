import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invokeAuthed } from "@/lib/invokeAuthed";

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
  const { data, error } = await invokeAuthed(FUNCTION_NAME, {
    resource,
    id: opts?.id,
    scope: opts?.scope ?? "rest",
    method: "GET",
    query,
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
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 3);
    let res: Awaited<ReturnType<typeof callElation<{ results?: ElationPatient[] }>>>;
    if (words.length === 0) {
      res = await callElation<{ results?: ElationPatient[] }>("patients", { limit });
    } else {
      // Elation only filters on exact first_name / last_name (no middle name,
      // no partials), so query each word as both and merge.
      const calls = words.flatMap((w) => [
        callElation<{ results?: ElationPatient[] }>("patients", { limit, first_name: w }),
        callElation<{ results?: ElationPatient[] }>("patients", { limit, last_name: w }),
      ]);
      const all = await Promise.all(calls);
      const good = all.filter((r) => !(r.ok === false || (r.status && r.status >= 400)));
      const byId = new Map<string, ElationPatient>();
      for (const r of good) {
        for (const p of (r.data as { results?: ElationPatient[] })?.results ?? []) {
          byId.set(String(p.id), p);
        }
      }
      // Every typed word must appear somewhere in the full name.
      const list = [...byId.values()].filter((p) => {
        const full = [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(" ").toLowerCase();
        return words.every((w) => full.includes(w));
      });
      res = good.length === 0 ? all[0] : { ...good[0], data: { results: list }, pagination: { total: list.length } as never };
    }
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
