import { useState } from "react";
import { Info, Filter, Download, Share2, Check } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet";
import { toast } from "@/hooks/use-toast";
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

const conditionNames: Record<string, string> = {
  "E78.5": "Hyperlipidemia, unspecified",
  "I10": "Essential (primary) hypertension",
  "E55.9": "Vitamin D deficiency, unspecified",
  "F41.1": "Generalized anxiety disorder",
  "I25.10": "Atherosclerotic heart disease",
  "K21.9": "Gastro-esophageal reflux disease",
  "F90.9": "Attention-deficit hyperactivity disorder",
};

const samplePatients = [
  { id: "1003914548084737", name: "Eric Gutmann",     employer: "Prime Care VIP Health - Retail", dpc: "Mind And Mobility",          physician: "Michael Kieffer" },
  { id: "1005972506542081", name: "Danielle Fingal",  employer: "Prime Care VIP Health - Retail", dpc: "Persona Healthcare Direct",  physician: "Jarrod Frydman" },
  { id: "1015095268802561", name: "Kenneth Dixon",    employer: "Aligned Marketplace",            dpc: "KD Nutra",                    physician: "Raphael Lopez" },
  { id: "1015147021729793", name: "Susan Rutstein",   employer: "Ernst & Young",                  dpc: "Mind And Mobility",          physician: "Lainey Kieffer" },
  { id: "1018442751180802", name: "Marcus Holloway",  employer: "Prime Care VIP Health - Retail", dpc: "Persona Healthcare Direct",  physician: "Nicole Aguila" },
  { id: "1021884532910012", name: "Priya Natarajan",  employer: "KD Nutra",                       dpc: "KD Nutra",                    physician: "Shannon Nelson" },
  { id: "1024451209876553", name: "Robert Chen",      employer: "Aligned Marketplace",            dpc: "Mind And Mobility",          physician: "Melissa Buchanan" },
];

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
          <FiltersSheet
            employer={employer} setEmployer={setEmployer}
            dpc={dpc} setDpc={setDpc}
            physician={physician} setPhysician={setPhysician}
          />
          <Button
            variant="outline" size="sm" className="px-2"
            onClick={() => handleDownload(sub)}
            title="Download CSV"
          >
            <Download className="size-3.5" />
          </Button>
          <Button
            variant="outline" size="sm" className="px-2"
            onClick={() => handleShare(sub)}
            title="Share link"
          >
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
  <ChronicView
    metricLabel="Total Active Patients"
    metricValue={344}
    chronicCount={129}
    chronicPct={37.5}
    topData={topConditions}
    distData={distribution}
    xLabel="Percentage of Active Patients"
  />
);

const EncountersView = () => (
  <ChronicView
    metricLabel="Patients with Encounter(s)"
    metricValue={233}
    chronicCount={98}
    chronicPct={42.1}
    topData={encountersTopConditions}
    distData={encountersDistribution}
    xLabel="Percentage of Patients with Encounters"
  />
);

const encountersTopConditions = [
  { code: "E78.5", pct: 21.4 },
  { code: "I10", pct: 9.2 },
  { code: "E55.9", pct: 8.1 },
  { code: "F41.1", pct: 7.0 },
  { code: "I25.10", pct: 5.3 },
];

const encountersDistribution = [
  { type: "No Comorbidity", pct: 5.6, color: "hsl(38 92% 55%)" },
  { type: "Comorbidity", pct: 11.8, color: "hsl(28 85% 50%)" },
  { type: "Low Multimorbidity", pct: 7.2, color: "hsl(20 70% 42%)" },
  { type: "High Multimorbidity", pct: 18.4, color: "hsl(18 55% 30%)" },
];

type Selection =
  | { kind: "condition"; code: string }
  | { kind: "distribution"; type: string }
  | null;

