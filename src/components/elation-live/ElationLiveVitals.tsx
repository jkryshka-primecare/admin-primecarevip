import { useMemo } from "react";
import { Loader2, AlertCircle, HeartPulse } from "lucide-react";
import { useElationResource } from "@/hooks/useElation";

type Reading = { value?: string; units?: string };
type ElationVital = {
  id: number | string;
  patient?: number | string;
  chart_date?: string;
  bp?: { systolic?: string; diastolic?: string }[];
  hr?: Reading[];
  temperature?: Reading[];
  oxygen?: Reading[];
  bmi?: number | null;
  weight?: Reading[];
};
type ListResp = { results?: ElationVital[] };

export default function ElationLiveVitals({ limit = 50 }: { limit?: number }) {
  const { data, loading, error } = useElationResource<ListResp>("vitals", { limit });
  const vitals = data?.results ?? [];

  const stats = useMemo(() => {
    const hypertensive = vitals.filter(
      (v) => v.bp?.[0] && Number(v.bp[0].systolic) >= 140,
    ).length;
    const elevatedBmi = vitals.filter((v) => v.bmi && v.bmi >= 30).length;
    return { total: vitals.length, hypertensive, elevatedBmi };
  }, [vitals]);

  return (
    <section className="bg-card border border-border rounded-lg shadow-soft">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <HeartPulse className="size-4 text-primary" />
        <h3 className="font-serif text-base">Live Vitals (Elation)</h3>
        <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground">
          {stats.total} readings · {stats.hypertensive} hypertensive · {stats.elevatedBmi} BMI ≥ 30
        </span>
      </header>

      {loading && (
        <div className="px-4 py-12 text-center text-muted-foreground text-sm">
          <Loader2 className="size-4 animate-spin inline mr-2" /> Fetching vitals…
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 bg-destructive/5 text-destructive text-sm">
          <AlertCircle className="size-4" /> {error}
        </div>
      )}

      {!loading && !error && (
        <div className="overflow-x-auto max-h-[500px]">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground sticky top-0">
              <tr>
                <th className="text-left px-4 py-2 font-semibold">Date</th>
                <th className="text-left px-4 py-2 font-semibold">BP</th>
                <th className="text-left px-4 py-2 font-semibold">HR</th>
                <th className="text-left px-4 py-2 font-semibold">Temp</th>
                <th className="text-left px-4 py-2 font-semibold">SpO2</th>
                <th className="text-left px-4 py-2 font-semibold">BMI</th>
                <th className="text-left px-4 py-2 font-semibold">Patient</th>
              </tr>
            </thead>
            <tbody>
              {vitals.map((v) => {
                const bp = v.bp?.[0];
                const sys = bp ? Number(bp.systolic) : NaN;
                const flag = sys >= 140 ? "text-destructive" : "";
                return (
                  <tr key={String(v.id)} className="border-t border-border hover:bg-muted/30">
                    <td className="px-4 py-2 font-mono text-xs">
                      {v.chart_date ? new Date(v.chart_date).toLocaleDateString() : "—"}
                    </td>
                    <td className={`px-4 py-2 font-mono text-xs ${flag}`}>
                      {bp ? `${bp.systolic}/${bp.diastolic}` : "—"}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{v.hr?.[0]?.value ?? "—"}</td>
                    <td className="px-4 py-2 font-mono text-xs">{v.temperature?.[0]?.value ?? "—"}</td>
                    <td className="px-4 py-2 font-mono text-xs">{v.oxygen?.[0]?.value ?? "—"}</td>
                    <td className="px-4 py-2 font-mono text-xs">{v.bmi ?? "—"}</td>
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{v.patient ?? "—"}</td>
                  </tr>
                );
              })}
              {vitals.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                    No vitals returned.
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
