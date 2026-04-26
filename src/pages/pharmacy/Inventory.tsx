import { Package, AlertTriangle, ShieldCheck, TrendingDown } from "lucide-react";

const stats = [
  { label: "SKUs On Hand", value: "1,284", icon: Package, tone: "primary" },
  { label: "Expiring < 90 days", value: "23", icon: AlertTriangle, tone: "warning" },
  { label: "Controlled Substances", value: "47", icon: ShieldCheck, tone: "destructive" },
  { label: "Below Reorder Point", value: "12", icon: TrendingDown, tone: "accent" },
] as const;

const toneClass: Record<string, string> = {
  accent: "text-accent bg-accent/10 border-accent/20",
  warning: "text-warning bg-warning/10 border-warning/20",
  primary: "text-primary bg-primary/10 border-primary/20",
  destructive: "text-destructive bg-destructive/10 border-destructive/20",
};

export default function Inventory() {
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
        <Package className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
        <h2 className="font-serif text-xl text-foreground mb-2">
          Inventory & controlled-substance ledger
        </h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Stock by NDC, lot/expiry tracker, and the DEA-2222 controlled-
          substance audit trail. Pulls from MediScan once the ledger feed
          is wired.
        </p>
      </section>
    </div>
  );
}
