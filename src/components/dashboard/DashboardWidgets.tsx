import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useHintDashboard, fmtUsd } from "@/hooks/useHintDashboard";

/* ---------- Shared primitives ---------- */

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground mb-3">
    {children}
  </p>
);

const Card = ({
  className,
  children,
  to,
}: {
  className?: string;
  children: React.ReactNode;
  to?: string;
}) => {
  const base = cn(
    "block bg-card border border-border rounded-lg px-5 py-4 transition-colors",
    to && "hover:border-accent/60 hover:bg-accent/5 cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent/40",
    className,
  );
  if (to) {
    return (
      <Link to={to} className={base} style={{ borderWidth: "0.5px" }}>
        {children}
      </Link>
    );
  }
  return (
    <div className={base} style={{ borderWidth: "0.5px" }}>
      {children}
    </div>
  );
};

const StatLabel = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
    {children}
  </p>
);

const StatValue = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[26px] leading-tight font-medium text-foreground tabular-nums">{children}</p>
);

type BadgeTone = "success" | "destructive" | "warning" | "accent" | "muted";

const tones: Record<BadgeTone, string> = {
  success: "bg-success/10 text-success",
  destructive: "bg-destructive/10 text-destructive",
  warning: "bg-warning/15 text-[hsl(var(--warning))]",
  accent: "bg-accent/10 text-accent",
  muted: "bg-muted text-muted-foreground",
};

const Pill = ({ tone = "muted", children }: { tone?: BadgeTone; children: React.ReactNode }) => (
  <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium", tones[tone])}>
    {children}
  </span>
);

const Sparkline = ({ data, colorVar }: { data: number[]; colorVar: string }) => {
  const max = Math.max(...data, 1);
  return (
    <div className="flex items-end gap-1 h-8 mt-3">
      {data.map((v, i) => (
        <div
          key={i}
          className="flex-1 rounded-sm"
          style={{ height: `${(v / max) * 100}%`, background: `hsl(var(${colorVar}))`, minHeight: 2 }}
        />
      ))}
    </div>
  );
};

/* ---------- Row 1: Patient Activity ---------- */

const PatientActivityRow = () => (
  <section>
    <SectionLabel>Patient Activity</SectionLabel>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Card to="/patients">
        <StatLabel>New Patients (30d)</StatLabel>
        <div className="flex items-baseline justify-between mt-1.5">
          <StatValue>128</StatValue>
          <Pill tone="success">+12.4%</Pill>
        </div>
        <Sparkline data={[4, 7, 5, 9, 6, 11, 14]} colorVar="--accent" />
      </Card>
      <Card to="/care">
        <StatLabel>Appointments This Week</StatLabel>
        <div className="flex items-baseline justify-between mt-1.5">
          <StatValue>87</StatValue>
          <span className="text-[11px] text-muted-foreground">9 upcoming today</span>
        </div>
        <Sparkline data={[10, 12, 9, 14, 11, 15, 16]} colorVar="--success" />
      </Card>
      <Card to="/care">
        <StatLabel>Avg Response Time</StatLabel>
        <div className="flex items-baseline justify-between mt-1.5">
          <StatValue>2.4h</StatValue>
          <Pill tone="success">On target</Pill>
        </div>
        <Sparkline data={[3, 2.5, 3.1, 2.2, 2.8, 2.4, 2.1]} colorVar="--destructive" />
      </Card>
    </div>
  </section>
);

/* ---------- Row 2: Invoices & Billing ---------- */

const InvoiceRow = ({ label, value, tone = "muted" }: { label: string; value: string; tone?: BadgeTone }) => (
  <div className="flex items-center justify-between py-2 border-t border-border/60 first:border-t-0">
    <span className={cn("text-xs", tone === "destructive" ? "text-destructive font-medium" : "text-muted-foreground")}>
      {label}
    </span>
    <span className="text-xs font-medium tabular-nums text-foreground">{value}</span>
  </div>
);

const RevenueBar = ({ label, pct, colorVar }: { label: string; pct: number; colorVar: string }) => (
  <div className="space-y-1">
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground tabular-nums">{pct}%</span>
    </div>
    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: `hsl(var(${colorVar}))` }} />
    </div>
  </div>
);

