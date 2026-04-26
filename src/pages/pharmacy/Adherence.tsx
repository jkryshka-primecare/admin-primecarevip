import { Activity, Target, AlertCircle, Users } from "lucide-react";

const stats = [
  { label: "Avg PDC (90d)", value: "87.3%", icon: Target, tone: "success" },
  { label: "Patients < 80% PDC", value: "42", icon: AlertCircle, tone: "destructive" },
  { label: "Open Interventions", value: "18", icon: Activity, tone: "accent" },
  { label: "Patients Tracked", value: "312", icon: Users, tone: "primary" },
] as const;

const toneClass: Record<string, string> = {
  accent: "text-accent bg-accent/10 border-accent/20",
  success: "text-success bg-success/10 border-success/20",
  primary: "text-primary bg-primary/10 border-primary/20",
  destructive: "text-destructive bg-destructive/10 border-destructive/20",
};

export default function Adherence() {
  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
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
        <Activity className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
        <h2 className="font-serif text-xl text-foreground mb-2">
          Adherence & gap-in-care queue
        </h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          PDC scoring per chronic-disease cohort, gap alerts pulled from claims
          + dispense data, and the clinical intervention queue with
          assignment + outcome tracking.
        </p>
      </section>
    </div>
  );
}
