import { useState } from "react";
import { Info, Filter, Download, Share2, Check } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { employerOptions, physicianOptions, dpcOptions } from "@/components/engagement/mockData";
import { cn } from "@/lib/utils";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, LabelList, Cell,
} from "recharts";

const labelClass = "text-[10px] font-bold uppercase tracking-widest text-muted-foreground";

const SelectField = ({
  label, value, onChange, options, allLabel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  allLabel: string;
}) => (
  <div className="flex items-center gap-2 bg-secondary border border-border rounded-md px-3 py-1.5">
    <span className={labelClass}>{label}:</span>
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-7 border-0 bg-transparent text-xs font-mono px-1 gap-1 focus:ring-0 shadow-none">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="bg-popover">
        <SelectItem value="all">{allLabel}</SelectItem>
        {options.map((opt) => (
          <SelectItem key={opt} value={opt}>{opt}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
);

type SubTab = "active" | "encounters";

const topConditions = [
  { code: "E78.5", pct: 18.9 },
  { code: "I10",   pct: 7.8 },
  { code: "E55.9", pct: 7.0 },
  { code: "F41.1", pct: 6.4 },
  { code: "I25.10", pct: 4.7 },
];

const distribution = [
  { type: "No Comorbidity",     pct: 4.9,  color: "hsl(38 92% 55%)" },
  { type: "Comorbidity",        pct: 10.2, color: "hsl(28 85% 50%)" },
  { type: "Low Multimorbidity", pct: 6.4,  color: "hsl(20 70% 42%)" },
  { type: "High Multimorbidity",pct: 16.0, color: "hsl(18 55% 30%)" },
];

const ChronicRiskPanel = () => {
  const [sub, setSub] = useState<SubTab>("active");
  const [employer, setEmployer] = useState("all");
  const [dpc, setDpc] = useState("all");
  const [physician, setPhysician] = useState("Jarrod Frydman");

  return (
    <section className="space-y-5">
      <div>
        <h2 className="font-serif text-2xl text-accent tracking-tight">Chronic Risk</h2>
        <div className="mt-3 h-px bg-border" />
      </div>

      {/* Sub-tab toggle row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-sm text-accent font-medium">Calculate Chronic Risk By</span>
          <div className="flex gap-2">
            <button
              onClick={() => setSub("active")}
              className={cn(
                "px-4 py-2 rounded-md text-sm font-medium border transition-colors flex items-center gap-2",
                sub === "active"
                  ? "bg-accent/10 text-accent border-accent"
                  : "bg-secondary text-muted-foreground border-border hover:text-foreground",
              )}
            >
              {sub === "active" && <Check className="size-3.5" />}
              Total Active Patients
            </button>
            <button
              onClick={() => setSub("encounters")}
              className={cn(
                "px-4 py-2 rounded-md text-sm font-medium border transition-colors flex items-center gap-2",
                sub === "encounters"
                  ? "bg-accent/10 text-accent border-accent"
                  : "bg-secondary text-muted-foreground border-border hover:text-foreground",
              )}
            >
              {sub === "encounters" && <Check className="size-3.5" />}
              Patients with Encounter(s)
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-2 text-xs">
            <Filter className="size-3.5" /> Filters
          </Button>
          <Button variant="outline" size="sm" className="px-2">
            <Download className="size-3.5" />
          </Button>
          <Button variant="outline" size="sm" className="px-2">
            <Share2 className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        <SelectField label="Employer" value={employer} onChange={setEmployer} options={employerOptions} allLabel="All Sponsored Patients" />
        <SelectField label="DPC" value={dpc} onChange={setDpc} options={dpcOptions} allLabel="All DPCs" />
        <SelectField label="Physician" value={physician} onChange={setPhysician} options={physicianOptions} allLabel="All Physicians" />
      </div>

      {sub === "active" ? <ActiveView /> : <EncountersView />}
    </section>
  );
};

const ActiveView = () => (
  <>
    <div className="bg-card border border-border rounded-lg shadow-card p-5 max-w-xs">
      <div className="flex items-center gap-2 text-sm text-foreground">
        <span>Chronic Condition Patients</span>
        <Info className="size-3.5 text-muted-foreground" />
      </div>
      <p className="mt-3">
        <span className="font-serif text-3xl text-foreground">129</span>
        <span className="ml-2 text-sm text-muted-foreground">(37.5%)</span>
      </p>
      <p className="text-xs text-muted-foreground mt-1">
        Total Active Patients: <span className="text-foreground font-medium">344</span>
      </p>
    </div>

    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <ChartCard title="Top Chronic Conditions" yLabel="Chronic Condition" xLabel="Percentage of Active Patients">
        <ResponsiveContainer width="100%" height={320}>
          <BarChart layout="vertical" data={topConditions} margin={{ top: 10, right: 50, left: 20, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
            <XAxis type="number" tickFormatter={(v) => `${v}%`} stroke="hsl(var(--muted-foreground))" fontSize={11} />
            <YAxis type="category" dataKey="code" stroke="hsl(var(--muted-foreground))" fontSize={11} width={60} />
            <Bar dataKey="pct" fill="hsl(var(--accent))" radius={[0, 4, 4, 0]}>
              <LabelList dataKey="pct" position="right" formatter={(v: number) => `${v}%`} fill="hsl(var(--accent))" fontSize={11} fontWeight={600} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Chronic Condition Distribution" yLabel="Condition Type" xLabel="Percentage of Active Patients">
        <ResponsiveContainer width="100%" height={320}>
          <BarChart layout="vertical" data={distribution} margin={{ top: 10, right: 50, left: 20, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
            <XAxis type="number" tickFormatter={(v) => `${v}%`} stroke="hsl(var(--muted-foreground))" fontSize={11} />
            <YAxis type="category" dataKey="type" stroke="hsl(var(--muted-foreground))" fontSize={11} width={140} />
            <Bar dataKey="pct" radius={[0, 4, 4, 0]}>
              {distribution.map((d) => (
                <Cell key={d.type} fill={d.color} />
              ))}
              <LabelList dataKey="pct" position="right" formatter={(v: number) => `${v}%`} fill="hsl(var(--accent))" fontSize={11} fontWeight={600} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>

    {/* Patient detail table */}
    <div className="bg-card border border-border rounded-lg shadow-card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-secondary text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="text-left px-4 py-3 font-semibold">Patient ID</th>
            <th className="text-left px-4 py-3 font-semibold">Patient Name</th>
            <th className="text-left px-4 py-3 font-semibold">Medical Condition</th>
            <th className="text-left px-4 py-3 font-semibold">Employer</th>
            <th className="text-left px-4 py-3 font-semibold">DPC</th>
            <th className="text-left px-4 py-3 font-semibold">Physician</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={6} className="text-center text-sm text-muted-foreground py-6 italic">
              Click a bar or label to show or hide patient details.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </>
);

const EncountersView = () => (
  <div className="bg-card border border-border rounded-lg shadow-card p-8 text-center text-sm text-muted-foreground">
    Patients with Encounter(s) view coming soon.
  </div>
);

const ChartCard = ({
  title, yLabel, xLabel, children,
}: { title: string; yLabel: string; xLabel: string; children: React.ReactNode }) => (
  <div className="bg-card border border-border rounded-lg shadow-card p-5">
    <h3 className="text-sm font-semibold text-foreground mb-4">{title}</h3>
    <div className="relative">
      <span className="absolute -left-1 top-1/2 -translate-y-1/2 -rotate-90 text-[10px] uppercase tracking-wider text-muted-foreground origin-center whitespace-nowrap">
        {yLabel}
      </span>
      {children}
      <p className="text-center text-[10px] uppercase tracking-wider text-muted-foreground mt-1">{xLabel}</p>
    </div>
  </div>
);

export default ChronicRiskPanel;