const InvoicesRow = () => (
  <section>
    <SectionLabel>Invoices &amp; Billing</SectionLabel>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card to="/estimator">
        <div className="flex items-start justify-between">
          <div>
            <StatLabel>Outstanding Invoices</StatLabel>
            <StatValue>$48,620</StatValue>
          </div>
          <Pill tone="warning">23 open</Pill>
        </div>
        <div className="mt-4">
          <InvoiceRow label="Overdue" value="$12,400" tone="destructive" />
          <InvoiceRow label="Due This Week" value="$18,900" />
          <InvoiceRow label="Pending" value="$17,320" />
        </div>
      </Card>
      <Card to="/insights">
        <div className="flex items-start justify-between">
          <div>
            <StatLabel>Revenue (MTD)</StatLabel>
            <StatValue>$214,580</StatValue>
          </div>
          <Pill tone="success">+8.2%</Pill>
        </div>
        <div className="mt-4 space-y-2.5">
          <RevenueBar label="Membership Fees" pct={62} colorVar="--accent" />
          <RevenueBar label="Rx / Services" pct={28} colorVar="--success" />
          <RevenueBar label="Other" pct={10} colorVar="--warning" />
        </div>
      </Card>
    </div>
  </section>
);

/* ---------- Row 3: Care Connect ---------- */

const initials = (name: string) =>
  name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("");

const messages = [
  { name: "Sarah Lin", type: "Refill request", time: "12m ago", status: "Pending", tone: "warning" as BadgeTone },
  { name: "Marcus Reyes", type: "Lab follow-up", time: "1h ago", status: "Open", tone: "accent" as BadgeTone },
  { name: "Priya Patel", type: "Appointment q.", time: "3h ago", status: "Resolved", tone: "success" as BadgeTone },
];

const tasks = [
  { dot: "destructive", text: "Review elevated A1C panel — J. Carter", cat: "Urgent" },
  { dot: "warning", text: "Approve PA for atorvastatin refill", cat: "Review" },
  { dot: "accent", text: "Onboarding call — new VIP member", cat: "Info" },
  { dot: "success", text: "Quarterly wellness check completed", cat: "On track" },
] as const;

const dotColor = (d: string) =>
  ({
    destructive: "bg-destructive",
    warning: "bg-[hsl(var(--warning))]",
    accent: "bg-accent",
    success: "bg-success",
  })[d];

const CareConnectRow = () => (
  <section>
    <SectionLabel>Care Connect</SectionLabel>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card to="/care">
        <div className="flex items-center justify-between mb-3">
          <StatLabel>Recent Messages</StatLabel>
        </div>
        <ul className="space-y-3">
          {messages.map((m) => (
            <li key={m.name} className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[11px] font-semibold">
                {initials(m.name)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{m.name}</p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {m.type} · {m.time}
                </p>
              </div>
              <Pill tone={m.tone}>{m.status}</Pill>
            </li>
          ))}
        </ul>
      </Card>
      <Card to="/care">
        <div className="flex items-center justify-between mb-3">
          <StatLabel>Open Tasks</StatLabel>
        </div>
        <ul className="space-y-2.5">
          {tasks.map((t) => (
            <li key={t.text} className="flex items-center gap-3">
              <span className={cn("h-2 w-2 rounded-full shrink-0", dotColor(t.dot))} />
              <span className="flex-1 text-xs text-foreground truncate">{t.text}</span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground border border-border rounded-full px-2 py-0.5">
                {t.cat}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  </section>
);

/* ---------- Row 4: PrimeCare VIP RX ---------- */

const RxRow = () => (
  <section>
    <SectionLabel>PrimeCare VIP RX</SectionLabel>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Card to="/pharmacy">
        <StatLabel>Active Rx Members</StatLabel>
        <div className="flex items-baseline justify-between mt-1.5">
          <StatValue>1,284</StatValue>
          <Pill tone="success">+3.1%</Pill>
        </div>
      </Card>
      <Card to="/pharmacy/dispense">
        <StatLabel>Refills Pending</StatLabel>
        <div className="flex items-baseline justify-between mt-1.5">
          <StatValue>42</StatValue>
          <Pill tone="warning">8 expiring</Pill>
        </div>
      </Card>
      <Card to="/pharmacy/inventory">
        <StatLabel>Formulary Alerts</StatLabel>
        <div className="flex items-baseline justify-between mt-1.5">
          <StatValue>6</StatValue>
          <Pill tone="destructive">Review</Pill>
        </div>
      </Card>
    </div>
  </section>
);

/* ---------- Export ---------- */

export default function DashboardWidgets() {
  return (
    <div className="space-y-8">
      <PatientActivityRow />
      <InvoicesRow />
      <CareConnectRow />
      <RxRow />
    </div>
  );
}
