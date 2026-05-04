import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type HintResponse = {
  status: number;
  data: any;
  pagination?: { total: number | null };
  error?: string;
};

type HintResult = HintResponse | { status: 0; data: null; pagination: { total: null }; error: string };

async function callHint(resource: string, query: Record<string, any> = {}, scope: "practice" | "partner" = "practice") {
  const { data, error } = await supabase.functions.invoke("hint-live", {
    body: { resource, scope, query },
  });
  if (error) throw new Error(error.message);
  return data as HintResponse;
}

async function safeCallHint(resource: string, query: Record<string, any> = {}, scope: "practice" | "partner" = "practice"): Promise<HintResult> {
  try {
    return await callHint(resource, query, scope);
  } catch (error) {
    const message = error instanceof Error ? error.message : `Failed to load ${resource}`;
    return { status: 0, data: null, pagination: { total: null }, error: message };
  }
}

export type HintDashboardData = {
  patients: { total: number | null; recent: number | null };
  invoices: {
    total: number | null;
    outstandingCents: number;
    overdueCents: number;
    paidMtdCents: number;
    openCount: number;
  };
  memberships: { total: number | null; active: number | null };
  loading: boolean;
  error: string | null;
};

const empty: HintDashboardData = {
  patients: { total: null, recent: null },
  invoices: { total: null, outstandingCents: 0, overdueCents: 0, paidMtdCents: 0, openCount: 0 },
  memberships: { total: null, active: null },
  loading: true,
  error: null,
};

export function useHintDashboard() {
  const [state, setState] = useState<HintDashboardData>(empty);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [patientsRes, invoicesRes, membershipsRes] = await Promise.all([
          safeCallHint("patients", { limit: 1 }),
          safeCallHint("invoices", { limit: 100 }),
          safeCallHint("memberships", { limit: 1 }),
        ]);

        const invoiceList: any[] = Array.isArray(invoicesRes.data?.data)
          ? invoicesRes.data.data
          : Array.isArray(invoicesRes.data)
          ? invoicesRes.data
          : [];

        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        let outstanding = 0;
        let overdue = 0;
        let paidMtd = 0;
        let openCount = 0;

        for (const inv of invoiceList) {
          const cents = Number(inv.balance_cents ?? inv.amount_due_cents ?? inv.total_cents ?? 0);
          const status = String(inv.status ?? "").toLowerCase();
          const dueDate = inv.due_date ? new Date(inv.due_date) : null;
          const paidAt = inv.paid_at ? new Date(inv.paid_at) : null;

          if (status === "paid" && paidAt && paidAt >= monthStart) {
            paidMtd += Number(inv.total_cents ?? inv.amount_paid_cents ?? 0);
          } else if (status !== "paid" && cents > 0) {
            outstanding += cents;
            openCount += 1;
            if (dueDate && dueDate < now) overdue += cents;
          }
        }

        if (cancelled) return;
        const errors = [patientsRes, invoicesRes, membershipsRes]
          .map((result) => result.error)
          .filter(Boolean);
        setState({
          patients: {
            total: patientsRes.pagination?.total ?? null,
            recent: null,
          },
          invoices: {
            total: invoicesRes.pagination?.total ?? invoiceList.length,
            outstandingCents: outstanding,
            overdueCents: overdue,
            paidMtdCents: paidMtd,
            openCount,
          },
          memberships: {
            total: membershipsRes.pagination?.total ?? null,
            active: membershipsRes.pagination?.total ?? null,
          },
          loading: false,
          error: errors[0] ?? null,
        });
      } catch (e: any) {
        if (cancelled) return;
        setState({ ...empty, loading: false, error: e?.message ?? "Failed to load Hint data" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

export const fmtUsd = (cents: number) =>
  `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
