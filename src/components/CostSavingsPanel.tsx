import { useState, useMemo } from "react";
import { Info } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, LabelList, Cell,
} from "recharts";
import { employerOptions, physicianOptions, dpcOptions } from "@/components/engagement/mockData";

const labelClass = "text-[10px] font-bold uppercase tracking-widest text-muted-foreground";

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
        {options.map((opt) => (
          <SelectItem key={opt} value={opt}>{opt}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
);

const DateChip = ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
  <div className="flex items-center gap-2 bg-card border border-border rounded-md px-3 py-1.5">
    <span className={labelClass}>{label}:</span>
    <input
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 bg-transparent text-xs font-mono outline-none"
    />
  </div>
);

const StatCard = ({ title, value, sub }: { title: string; value: string; sub: string }) => (
  <div className="bg-card border border-border rounded-lg shadow-card p-5">
    <div className="flex items-center gap-2 text-sm text-foreground">
      <span>{title}</span>
      <Info className="size-3.5 text-muted-foreground" />
    </div>
    <p className="font-serif text-3xl text-foreground mt-4">{value}</p>
    <p className="text-xs text-muted-foreground mt-1">{sub}</p>
  </div>
);

const CostSavingsPanel = () => {
  const [start, setStart] = useState("2025-11-01");
  const [end, setEnd] = useState("2026-05-04");
  const [employer, setEmployer] = useState("all");
  const [dpc, setDpc] = useState("all");
  const [physician, setPhysician] = useState("all");
  const [erPct, setErPct] = useState(24);
  const [ucPct, setUcPct] = useState(30);

  const erFullValue = 240000;
  const ucFullValue = 130000;
  const lowCostLabs = 111895;
  const employerInvestment = 30669;

  const data = useMemo(() => {
    const erUcAvoided = Math.round(erFullValue * (erPct / 100) + ucFullValue * (ucPct / 100));
    const totalValue = erUcAvoided + lowCostLabs;
    const totalSavings = totalValue - employerInvestment;
    return {
      erUcAvoided,
      lowCostLabs,
      totalValue,
      employerInvestment,
      totalSavings,
      chart: [
        { name: "ER & UC avoided", value: erUcAvoided, color: "hsl(var(--accent))" },
        { name: "Low Cost Labs",   value: lowCostLabs, color: "hsl(var(--accent))" },
        { name: "Total Value",     value: totalValue, color: "hsl(var(--accent))" },
        { name: "Employer Inv.",   value: employerInvestment, color: "hsl(320 70% 55%)" },
        { name: "Total Savings",   value: totalSavings, color: "hsl(var(--success))" },
      ],
    };
  }, [erPct, ucPct]);

  const fmt = (n: number) => `$${n.toLocaleString()}`;

  return (
    <section className="space-y-5">
      <div>
        <h2 className="font-serif text-2xl text-accent tracking-tight">Cost Savings</h2>
        <div className="mt-3 h-px bg-border" />
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        <DateChip label="Start Date" value={start} onChange={setStart} />
        <DateChip label="End Date" value={end} onChange={setEnd} />
        <ChipField label="Employer" value={employer} onChange={setEmployer} options={employerOptions} allLabel="All Sponsored Patients" />
        <ChipField label="DPC" value={dpc} onChange={setDpc} options={dpcOptions} allLabel="All DPCs" />
        <ChipField label="Physician" value={physician} onChange={setPhysician} options={physicianOptions} allLabel="All Physicians" />
      </div>

      {/* Sliders */}
      <div className="space-y-3 max-w-2xl">
        <p className="text-sm text-foreground flex items-center gap-2">
          Select % of after hours encounters potentially avoidable as Emergency room (ER) and Urgent Care (UC) visits.
          <Info className="size-3.5 text-muted-foreground" />
        </p>
        <SliderRow label="ER avoided" value={erPct} onChange={setErPct} />
        <SliderRow label="UC avoided" value={ucPct} onChange={setUcPct} />
      </div>

      {/* Total Savings + Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">
        <div className="bg-card border border-border rounded-lg shadow-card p-5">
          <div className="flex items-center gap-2 text-sm text-foreground">
            <span>Total Savings</span>
            <Info className="size-3.5 text-muted-foreground ml-auto" />
          </div>
          <p className="font-serif text-3xl text-success mt-6">$ {data.totalSavings.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground mt-2">Difference between value and investment.</p>
        </div>

        <div className="bg-card border border-border rounded-lg shadow-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">Overview</h3>
          <div className="relative">
            <span className="absolute -left-1 top-1/2 -translate-y-1/2 -rotate-90 text-[10px] uppercase tracking-wider text-muted-foreground origin-center whitespace-nowrap">
              Cost Savings
            </span>
            <ResponsiveContainer width="100%" height={360}>
              <BarChart data={data.chart} margin={{ top: 20, right: 30, left: 20, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`} stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {data.chart.map((d) => (
                    <Cell key={d.name} fill={d.color} />
                  ))}
                  <LabelList dataKey="value" position="top" formatter={(v: number) => fmt(v)} fill="hsl(var(--accent))" fontSize={11} fontWeight={600} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <p className="text-center text-xs text-muted-foreground mt-1">Service Type</p>
          </div>
        </div>
      </div>

      {/* Methodology */}
      <div className="bg-card border border-border rounded-lg shadow-card p-5">
        <ul className="text-sm text-foreground space-y-2 list-disc pl-5">
          <li><strong>Savings</strong> are based on encounter counts, CPT codes, and fee-for-service rates from DPC locations.</li>
          <li><strong>Procedure pricing</strong> uses Healthcare Bluebook or CMS fee schedules.</li>
          <li><strong>Fallback CPT:</strong> Defaults to 99215 (in-person) or 99443 (telemed/chat) if code is unavailable.</li>
          <li><strong>Assumes 20% ER and 30% UC</strong> visit avoidance (adjustable via sliders).</li>
          <li><strong>ER/pricing data</strong> from Healthcare Bluebook.</li>
          <li><strong>Employer Investment</strong> = Monthly rate x active adult/dependent members at month-end.</li>
          <li><strong>Total Savings</strong> = Total Value - Employer Investment.</li>
        </ul>
      </div>

      {/* Encounter stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <StatCard title="Total # Encounters" value="1215" sub="Total encounters during selected timeframe." />
        <StatCard title="Encounter Types - Breakdown" value="1215" sub="In-Person" />
        <StatCard title="Total # After Hours Encounters" value="371" sub="Total encounters after hours and weekends." />
      </div>
    </section>
  );
};

const SliderRow = ({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) => (
  <div className="flex items-center gap-4">
    <span className="text-sm text-foreground w-24 shrink-0">{label}</span>
    <span className="text-sm font-mono text-accent w-12 shrink-0">{value}%</span>
    <Slider
      value={[value]}
      min={0}
      max={100}
      step={1}
      onValueChange={([v]) => onChange(v)}
      className="flex-1 max-w-md"
    />
  </div>
);

export default CostSavingsPanel;
