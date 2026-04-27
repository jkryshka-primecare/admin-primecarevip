import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Users,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Clock,
  Calendar,
  Wallet,
  AlertCircle,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const STATUS_COLORS: Record<string, string> = {
  present: "hsl(var(--success))",
  late: "hsl(var(--warning))",
  absent: "hsl(var(--destructive))",
  remote: "hsl(var(--primary))",
  sick: "hsl(var(--accent))",
  holiday: "hsl(var(--muted-foreground))",
};

function StatTile({
  icon: Icon,
  label,
  value,
  hint,
  tone = "default",
}: {
  icon: typeof Users;
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "success" | "warning" | "destructive";
}) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "destructive"
          ? "text-destructive"
          : "text-foreground";
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <p className={`mt-2 font-mono text-2xl ${toneClass}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}

export default function HrReports() {
  const year = new Date().getFullYear();
  const [windowDays, setWindowDays] = useState(30);

  const since = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - windowDays);
    return d.toISOString().split("T")[0];
  }, [windowDays]);

  const { data: employees = [] } = useQuery({
    queryKey: ["hr", "rpt-employees"],
    queryFn: async () => {
      const { data } = await supabase
        .from("hr_employees")
        .select(
          "id, first_name, last_name, employment_status, hire_date, termination_date, salary, department_id, hr_departments(name)",
        );
      return data ?? [];
    },
  });

  const { data: payroll = [] } = useQuery({
    queryKey: ["hr", "rpt-payroll", year],
    queryFn: async () => {
      const { data } = await supabase
        .from("hr_payroll_records")
        .select("gross_pay, net_pay, taxes, deductions, period_start, status")
        .gte("period_start", `${year}-01-01`)
        .lte("period_start", `${year}-12-31`);
      return data ?? [];
    },
  });

  const { data: attendance = [] } = useQuery({
    queryKey: ["hr", "rpt-attendance", since],
    queryFn: async () => {
      const { data } = await supabase
        .from("hr_attendance_records")
        .select("status, hours_worked, date")
        .gte("date", since);
      return data ?? [];
    },
  });

  const { data: timeoff = [] } = useQuery({
    queryKey: ["hr", "rpt-timeoff", year],
    queryFn: async () => {
      const { data } = await supabase
        .from("hr_time_off_requests")
        .select("type, days, status, start_date")
        .gte("start_date", `${year}-01-01`);
      return data ?? [];
    },
  });

  const { data: balances = [] } = useQuery({
    queryKey: ["hr", "rpt-balances", year],
    queryFn: async () => {
      const { data } = await supabase
        .from("hr_pto_balances")
        .select("type, accrued_days, used_days, carryover_days")
        .eq("year", year);
      return data ?? [];
    },
  });

  // ── Headcount & turnover ─────────────────────────────────────────
  const headcount = useMemo(() => {
    const active = employees.filter((e) => e.employment_status === "active").length;
    const onLeave = employees.filter((e) => e.employment_status === "on_leave").length;
    const terminated = employees.filter(
      (e) => e.employment_status === "terminated",
    ).length;
    const startOfYear = new Date(year, 0, 1);
    const newHires = employees.filter(
      (e) => e.hire_date && new Date(e.hire_date) >= startOfYear,
    ).length;
    const terminatedYtd = employees.filter(
      (e) => e.termination_date && new Date(e.termination_date) >= startOfYear,
    ).length;
    const turnoverPct = active > 0 ? (terminatedYtd / active) * 100 : 0;
    return { active, onLeave, terminated, newHires, terminatedYtd, turnoverPct };
  }, [employees, year]);

  const headcountByDept = useMemo(() => {
    const m: Record<string, number> = {};
    employees
      .filter((e) => e.employment_status === "active")
      .forEach((e: any) => {
        const name = e.hr_departments?.name ?? "Unassigned";
        m[name] = (m[name] ?? 0) + 1;
      });
    return Object.entries(m)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [employees]);

  // ── Payroll ──────────────────────────────────────────────────────
  const payrollTotals = useMemo(() => {
    const gross = payroll.reduce((s, p) => s + Number(p.gross_pay ?? 0), 0);
    const net = payroll.reduce((s, p) => s + Number(p.net_pay ?? 0), 0);
    const taxes = payroll.reduce((s, p) => s + Number(p.taxes ?? 0), 0);
    const deductions = payroll.reduce((s, p) => s + Number(p.deductions ?? 0), 0);
    return { gross, net, taxes, deductions, count: payroll.length };
  }, [payroll]);

  const payrollByMonth = useMemo(() => {
    const months: Record<string, number> = {};
    for (let m = 0; m < 12; m++) {
      const key = new Date(year, m, 1).toLocaleString("en-US", { month: "short" });
      months[key] = 0;
    }
    payroll.forEach((p) => {
      const key = new Date(p.period_start).toLocaleString("en-US", { month: "short" });
      months[key] = (months[key] ?? 0) + Number(p.gross_pay ?? 0);
    });
    return Object.entries(months).map(([month, gross]) => ({ month, gross }));
  }, [payroll, year]);

  // ── Attendance ───────────────────────────────────────────────────
  const attendanceStats = useMemo(() => {
    const total = attendance.length;
    const counts: Record<string, number> = {};
    let hours = 0;
    attendance.forEach((a) => {
      counts[a.status] = (counts[a.status] ?? 0) + 1;
      hours += Number(a.hours_worked ?? 0);
    });
    const presentLike = (counts.present ?? 0) + (counts.remote ?? 0);
    const pct = total > 0 ? (presentLike / total) * 100 : 0;
    return { total, counts, hours, pct };
  }, [attendance]);

  const attendancePie = useMemo(
    () =>
      Object.entries(attendanceStats.counts).map(([status, value]) => ({
        name: status,
        value,
      })),
    [attendanceStats],
  );

  // ── Time off ─────────────────────────────────────────────────────
  const timeoffStats = useMemo(() => {
    const pending = timeoff.filter((r) => r.status === "pending").length;
    const approved = timeoff.filter((r) => r.status === "approved");
    const approvedDays = approved.reduce((s, r) => s + Number(r.days ?? 0), 0);
    const byType: Record<string, number> = {};
    approved.forEach((r: any) => {
      byType[r.type] = (byType[r.type] ?? 0) + Number(r.days ?? 0);
    });
    return { pending, approvedDays, byType };
  }, [timeoff]);

  const ptoTotals = useMemo(() => {
    const accrued = balances.reduce(
      (s, b) => s + Number(b.accrued_days) + Number(b.carryover_days),
      0,
    );
    const used = balances.reduce((s, b) => s + Number(b.used_days), 0);
    return { accrued, used, remaining: accrued - used };
  }, [balances]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-serif text-2xl text-foreground">Reports & Analytics</h2>
          <p className="text-sm text-muted-foreground">
            Workforce, payroll, attendance, and PTO at a glance.
          </p>
        </div>
        <Select value={String(windowDays)} onValueChange={(v) => setWindowDays(parseInt(v))}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
            <SelectItem value="365">Last 12 months</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Headcount */}
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Headcount
        </h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile icon={Users} label="Active" value={String(headcount.active)} />
          <StatTile
            icon={AlertCircle}
            label="On Leave"
            value={String(headcount.onLeave)}
            tone="warning"
          />
          <StatTile
            icon={TrendingUp}
            label={`New Hires (${year})`}
            value={String(headcount.newHires)}
            tone="success"
          />
          <StatTile
            icon={TrendingDown}
            label="Turnover YTD"
            value={`${fmt.format(headcount.turnoverPct)}%`}
            hint={`${headcount.terminatedYtd} terminated`}
            tone={headcount.turnoverPct > 15 ? "destructive" : "default"}
          />
        </div>
        {headcountByDept.length > 0 && (
          <Card className="p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
              Headcount by Department
            </p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={headcountByDept}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        )}
      </section>

      {/* Payroll */}
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Payroll · {year}
        </h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile
            icon={DollarSign}
            label="Gross YTD"
            value={usd.format(payrollTotals.gross)}
            hint={`${payrollTotals.count} runs`}
          />
          <StatTile
            icon={DollarSign}
            label="Net YTD"
            value={usd.format(payrollTotals.net)}
            tone="success"
          />
          <StatTile icon={DollarSign} label="Taxes" value={usd.format(payrollTotals.taxes)} />
          <StatTile
            icon={DollarSign}
            label="Deductions"
            value={usd.format(payrollTotals.deductions)}
          />
        </div>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
            Gross Pay by Month
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={payrollByMonth}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip
                formatter={(v: number) => usd.format(v)}
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 6,
                  fontSize: 12,
                }}
              />
              <Bar dataKey="gross" fill="hsl(var(--accent))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </section>

      {/* Attendance */}
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Attendance · last {windowDays} days
        </h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile
            icon={Clock}
            label="Attendance %"
            value={`${fmt.format(attendanceStats.pct)}%`}
            tone={attendanceStats.pct >= 90 ? "success" : "warning"}
          />
          <StatTile
            icon={Clock}
            label="Total Hours"
            value={fmt.format(attendanceStats.hours)}
          />
          <StatTile
            icon={AlertCircle}
            label="Late"
            value={String(attendanceStats.counts.late ?? 0)}
            tone="warning"
          />
          <StatTile
            icon={AlertCircle}
            label="Absent"
            value={String(attendanceStats.counts.absent ?? 0)}
            tone="destructive"
          />
        </div>
        {attendancePie.length > 0 && (
          <Card className="p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
              Status Breakdown
            </p>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={attendancePie}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={90}
                  paddingAngle={2}
                >
                  {attendancePie.map((entry) => (
                    <Cell
                      key={entry.name}
                      fill={STATUS_COLORS[entry.name] ?? "hsl(var(--muted))"}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </Card>
        )}
      </section>

      {/* Time off & PTO */}
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Time Off & PTO · {year}
        </h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile
            icon={Calendar}
            label="Pending Requests"
            value={String(timeoffStats.pending)}
            tone={timeoffStats.pending > 0 ? "warning" : "default"}
          />
          <StatTile
            icon={Calendar}
            label="Approved Days YTD"
            value={fmt.format(timeoffStats.approvedDays)}
          />
          <StatTile
            icon={Wallet}
            label="PTO Remaining"
            value={fmt.format(ptoTotals.remaining)}
            tone="success"
          />
          <StatTile
            icon={Wallet}
            label="PTO Used"
            value={fmt.format(ptoTotals.used)}
            hint={`${fmt.format(ptoTotals.accrued)} accrued`}
          />
        </div>
        {Object.keys(timeoffStats.byType).length > 0 && (
          <Card className="p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
              Approved Days by Type
            </p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={Object.entries(timeoffStats.byType).map(([type, days]) => ({
                  type: type.replace("_", " "),
                  days,
                }))}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="type"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="days" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        )}
      </section>
    </div>
  );
}
