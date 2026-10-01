import { useEffect, useState } from "react";
import { invokeAuthed } from "@/lib/invokeAuthed";

export type HintResourceResponse<T = any> = {
  status?: number;
  ok?: boolean;
  data?: T;
  pagination?: { total: number | null };
  error?: string;
};

export function useHintResource<T = any>(
  resource: string,
  query: Record<string, any> = {},
  scope: "practice" | "partner" = "practice",
  enabled = true,
) {
  const [data, setData] = useState<T | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const { data: res, error: err } = await invokeAuthed("hint-live", {
          body: undefined,
          resource,
          scope,
          query,
        });
        if (cancelled) return;
        if (err) {
          setError(err.message);
        } else {
          const r = res as HintResourceResponse<T>;
          if (r.ok === false || (r.status && r.status >= 400)) {
            setError(r.error ?? `Hint returned ${r.status}`);
          } else {
            setData((r.data ?? null) as T);
            setTotal(r.pagination?.total ?? null);
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load Hint data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource, scope, JSON.stringify(query), enabled]);

  return { data, total, loading, error };
}

export function extractHintList(data: any): any[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  for (const v of Object.values(data)) if (Array.isArray(v)) return v as any[];
  return [];
}

export const fmtUsd = (cents: number) =>
  `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