const ChronicView = ({
  metricLabel, metricValue, chronicCount, chronicPct, topData, distData, xLabel,
}: {
  metricLabel: string;
  metricValue: number;
  chronicCount: number;
  chronicPct: number;
  topData: { code: string; pct: number }[];
  distData: { type: string; pct: number; color: string }[];
  xLabel: string;
}) => {
  const [selection, setSelection] = useState<Selection>(null);

  const toggleCondition = (code: string) =>
    setSelection((s) => (s?.kind === "condition" && s.code === code ? null : { kind: "condition", code }));
  const toggleDist = (type: string) =>
    setSelection((s) => (s?.kind === "distribution" && s.type === type ? null : { kind: "distribution", type }));

  return (
    <>
      <div className="bg-card border border-border rounded-lg shadow-card p-5 max-w-xs">
        <div className="flex items-center gap-2 text-sm text-foreground">
          <span>Chronic Condition Patients</span>
          <Info className="size-3.5 text-muted-foreground" />
        </div>
        <p className="mt-3">
          <span className="font-serif text-3xl text-foreground">{chronicCount}</span>
          <span className="ml-2 text-sm text-muted-foreground">({chronicPct}%)</span>
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {metricLabel}: <span className="text-foreground font-medium">{metricValue}</span>
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ChartCard title="Top Chronic Conditions" yLabel="Chronic Condition" xLabel={xLabel}>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart layout="vertical" data={topData} margin={{ top: 10, right: 50, left: 20, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
              <XAxis type="number" tickFormatter={(v) => `${v}%`} stroke="hsl(var(--muted-foreground))" fontSize={11} />
              <YAxis type="category" dataKey="code" stroke="hsl(var(--muted-foreground))" fontSize={11} width={60} />
              <Bar
                dataKey="pct" radius={[0, 4, 4, 0]} cursor="pointer"
                onClick={(d: { code: string }) => toggleCondition(d.code)}
              >
                {topData.map((d) => (
                  <Cell
                    key={d.code}
                    fill={
                      selection?.kind === "condition" && selection.code !== d.code
                        ? "hsl(var(--accent) / 0.35)"
                        : "hsl(var(--accent))"
                    }
                  />
                ))}
                <LabelList dataKey="pct" position="right" formatter={(v: number) => `${v}%`} fill="hsl(var(--accent))" fontSize={11} fontWeight={600} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Chronic Condition Distribution" yLabel="Condition Type" xLabel={xLabel}>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart layout="vertical" data={distData} margin={{ top: 10, right: 50, left: 20, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
              <XAxis type="number" tickFormatter={(v) => `${v}%`} stroke="hsl(var(--muted-foreground))" fontSize={11} />
              <YAxis type="category" dataKey="type" stroke="hsl(var(--muted-foreground))" fontSize={11} width={140} />
              <Bar
                dataKey="pct" radius={[0, 4, 4, 0]} cursor="pointer"
                onClick={(d: { type: string }) => toggleDist(d.type)}
              >
                {distData.map((d) => (
                  <Cell
                    key={d.type}
                    fill={
                      selection?.kind === "distribution" && selection.type !== d.type
                        ? `${d.color.replace(")", " / 0.35)")}`
                        : d.color
                    }
                  />
                ))}
                <LabelList dataKey="pct" position="right" formatter={(v: number) => `${v}%`} fill="hsl(var(--accent))" fontSize={11} fontWeight={600} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <DetailTable selection={selection} onClear={() => setSelection(null)} />
    </>
  );
};

const DetailTable = ({ selection, onClear }: { selection: Selection; onClear: () => void }) => {
  let title = "";
  let rows = samplePatients;
  let conditionCode = "";

  if (!selection) {
    return (
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
                Click a bar or label on either chart to show patient details.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  if (selection.kind === "condition") {
    conditionCode = selection.code;
    title = `Top Chronic Conditions - ${conditionNames[selection.code] ?? "Condition"} ( ${selection.code} )`;
    rows = samplePatients.slice(0, 4);
  } else {
    title = `Chronic Condition Distribution - ${selection.type}`;
    conditionCode = "—";
    rows = samplePatients.slice(2, 7);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm text-foreground">{title}</h3>
        <button onClick={onClear} className="text-xs text-accent hover:underline">Clear selection</button>
      </div>
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
          <tbody className="divide-y divide-border">
            {rows.map((p) => (
              <tr key={p.id} className="hover:bg-muted/40">
                <td className="px-4 py-3 font-mono text-accent">{p.id}</td>
                <td className="px-4 py-3 text-foreground">{p.name}</td>
                <td className="px-4 py-3 text-foreground">{conditionCode}</td>
                <td className="px-4 py-3 text-foreground">{p.employer}</td>
                <td className="px-4 py-3 text-foreground">{p.dpc}</td>
                <td className="px-4 py-3 text-foreground">{p.physician}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

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

const handleDownload = (sub: SubTab) => {
  const rows = [
    ["Patient ID", "Patient Name", "Medical Condition", "Employer", "DPC", "Physician"],
  ];
  const csv = rows.map((r) => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `chronic-risk-${sub}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast({ title: "Download started", description: `Chronic Risk (${sub === "active" ? "Active" : "Encounters"}) export.` });
};

const handleShare = async (sub: SubTab) => {
  const url = `${window.location.origin}${window.location.pathname}?tab=chronic&view=${sub}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: "Chronic Risk", url });
      return;
    }
    await navigator.clipboard.writeText(url);
    toast({ title: "Link copied", description: "Shareable URL copied to clipboard." });
  } catch {
    toast({ title: "Unable to share", description: url });
  }
};

const FiltersSheet = ({
  employer, setEmployer, dpc, setDpc, physician, setPhysician,
}: {
  employer: string; setEmployer: (v: string) => void;
  dpc: string; setDpc: (v: string) => void;
  physician: string; setPhysician: (v: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [draftEmp, setDraftEmp] = useState(employer);
  const [draftDpc, setDraftDpc] = useState(dpc);
  const [draftPhy, setDraftPhy] = useState(physician);

  const onOpenChange = (o: boolean) => {
    if (o) {
      setDraftEmp(employer); setDraftDpc(dpc); setDraftPhy(physician);
    }
    setOpen(o);
  };

  const apply = () => {
    setEmployer(draftEmp); setDpc(draftDpc); setPhysician(draftPhy);
    setOpen(false);
    toast({ title: "Filters applied" });
  };

  const reset = () => {
    setDraftEmp("all"); setDraftDpc("all"); setDraftPhy("all");
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <Button variant="outline" size="sm" className="gap-2 text-xs" onClick={() => setOpen(true)}>
        <Filter className="size-3.5" /> Filters
      </Button>
      <SheetContent side="right" className="w-[320px] flex flex-col">
        <SheetHeader>
          <SheetTitle>Manage Filters</SheetTitle>
        </SheetHeader>
        <div className="space-y-5 mt-6 flex-1">
          <FilterField label="Select Employer" value={draftEmp} onChange={setDraftEmp} options={employerOptions} allLabel="All Sponsored Patients" />
          <FilterField label="Select DPC" value={draftDpc} onChange={setDraftDpc} options={dpcOptions} allLabel="All DPCs" />
          <FilterField label="Select Physician" value={draftPhy} onChange={setDraftPhy} options={physicianOptions} allLabel="All Physicians" />
        </div>
        <p className="text-xs text-muted-foreground">
          Note: After changing any filters, click Apply to update the results.
        </p>
        <SheetFooter className="flex-row gap-2 sm:justify-start">
          <Button onClick={apply} className="flex-1">Apply</Button>
          <Button variant="outline" onClick={reset} className="flex-1">Reset</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};

const FilterField = ({
  label, value, onChange, options, allLabel,
}: {
  label: string; value: string; onChange: (v: string) => void; options: string[]; allLabel: string;
}) => (
  <div className="space-y-1.5">
    <label className="text-sm text-muted-foreground">{label}</label>
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full">
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

export default ChronicRiskPanel;
