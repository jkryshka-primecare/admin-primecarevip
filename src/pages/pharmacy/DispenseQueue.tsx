import { ClipboardList, Clock, CheckCircle2, AlertTriangle } from "lucide-react";

const queueStats = [
  { label: "In Verification", value: "14", icon: Clock, tone: "accent" },
  { label: "Ready for Pickup", value: "47", icon: CheckCircle2, tone: "success" },
  { label: "Awaiting Counseling", value: "6", icon: AlertTriangle, tone: "warning" },
  { label: "Filled Today", value: "183", icon: ClipboardList, tone: "primary" },
] as const;

const toneClass: Record<string, string> = {
  accent: "text-accent bg-accent/10 border-accent/20",
  success: "text-success bg-success/10 border-success/20",
  warning: "text-warning bg-warning/10 border-warning/20",
  primary: "text-primary bg-primary/10 border-primary/20",
};

export default function DispenseQueue() {
  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {queueStats.map((s) => (
          <div
            key={s.label}
            className="rounded-2xl bg-card border border-border p-5 shadow-soft"
          >
            <div
              className={`inline-flex items-center justify-center h-9 w-9 rounded-lg border ${toneClass[s.tone]} mb-3`}
            >
              <s.icon className="h-4 w-4" />
            </div>
            <p className="text-3xl font-mono font-light text-foreground">
              {s.value}
            </p>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mt-1">
              {s.label}
            </p>
          </div>
        ))}
      </section>

      <section className="rounded-2xl bg-card border border-border p-8 shadow-soft text-center">
        <ClipboardList className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
        <h2 className="font-serif text-xl text-foreground mb-2">
          Live dispense pipeline
        </h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Wire to MediScan Dispense once the read endpoint is exposed. Will
          show in-progress scripts with technician, drug, lot, and verification
          state.
        </p>
      </section>
    </div>
  );
}
