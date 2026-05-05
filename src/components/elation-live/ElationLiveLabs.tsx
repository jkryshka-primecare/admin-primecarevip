import { useMemo } from "react";
import { Loader2, AlertCircle, FlaskConical } from "lucide-react";
import { useElationResource } from "@/hooks/useElation";

type ElationLabOrder = {
  id: number | string;
  patient?: number | string;
  ordering_physician?: number | string;
  chart_date?: string;
  document_date?: string;
  content?: {
    collection_datetime?: string;
    fasting_method?: string;
    icd10_codes?: { code: string; description: string }[];
    tests?: { id: number; name: string; code: string }[];
  };
  facility?: { name?: string };
};

type ListResp = { results?: ElationLabOrder[] };

export default function ElationLiveLabs({ limit = 50 }: { limit?: number }) {
  const { data, loading, error } = useElationResource<ListResp>("lab_orders", { limit });
  const orders = data?.results ?? [];

  const stats = useMemo(() => {
    const totalTests = orders.reduce((s, o) => s + (o.content?.tests?.length ?? 0), 0);
    const uniquePatients = new Set(orders.map((o) => String(o.patient ?? ""))).size;
    const fastingCount = orders.filter((o) => o.content?.fasting_method === "fasting").length;
    return { total: orders.length, totalTests, uniquePatients, fastingCount };
  }, [orders]);

  return (
    <section className="bg-card border border-border rounded-lg shadow-soft">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <FlaskConical className="size-4 text-primary" />
        <h3 className="font-serif text-base">Live Lab Orders (Elation)</h3>
        <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground">
          {stats.total} orders · {stats.totalTests} tests · {stats.uniquePatients} patients
        </span>
      </header>

      {loading && (
        <div className="px-4 py-12 text-center text-muted-foreground text-sm">
          <Loader2 className="size-4 animate-spin inline mr-2" /> Fetching lab orders…
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
                <th className="text-left px-4 py-2 font-semibold">Order</th>
                <th className="text-left px-4 py-2 font-semibold">Tests</th>
                <th className="text-left px-4 py-2 font-semibold">Indication</th>
                <th className="text-left px-4 py-2 font-semibold">Facility</th>
                <th className="text-left px-4 py-2 font-semibold">Patient</th>
                <th className="text-left px-4 py-2 font-semibold">Collected</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={String(o.id)} className="border-t border-border hover:bg-muted/30">
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{o.id}</td>
                  <td className="px-4 py-2">
                    {(o.content?.tests ?? []).slice(0, 3).map((t) => (
                      <div key={t.id} className="text-xs">
                        {t.name} <span className="text-muted-foreground font-mono">{t.code}</span>
                      </div>
                    ))}
                    {(o.content?.tests?.length ?? 0) > 3 && (
                      <div className="text-[10px] text-muted-foreground">+{(o.content?.tests?.length ?? 0) - 3} more</div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {(o.content?.icd10_codes ?? []).slice(0, 2).map((c) => (
                      <div key={c.code}>
                        <span className="font-mono text-muted-foreground">{c.code}</span> {c.description}
                      </div>
                    ))}
                  </td>
                  <td className="px-4 py-2 text-xs">{o.facility?.name ?? "—"}</td>
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{o.patient ?? "—"}</td>
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                    {o.content?.collection_datetime
                      ? new Date(o.content.collection_datetime).toLocaleDateString()
                      : "—"}
                  </td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                    No lab orders returned.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
