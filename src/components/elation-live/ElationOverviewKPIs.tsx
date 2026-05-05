import { useElationResource } from "@/hooks/useElation";
import KPICard from "@/components/KPICard";

type ListResp = { results?: unknown[]; count?: number; total?: number };

function num(r: { data: ListResp | null }): string {
  if (!r.data) return "…";
  const c = r.data.count ?? r.data.total ?? r.data.results?.length;
  return typeof c === "number" ? c.toLocaleString() : "—";
}

export default function ElationOverviewKPIs() {
  const patients = useElationResource<ListResp>("patients", { limit: 1 });
  const physicians = useElationResource<ListResp>("physicians", { limit: 1 });
  const appointments = useElationResource<ListResp>("appointments", { limit: 1 });
  const problems = useElationResource<ListResp>("problems", { limit: 1 });

  return (
    <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
      <KPICard label="Patients (Elation Live)" value={num(patients)} subtitle={patients.error ?? "Production roster"} />
      <KPICard label="Physicians" value={num(physicians)} subtitle={physicians.error ?? "Active providers"} />
      <KPICard label="Appointments" value={num(appointments)} subtitle={appointments.error ?? "All time scheduled"} />
      <KPICard label="Problem List" value={num(problems)} subtitle={problems.error ?? "Diagnoses tracked"} />
    </section>
  );
}
