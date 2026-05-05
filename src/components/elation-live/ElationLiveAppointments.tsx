import { useMemo } from "react";
import { Loader2, AlertCircle, CalendarClock } from "lucide-react";
import { useElationResource } from "@/hooks/useElation";

type ElationAppt = {
  id: number | string;
  patient?: number | string;
  physician?: number | string;
  scheduled_date?: string;
  duration?: number;
  reason?: string;
  description?: string;
  mode?: string;
  status?: { status?: string };
};
type ListResp = { results?: ElationAppt[] };

export default function ElationLiveAppointments({ limit = 50 }: { limit?: number }) {
  const { data, loading, error } = useElationResource<ListResp>("appointments", { limit });
  const appts = data?.results ?? [];

  const stats = useMemo(() => {
    const now = Date.now();
    const upcoming = appts.filter((a) => a.scheduled_date && new Date(a.scheduled_date).getTime() > now).length;
    const video = appts.filter((a) => a.mode === "VIDEO").length;
    const uniquePatients = new Set(appts.map((a) => String(a.patient ?? ""))).size;
    return { total: appts.length, upcoming, video, uniquePatients };
  }, [appts]);

  return (
    <section className="bg-card border border-border rounded-lg shadow-soft">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <CalendarClock className="size-4 text-primary" />
        <h3 className="font-serif text-base">Live Appointments (Elation)</h3>
        <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground">
          {stats.total} · {stats.upcoming} upcoming · {stats.video} video · {stats.uniquePatients} patients
        </span>
      </header>

      {loading && (
        <div className="px-4 py-12 text-center text-muted-foreground text-sm">
          <Loader2 className="size-4 animate-spin inline mr-2" /> Fetching appointments…
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
                <th className="text-left px-4 py-2 font-semibold">Scheduled</th>
                <th className="text-left px-4 py-2 font-semibold">Reason</th>
                <th className="text-left px-4 py-2 font-semibold">Mode</th>
                <th className="text-left px-4 py-2 font-semibold">Status</th>
                <th className="text-left px-4 py-2 font-semibold">Duration</th>
                <th className="text-left px-4 py-2 font-semibold">Patient</th>
              </tr>
            </thead>
            <tbody>
              {appts.map((a) => (
                <tr key={String(a.id)} className="border-t border-border hover:bg-muted/30">
                  <td className="px-4 py-2 font-mono text-xs">
                    {a.scheduled_date ? new Date(a.scheduled_date).toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {a.description || a.reason || "—"}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-muted font-semibold">
                      {a.mode ?? "—"}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs">{a.status?.status ?? "—"}</td>
                  <td className="px-4 py-2 font-mono text-xs">{a.duration ?? 0}m</td>
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{a.patient ?? "—"}</td>
                </tr>
              ))}
              {appts.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                    No appointments returned.
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
