import { useMemo } from "react";
import { Loader2, AlertCircle, DollarSign, TrendingUp, AlertTriangle } from "lucide-react";
import { useHintResource, extractHintList, fmtUsd } from "@/hooks/useHintResource";

export default function HintLiveCostSavings({ limit = 200 }: { limit?: number }) {
  const { data, loading, error } = useHintResource("invoices", { limit });
  const invoices = extractHintList(data);

  const stats = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    let outstanding = 0;
    let overdue = 0;
    let paidMtd = 0;
    let paidTotal = 0;
    let openCount = 0;
    for (const inv of invoices) {
      const cents = Number(inv.balance_cents ?? inv.amount_due_cents ?? inv.total_cents ?? 0);
      const status = String(inv.status ?? "").toLowerCase();
      const dueDate = inv.due_date ? new Date(inv.due_date) : null;
      const paidAt = inv.paid_at ? new Date(inv.paid_at) : null;
      const total = Number(inv.total_cents ?? inv.amount_paid_cents ?? 0);
      if (status === "paid") {
        paidTotal += total;
        if (paidAt && paidAt >= monthStart) paidMtd += total;
      } else if (cents > 0) {
        outstanding += cents;
        openCount += 1;
        if (dueDate && dueDate < now) overdue += cents;
      }
    }
    return { outstanding, overdue, paidMtd, paidTotal, openCount, count: invoices.length };
  }, [invoices]);

  return (
    <section className="bg-card border border-border rounded-lg shadow-soft">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <DollarSign className="size-4 text-primary" />
        <h3 className="font-serif text-base">Live Revenue & Savings (Hint)</h3>
        <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground">
          {stats.count} invoices analyzed
        </span>
      </header>
      {loading && (
        <div className="px-4 py-12 text-center text-muted-foreground text-sm">
          <Loader2 className="size-4 animate-spin inline mr-2" /> Fetching invoices…
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 bg-destructive/5 text-destructive text-sm">
          <AlertCircle className="size-4" /> {error}
        </div>
      )}
      {!loading && !error && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 p-4">
          <Tile icon={<TrendingUp className="size-4" />} label="Paid MTD" value={fmtUsd(stats.paidMtd)} />
          <Tile icon={<DollarSign className="size-4" />} label="Paid (in batch)" value={fmtUsd(stats.paidTotal)} />
          <Tile icon={<AlertTriangle className="size-4 text-warning" />} label="Outstanding" value={fmtUsd(stats.outstanding)} sub={`${stats.openCount} open`} />
          <Tile icon={<AlertTriangle className="size-4 text-destructive" />} label="Overdue" value={fmtUsd(stats.overdue)} accent={stats.overdue > 0} />
        </div>
      )}
    </section>
  );
}

function Tile({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className={"border rounded-md p-4 bg-background " + (accent ? "border-destructive/50" : "border-border")}>
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-2xl font-serif">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}
