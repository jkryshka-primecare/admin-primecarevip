import { Loader2, AlertCircle, Users, UserCheck, CreditCard } from "lucide-react";
import { useHintResource, extractHintList } from "@/hooks/useHintResource";

export default function HintLiveEngagement({ limit = 100 }: { limit?: number }) {
  const patients = useHintResource("patients", { limit });
  const memberships = useHintResource("memberships", { limit });

  const loading = patients.loading || memberships.loading;
  const error = patients.error || memberships.error;

  const memList = extractHintList(memberships.data);
  const patList = extractHintList(patients.data);
  const activeMembers = memList.filter((m: any) => m.enrollment_status === "active").length;
  const totalMembers = memberships.total ?? memList.length;
  const totalPatients = patients.total ?? patList.length;
  const engagementRate = totalPatients ? Math.round((activeMembers / totalPatients) * 100) : 0;

  return (
    <section className="bg-card border border-border rounded-lg shadow-soft">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <UserCheck className="size-4 text-primary" />
        <h3 className="font-serif text-base">Live Engagement (Hint)</h3>
        <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground">
          Practice DPC platform
        </span>
      </header>
      {loading && (
        <div className="px-4 py-12 text-center text-muted-foreground text-sm">
          <Loader2 className="size-4 animate-spin inline mr-2" /> Fetching from Hint…
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 bg-destructive/5 text-destructive text-sm">
          <AlertCircle className="size-4" /> {error}
        </div>
      )}
      {!loading && !error && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4">
          <Tile icon={<Users className="size-4" />} label="Total Patients" value={String(totalPatients)} />
          <Tile icon={<UserCheck className="size-4" />} label="Active Memberships" value={`${activeMembers} / ${totalMembers}`} />
          <Tile icon={<CreditCard className="size-4" />} label="Engagement Rate" value={`${engagementRate}%`} />
        </div>
      )}
    </section>
  );
}

function Tile({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="border border-border rounded-md p-4 bg-background">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-2xl font-serif">{value}</div>
    </div>
  );
}
