import { useState } from "react";
import MetricTile from "./engagement/MetricTile";
import ReportFilterBar from "./engagement/ReportFilterBar";
import PatientDrilldownDrawer from "./engagement/PatientDrilldownDrawer";
import { metricTiles, enrolledPatients } from "./engagement/mockData";
import type { DrilldownContext, EngagementPatient } from "./engagement/types";
import { ChevronRight } from "lucide-react";

const onboardingStats = [
  { key: "total",       label: "Total Onboarded",     value: "1,248", filter: () => true },
  { key: "month",       label: "This Month",          value: "+84",   filter: (p: EngagementPatient) => p.lastEncounter >= "2026-04-01" },
  { key: "conversion",  label: "Conversion Rate",     value: "72.4%", filter: () => true, accent: true },
  { key: "days",        label: "Avg. Days to Onboard", value: "3.2",  filter: () => true },
];

const utilizationBars = [
  { label: "Primary Care Visits",     value: 3412, max: 5000,  color: "bg-primary",     filter: (p: EngagementPatient) => p.encounters > 0 },
  { label: "Telehealth Sessions",     value: 1894, max: 5000,  color: "bg-accent",      filter: (p: EngagementPatient) => p.digital },
  { label: "Urgent Care Diversions",  value: 342,  max: 5000,  color: "bg-destructive", filter: (p: EngagementPatient) => p.afterHours },
  { label: "Patient Messages",        value: 8204, max: 10000, color: "bg-success",     filter: (p: EngagementPatient) => p.messages > 0 },
];

const gaps = [
  { metric: "Annual Wellness Visit",  completed: 68, entity: "PrimeCare VIP",  filter: (p: EngagementPatient) => p.encounters === 0 },
  { metric: "Diabetic Eye Exam",      completed: 42, entity: "PrimeCare VIP",  filter: (p: EngagementPatient) => p.flag === "Diabetic" || p.encounters < 2 },
  { metric: "Mammography Screening",  completed: 55, entity: "Hero Healthcare", filter: (p: EngagementPatient) => p.encounters < 3 },
  { metric: "Colorectal Screening",   completed: 38, entity: "Hero Healthcare", filter: (p: EngagementPatient) => p.encounters < 2 },
];

const EngagementPanel = () => {
  const [drilldown, setDrilldown] = useState<DrilldownContext | null>(null);

  const open = (ctx: DrilldownContext) => setDrilldown(ctx);

  return (
    <div className="space-y-8">
      {/* Report filter chips */}
      <ReportFilterBar />

      {/* HealthCompiler-style metric tile grid */}
      <section>
        <div className="flex items-baseline justify-between mb-4">
          <h3 className="font-serif text-lg text-foreground">Engagement & Utilization</h3>
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Click any tile to drill into patients
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
          {metricTiles.map((tile) => (
            <MetricTile
              key={tile.key}
              tile={tile}
              onClick={() =>
                open({
                  metric: tile.key,
                  title: tile.title,
                  description: tile.description,
                  patients: enrolledPatients.filter(tile.filterPatients),
                })
              }
            />
          ))}
        </div>
      </section>

      {/* Onboarding Pipeline (Hint) — preserved, now clickable */}
      <section className="bg-card border border-border rounded-lg p-6 shadow-card">
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-6">
          Onboarding Pipeline (Hint)
        </h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {onboardingStats.map((stat) => (
            <button
              key={stat.key}
              onClick={() =>
                open({
                  metric: "onboarding",
                  title: stat.label,
                  description: "Patients matching this onboarding cohort.",
                  patients: enrolledPatients.filter(stat.filter),
                })
              }
              className="text-left rounded-lg border border-border bg-secondary/40 hover:border-accent/40 hover:bg-accent/5 p-4 transition-colors group"
            >
              <div className="flex items-start justify-between">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {stat.label}
                </p>
                <ChevronRight className="size-3.5 text-muted-foreground group-hover:text-accent transition-colors" />
              </div>
              <p className={`mt-2 text-2xl font-mono ${stat.accent ? "text-accent" : "text-foreground"}`}>
                {stat.value}
              </p>
            </button>
          ))}
        </div>
      </section>

      {/* Service Utilization (Elation) — preserved bars, now clickable rows */}
      <section className="bg-card border border-border rounded-lg p-6 shadow-card">
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-6">
          Service Utilization (Elation)
        </h3>
        <div className="space-y-3">
          {utilizationBars.map((item) => (
            <button
              key={item.label}
              onClick={() =>
                open({
                  metric: "utilization",
                  title: item.label,
                  description: `Patients contributing to ${item.label.toLowerCase()}.`,
                  patients: enrolledPatients.filter(item.filter),
                })
              }
              className="w-full text-left p-3 rounded-lg hover:bg-accent/5 border border-transparent hover:border-accent/20 transition-colors group"
            >
              <div className="flex justify-between items-baseline mb-1.5">
                <span className="text-xs font-medium text-foreground/80 group-hover:text-foreground">
                  {item.label}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-foreground">{item.value.toLocaleString()}</span>
                  <ChevronRight className="size-3.5 text-muted-foreground group-hover:text-accent transition-colors" />
                </div>
              </div>
              <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${item.color}`}
                  style={{ width: `${(item.value / item.max) * 100}%` }}
                />
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Utilization Gaps — preserved, clickable */}
      <section className="bg-card border border-border rounded-lg p-6 shadow-card">
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-6">
          Utilization Gaps
        </h3>
        <div className="space-y-3">
          {gaps.map((gap) => (
            <button
              key={gap.metric}
              onClick={() =>
                open({
                  metric: "gap",
                  title: `${gap.metric} — Open Patients`,
                  description: `Patients with an outstanding ${gap.metric.toLowerCase()} gap.`,
                  patients: enrolledPatients.filter(gap.filter),
                })
              }
              className="w-full text-left p-3 rounded-lg hover:bg-accent/5 border border-transparent hover:border-accent/20 transition-colors group"
            >
              <div className="flex justify-between mb-1">
                <span className="text-xs font-medium text-foreground/80 group-hover:text-foreground">
                  {gap.metric}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground">{gap.entity}</span>
                  <ChevronRight className="size-3.5 text-muted-foreground group-hover:text-accent transition-colors" />
                </div>
              </div>
              <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    gap.completed >= 60 ? "bg-success" : gap.completed >= 40 ? "bg-accent" : "bg-destructive"
                  }`}
                  style={{ width: `${gap.completed}%` }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">{gap.completed}% compliance</p>
            </button>
          ))}
        </div>
      </section>

      <PatientDrilldownDrawer context={drilldown} onClose={() => setDrilldown(null)} />
    </div>
  );
};

export default EngagementPanel;
