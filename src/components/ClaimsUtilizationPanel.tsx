import { useState } from "react";
import { Info } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, LabelList, Legend, Cell,
} from "recharts";
import { employerOptions } from "@/components/engagement/mockData";
import { cn } from "@/lib/utils";

const labelClass = "text-[10px] font-bold uppercase tracking-widest text-muted-foreground";

const DateChip = ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
  <div className="flex items-center gap-2 bg-card border border-border rounded-md px-3 py-1.5">
    <span className={labelClass}>{label}:</span>
    <input type="date" value={value} onChange={(e) => onChange(e.target.value)} className="h-7 bg-transparent text-xs font-mono outline-none" />
  </div>
);

const ChipField = ({
  label, value, onChange, options, allLabel,
}: {
  label: string; value: string; onChange: (v: string) => void; options: string[]; allLabel: string;
}) => (
  <div className="flex items-center gap-2 bg-card border border-border rounded-md px-3 py-1.5">
    <span className={labelClass}>{label}:</span>
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-7 border-0 bg-transparent text-xs font-mono px-1 gap-1 focus:ring-0 shadow-none">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="bg-popover">
        <SelectItem value="all">{allLabel}</SelectItem>
        {options.map((opt) => (<SelectItem key={opt} value={opt}>{opt}</SelectItem>))}
      </SelectContent>
    </Select>
  </div>
);

const InfoIcon = ({ text }: { text: string }) => (
  <TooltipProvider delayDuration={150}>
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="inline-flex" aria-label="More info">
          <Info className="size-3.5 text-muted-foreground" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">{text}</TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

const StatCard = ({ title, value, sub, tooltip, selected, onClick }: {
  title: string; value?: string; sub?: string; tooltip?: string;
  selected?: boolean; onClick?: () => void;
}) => (
  <div
    onClick={onClick}
    className={cn(
      "bg-card border rounded-lg shadow-card p-5 min-h-[150px] flex flex-col",
      onClick && "cursor-pointer transition-colors",
      selected ? "border-accent ring-1 ring-accent" : "border-border",
    )}
  >
    <div className="flex items-center gap-2 text-sm text-foreground">
      <span>{title}</span>
      {tooltip && <InfoIcon text={tooltip} />}
    </div>
    <div className="flex-1 flex flex-col justify-end">
      {value ? (
        <p className="font-serif text-3xl text-foreground">{value}</p>
      ) : (
        <p className="text-sm text-muted-foreground">No data available</p>
      )}
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  </div>
);

const ClaimsUtilizationPanel = () => {
  const [start, setStart] = useState("2025-11-01");
  const [end, setEnd] = useState("2026-05-04");
  const [employer, setEmployer] = useState("all");
  const [costMode, setCostMode] = useState<"pmpm" | "total">("pmpm");
  const [highCostView, setHighCostView] = useState<"claims" | "members">("claims");

  const claimsData = [
    { name: "Total Claims Costs", DPC: 0, "Non DPC": 0 },
  ];

  const highCostData = [
    { group: "DPC", pct: 0 },
    { group: "Non DPC", pct: 0 },
  ];

  return (
    <section className="space-y-5">
      <div>
        <h2 className="font-serif text-2xl text-accent tracking-tight">Claims Utilization</h2>
        <div className="mt-3 h-px bg-border" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <DateChip label="Start Date" value={start} onChange={setStart} />
        <DateChip label="End Date" value={end} onChange={setEnd} />
        <ChipField label="Employer" value={employer} onChange={setEmployer} options={employerOptions} allLabel="All Sponsored Patients" />
      </div>

      {/* Patient counts row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <StatCard title="Total Active Patients" tooltip="Total number of active patients across DPC and Non-DPC populations during the selected period." />
        <StatCard title="DPC Patients" tooltip="Number of patients enrolled with a Direct Primary Care provider." />
        <StatCard title="Non DPC Patients" tooltip="Number of patients not enrolled with a Direct Primary Care provider." />
      </div>

      {/* Member months row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <StatCard title="DPC Member Months" tooltip="Total member-months of coverage for DPC patients during the selected period." />
        <StatCard title="Non DPC Member Months" tooltip="Total member-months of coverage for Non-DPC patients during the selected period." />
        <div />
      </div>

      {/* Claims Costs */}
      <div className="bg-card border border-border rounded-lg shadow-card p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Claims Costs - Per Member Per Month</h3>
          <div className="flex items-center gap-5 mt-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="radio" name="costMode" checked={costMode === "pmpm"} onChange={() => setCostMode("pmpm")} className="accent-accent" />
              Per Member Per Month
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="radio" name="costMode" checked={costMode === "total"} onChange={() => setCostMode("total")} className="accent-accent" />
              Total Amount
            </label>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard title="Total Claims Costs" tooltip="Sum of DPC and Non-DPC claims costs for the selected view." />
          <StatCard title="DPC Claims Costs" tooltip="Claims costs attributed to DPC-enrolled patients." />
          <StatCard title="Non DPC Claims Costs" tooltip="Claims costs attributed to Non-DPC patients." />
        </div>

        <div className="pt-2">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart layout="vertical" data={claimsData} margin={{ top: 20, right: 50, left: 80, bottom: 20 }} barGap={4}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
              <XAxis type="number" domain={[0, 4]} tickFormatter={(v) => `$${v}`} stroke="hsl(var(--muted-foreground))" fontSize={11} />
              <YAxis type="category" dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} width={120} />
              <Legend verticalAlign="top" height={36} />
              <Bar dataKey="DPC" fill="hsl(var(--accent))" radius={[0, 4, 4, 0]}>
                <LabelList dataKey="DPC" position="right" formatter={(v: number) => `$${v}`} fill="hsl(var(--accent))" fontSize={11} fontWeight={600} />
              </Bar>
              <Bar dataKey="Non DPC" fill="hsl(38 92% 50%)" radius={[0, 4, 4, 0]}>
                <LabelList dataKey="Non DPC" position="right" formatter={(v: number) => `$${v}`} fill="hsl(38 92% 50%)" fontSize={11} fontWeight={600} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* High Cost Claims */}
      <div className="bg-card border border-border rounded-lg shadow-card p-5 space-y-4">
        <h3 className="text-sm font-semibold text-foreground">High Cost Claims #</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
          <StatCard
            title="High Cost Claims #"
            tooltip="Count of claims considered high cost during the selected period."
            selected={highCostView === "claims"}
            onClick={() => setHighCostView("claims")}
          />
          <StatCard
            title="# of Members with high cost claims"
            tooltip="Count of unique members with at least one high cost claim."
            selected={highCostView === "members"}
            onClick={() => setHighCostView("members")}
          />
        </div>

        <div className="pt-2">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart layout="vertical" data={highCostData} margin={{ top: 20, right: 50, left: 60, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
              <XAxis type="number" domain={[0, 10]} tickFormatter={(v) => `${v}%`} stroke="hsl(var(--muted-foreground))" fontSize={11} />
              <YAxis type="category" dataKey="group" stroke="hsl(var(--muted-foreground))" fontSize={11} width={70} />
              <Bar dataKey="pct" radius={[0, 4, 4, 0]}>
                {highCostData.map((d) => (<Cell key={d.group} fill="hsl(var(--accent))" />))}
                <LabelList dataKey="pct" position="right" formatter={(v: number) => `${v}%`} fill="hsl(var(--accent))" fontSize={11} fontWeight={600} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
};

export default ClaimsUtilizationPanel;
