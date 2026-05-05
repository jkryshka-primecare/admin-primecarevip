import { useMemo } from "react";
import { Loader2, AlertCircle, Pill } from "lucide-react";
import { useElationResource } from "@/hooks/useElation";

type ElationMed = {
  id: number | string;
  patient?: number | string;
  medication?: { name?: string; brand_name?: string; generic_name?: string; is_controlled?: boolean };
  directions?: string;
  auth_refills?: number;
  chart_date?: string;
  medication_type?: string;
};

type ListResp = { results?: ElationMed[] };

export default function ElationLiveMedications({ limit = 50 }: { limit?: number }) {
  const { data, loading, error } = useElationResource<ListResp>("medications", { limit });
  const meds = data?.results ?? [];

  const stats = useMemo(() => {
    const controlled = meds.filter((m) => m.medication?.is_controlled).length;
    const uniquePatients = new Set(meds.map((m) => String(m.patient ?? ""))).size;
    return { total: meds.length, controlled, uniquePatients };
  }, [meds]);

  return (
    <section className="bg-card border border-border rounded-lg shadow-soft">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Pill className="size-4 text-primary" />
        <h3 className="font-serif text-base">Live Medications (Elation)</h3>
        <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground">
          Showing {stats.total} · {stats.uniquePatients} patients · {stats.controlled} controlled
        </span>
      </header>

      {loading && (
        <div className="px-4 py-12 text-center text-muted-foreground text-sm">
          <Loader2 className="size-4 animate-spin inline mr-2" /> Fetching from Elation…
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
                <th className="text-left px-4 py-2 font-semibold">Medication</th>
                <th className="text-left px-4 py-2 font-semibold">Directions</th>
                <th className="text-left px-4 py-2 font-semibold">Type</th>
                <th className="text-left px-4 py-2 font-semibold">Refills</th>
                <th className="text-left px-4 py-2 font-semibold">Patient</th>
                <th className="text-left px-4 py-2 font-semibold">Charted</th>
              </tr>
            </thead>
            <tbody>
              {meds.map((m) => (
                <tr key={String(m.id)} className="border-t border-border hover:bg-muted/30">
                  <td className="px-4 py-2 font-medium">
                    {m.medication?.name ?? m.medication?.generic_name ?? "—"}
                    {m.medication?.is_controlled && (
                      <span className="ml-2 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-destructive/10 text-destructive border border-destructive/30">
                        Controlled
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{m.directions ?? "—"}</td>
                  <td className="px-4 py-2 text-xs">{m.medication_type ?? "—"}</td>
                  <td className="px-4 py-2 font-mono text-xs">{m.auth_refills ?? 0}</td>
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{m.patient ?? "—"}</td>
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                    {m.chart_date ? new Date(m.chart_date).toLocaleDateString() : "—"}
                  </td>
                </tr>
              ))}
              {meds.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                    No medications returned.
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
