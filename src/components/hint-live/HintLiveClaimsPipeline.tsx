import { useMemo } from "react";
import { Loader2, AlertCircle, Receipt } from "lucide-react";
import { useHintResource, extractHintList, fmtUsd } from "@/hooks/useHintResource";

const STATUS_ORDER = ["draft", "pending", "open", "sent", "past_due", "overdue", "paid", "void"];

export default function HintLiveClaimsPipeline({ limit = 200 }: { limit?: number }) {
  const { data, loading, error } = useHintResource("invoices", { limit });
  const invoices = extractHintList(data);

  const buckets = useMemo(() => {
    const map = new Map<string, { count: number; total: number }>();
    for (const inv of invoices) {
      const status = String(inv.status ?? "unknown").toLowerCase();
      const cents = Number(inv.total_cents ?? inv.amount_due_cents ?? 0);
      const cur = map.get(status) ?? { count: 0, total: 0 };
      cur.count += 1;
      cur.total += cents;
      map.set(status, cur);
    }
    const entries = Array.from(map.entries());
    entries.sort((a, b) => {
      const ai = STATUS_ORDER.indexOf(a[0]);
      const bi = STATUS_ORDER.indexOf(b[0]);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
    return entries;
  }, [invoices]);

  return (
    <section className="bg-card border border-border rounded-lg shadow-soft">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Receipt className="size-4 text-primary" />
        <h3 className="font-serif text-base">Live Invoice Pipeline (Hint)</h3>
        <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground">
          {invoices.length} invoices
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
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2 font-semibold">Status</th>
                <th className="text-right px-4 py-2 font-semibold">Count</th>
                <th className="text-right px-4 py-2 font-semibold">Total Value</th>
                <th className="text-left px-4 py-2 font-semibold w-1/3">Distribution</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map(([status, b]) => {
                const max = Math.max(...buckets.map(([, x]) => x.count));
                const pct = max ? (b.count / max) * 100 : 0;
                return (
                  <tr key={status} className="border-t border-border hover:bg-muted/30">
                    <td className="px-4 py-2 capitalize font-medium">{status.replace(/_/g, " ")}</td>
                    <td className="px-4 py-2 text-right font-mono">{b.count}</td>
                    <td className="px-4 py-2 text-right font-mono">{fmtUsd(b.total)}</td>
                    <td className="px-4 py-2">
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
              {buckets.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-12 text-center text-muted-foreground">No invoices returned.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
