import { useState } from "react";
import { Loader2, RefreshCw, Search, AlertCircle, Database } from "lucide-react";
import {
  useElationPatients,
  useElationResource,
  type ElationPatient,
} from "@/hooks/useElation";
import KPICard from "@/components/KPICard";

type ListResp<T> = { results?: T[]; count?: number; total?: number };

export default function ElationLivePanel() {
  const [search, setSearch] = useState("");
  const { patients, loading, error, total, meta, refetch } = useElationPatients({
    search,
    limit: 50,
  });

  // Lightweight count probes for KPIs (limit=1 → API returns total count cheaply)
  const physicians = useElationResource<ListResp<unknown>>("physicians", { limit: 1 });
  const appointments = useElationResource<ListResp<unknown>>("appointments", { limit: 1 });
  const problems = useElationResource<ListResp<unknown>>("problems", { limit: 1 });

  const physCount = physicians.data?.count ?? physicians.data?.total ?? null;
  const apptCount = appointments.data?.count ?? appointments.data?.total ?? null;
  const probCount = problems.data?.count ?? problems.data?.total ?? null;

  return (
    <div className="space-y-5">
      {/* Live KPIs from Elation */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <KPICard
          label="Patients (Elation)"
          value={total !== null ? total.toLocaleString() : loading ? "…" : "—"}
          subtitle="Live from Elation REST"
        />
        <KPICard
          label="Physicians"
          value={physCount !== null ? physCount.toLocaleString() : physicians.loading ? "…" : "—"}
          subtitle={physicians.error ?? "Active providers"}
        />
        <KPICard
          label="Appointments"
          value={apptCount !== null ? apptCount.toLocaleString() : appointments.loading ? "…" : "—"}
          subtitle={appointments.error ?? "All time"}
        />
        <KPICard
          label="Problem List"
          value={probCount !== null ? probCount.toLocaleString() : problems.loading ? "…" : "—"}
          subtitle={problems.error ?? "Diagnoses tracked"}
        />
      </section>

      {/* Patient table */}
      <div className="bg-card border border-border rounded-lg shadow-soft">
        <header className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Database className="size-4 text-primary" />
          <div className="flex-1">
            <h2 className="font-serif text-lg leading-tight">Live Patients</h2>
            <p className="text-xs text-muted-foreground">
              Direct from Elation production · {meta?.elapsedMs ? `${meta.elapsedMs}ms` : ""}
            </p>
          </div>
          <div className="relative">
            <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by last name…"
              className="pl-8 pr-3 py-1.5 text-sm rounded border border-border bg-background w-56 focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <button
            onClick={() => refetch()}
            className="p-1.5 rounded border border-border hover:bg-muted"
            title="Refresh"
          >
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </header>

        {error && (
          <div className="flex items-center gap-2 px-4 py-3 bg-destructive/5 border-b border-destructive/30 text-destructive text-sm">
            <AlertCircle className="size-4" />
            {error}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2 font-semibold">Patient ID</th>
                <th className="text-left px-4 py-2 font-semibold">Name</th>
                <th className="text-left px-4 py-2 font-semibold">DOB</th>
                <th className="text-left px-4 py-2 font-semibold">Sex</th>
                <th className="text-left px-4 py-2 font-semibold">Email</th>
                <th className="text-left px-4 py-2 font-semibold">Phone</th>
                <th className="text-left px-4 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && patients.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                    <Loader2 className="size-4 animate-spin inline mr-2" />
                    Fetching live data from Elation…
                  </td>
                </tr>
              )}
              {!loading && patients.length === 0 && !error && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                    No patients returned.
                  </td>
                </tr>
              )}
              {patients.map((p: ElationPatient) => (
                <tr key={String(p.id)} className="border-t border-border hover:bg-muted/30">
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{p.id}</td>
                  <td className="px-4 py-2 font-medium">
                    {[p.last_name, p.first_name].filter(Boolean).join(", ") || "—"}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{p.dob ?? "—"}</td>
                  <td className="px-4 py-2">{p.sex ?? "—"}</td>
                  <td className="px-4 py-2 text-xs">{p.email ?? "—"}</td>
                  <td className="px-4 py-2 font-mono text-xs">
                    {p.cell_phone ?? p.home_phone ?? "—"}
                  </td>
                  <td className="px-4 py-2">
                    <span className="text-xs uppercase tracking-wider font-semibold">
                      {p.status ?? "—"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
