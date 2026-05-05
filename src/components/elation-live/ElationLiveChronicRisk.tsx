import { useMemo } from "react";
import { Loader2, AlertCircle, Activity } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, LabelList, Cell,
} from "recharts";
import { useElationResource } from "@/hooks/useElation";

type ElationProblem = {
  id: number | string;
  patient?: number | string;
  description?: string;
  status?: string;
  rank?: number;
  dx?: { icd10?: string[] }[];
};
type ListResp = { results?: ElationProblem[] };

export default function ElationLiveChronicRisk({ limit = 100 }: { limit?: number }) {
  const { data, loading, error } = useElationResource<ListResp>("problems", { limit });
  const problems = data?.results ?? [];

  const { topConditions, totalPatients, totalActive } = useMemo(() => {
    const counts = new Map<string, { code: string; description: string; count: number }>();
    const patients = new Set<string>();
    let active = 0;
    for (const p of problems) {
      if (p.patient) patients.add(String(p.patient));
      if (p.status?.toLowerCase() === "active") active++;
      const code = p.dx?.[0]?.icd10?.[0];
      if (!code) continue;
      const key = code;
      const existing = counts.get(key);
      if (existing) existing.count++;
      else counts.set(key, { code, description: p.description ?? code, count: 1 });
    }
    const top = Array.from(counts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
      .map((c) => ({
        ...c,
        pct: problems.length === 0 ? 0 : Math.round((c.count / problems.length) * 1000) / 10,
      }));
    return { topConditions: top, totalPatients: patients.size, totalActive: active };
  }, [problems]);

  return (
    <section className="bg-card border border-border rounded-lg shadow-soft">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Activity className="size-4 text-primary" />
        <h3 className="font-serif text-base">Live Chronic Conditions (Elation)</h3>
        <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground">
          {problems.length} problems · {totalPatients} patients · {totalActive} active
        </span>
      </header>

      {loading && (
        <div className="px-4 py-12 text-center text-muted-foreground text-sm">
          <Loader2 className="size-4 animate-spin inline mr-2" /> Aggregating problem list…
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 bg-destructive/5 text-destructive text-sm">
          <AlertCircle className="size-4" /> {error}
        </div>
      )}

      {!loading && !error && topConditions.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-4">
          <div>
            <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-3 font-semibold">
              Top ICD-10 Conditions
            </h4>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart layout="vertical" data={topConditions} margin={{ top: 5, right: 60, left: 10, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis type="number" tickFormatter={(v) => `${v}%`} stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis type="category" dataKey="code" stroke="hsl(var(--muted-foreground))" fontSize={11} width={80} />
                <Bar dataKey="pct" radius={[0, 4, 4, 0]}>
                  {topConditions.map((d) => (
                    <Cell key={d.code} fill="hsl(var(--accent))" />
                  ))}
                  <LabelList dataKey="pct" position="right" formatter={(v: number) => `${v}%`} fill="hsl(var(--accent))" fontSize={11} fontWeight={600} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div>
            <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-3 font-semibold">
              Condition Detail
            </h4>
            <div className="space-y-1 text-sm">
              {topConditions.map((c) => (
                <div key={c.code} className="flex items-start justify-between gap-2 py-1.5 border-b border-border/60">
                  <div>
                    <span className="font-mono text-xs text-accent">{c.code}</span>
                    <div className="text-xs text-foreground/80">{c.description}</div>
                  </div>
                  <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">
                    {c.count}× · {c.pct}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
