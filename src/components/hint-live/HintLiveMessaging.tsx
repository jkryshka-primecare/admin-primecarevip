import { useMemo } from "react";
import { Loader2, AlertCircle, MessageSquare, Mail, Phone } from "lucide-react";
import { useHintResource, extractHintList } from "@/hooks/useHintResource";

export default function HintLiveMessaging({ limit = 200 }: { limit?: number }) {
  const { data, loading, error } = useHintResource("patients", { limit });
  const patients = extractHintList(data);

  const stats = useMemo(() => {
    let withEmail = 0;
    let withCell = 0;
    let consented = 0;
    for (const p of patients) {
      if (p.email) withEmail += 1;
      const phones = Array.isArray(p.phones) ? p.phones : [];
      if (p.cell_phone || phones.some((ph: any) => ph.type === "mobile")) withCell += 1;
      if (p.electronic_communication_consent_accepted) consented += 1;
    }
    const total = patients.length || 1;
    return {
      total: patients.length,
      withEmail,
      withCell,
      consented,
      emailPct: Math.round((withEmail / total) * 100),
      cellPct: Math.round((withCell / total) * 100),
      consentPct: Math.round((consented / total) * 100),
    };
  }, [patients]);

  return (
    <section className="bg-card border border-border rounded-lg shadow-soft">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <MessageSquare className="size-4 text-primary" />
        <h3 className="font-serif text-base">Live Messaging Reach (Hint)</h3>
        <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground">
          {stats.total} patients sampled
        </span>
      </header>
      {loading && (
        <div className="px-4 py-12 text-center text-muted-foreground text-sm">
          <Loader2 className="size-4 animate-spin inline mr-2" /> Fetching patient contact data…
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 bg-destructive/5 text-destructive text-sm">
          <AlertCircle className="size-4" /> {error}
        </div>
      )}
      {!loading && !error && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4">
          <Tile icon={<Mail className="size-4" />} label="Email Reachable" value={`${stats.withEmail}`} pct={stats.emailPct} />
          <Tile icon={<Phone className="size-4" />} label="SMS Reachable" value={`${stats.withCell}`} pct={stats.cellPct} />
          <Tile icon={<MessageSquare className="size-4" />} label="E-Comm Consented" value={`${stats.consented}`} pct={stats.consentPct} />
        </div>
      )}
    </section>
  );
}

function Tile({ icon, label, value, pct }: { icon: React.ReactNode; label: string; value: string; pct: number }) {
  return (
    <div className="border border-border rounded-md p-4 bg-background">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-2xl font-serif">{value}</div>
      <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <div className="text-xs text-muted-foreground mt-1">{pct}% of cohort</div>
    </div>
  );
}
