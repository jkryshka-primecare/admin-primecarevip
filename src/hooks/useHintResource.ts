import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

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
        // Don't call the staff-gated proxy without a live session — that is
        // what produced "Invalid or expired session" 401s.
        const { data: sess } = await supabase.auth.getSession();
        if (!sess.session) {
          if (!cancelled) setError("Please sign in again to load live Hint data.");
          return;
        }
        const { data: res, error: err } = await supabase.functions.invoke("hint-live", {
          body: { resource, scope, query },
        });
        if (cancelled) return;
        if (err) {
          const status = (err as any)?.context?.status;
          setError(
            status === 401
              ? "Your session expired. Please sign in again."
              : status === 403
                ? "Your account isn't approved for patient data yet."
                : err.message,
          );
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
