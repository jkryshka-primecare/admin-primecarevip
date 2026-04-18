import { useMemo, useState } from "react";
import MetricTile from "./engagement/MetricTile";
import ReportFilterBar from "./engagement/ReportFilterBar";
import PatientDrilldownDrawer from "./engagement/PatientDrilldownDrawer";
import {
  metricTiles,
  enrolledPatients,
  reportDefaults,
  filterPatientsByReport,
  type ReportFilters,
} from "./engagement/mockData";
import type { DrilldownContext, EngagementPatient } from "./engagement/types";
import { ChevronRight } from "lucide-react";

const onboardingStats = [
  { key: "total",       label: "Total Onboarded",     filter: () => true,                                                accent: false },
  { key: "month",       label: "This Month",          filter: (p: EngagementPatient) => p.lastEncounter >= "2026-04-01", accent: false },
  { key: "conversion",  label: "Conversion Rate",     filter: () => true,                                                accent: true  },
  { key: "days",        label: "Avg. Days to Onboard", filter: () => true,                                               accent: false },
];

const utilizationBars = [
  { label: "Primary Care Visits",     max: 50,  color: "bg-primary",     filter: (p: EngagementPatient) => p.encounters > 0,                  metric: (ps: EngagementPatient[]) => ps.reduce((s, p) => s + p.encounters, 0) },
  { label: "Telehealth Sessions",     max: 50,  color: "bg-accent",      filter: (p: EngagementPatient) => p.digital,                         metric: (ps: EngagementPatient[]) => ps.filter((p) => p.digital).length * 4 },
  { label: "Urgent Care Diversions",  max: 50,  color: "bg-destructive", filter: (p: EngagementPatient) => p.afterHours,                      metric: (ps: EngagementPatient[]) => ps.filter((p) => p.afterHours).length * 3 },
  { label: "Patient Messages",        max: 100, color: "bg-success",     filter: (p: EngagementPatient) => p.messages > 0,                    metric: (ps: EngagementPatient[]) => ps.reduce((s, p) => s + p.messages, 0) },
];

const gaps = [
  { metric: "Annual Wellness Visit",  completed: 68, entity: "PrimeCare VIP",  filter: (p: EngagementPatient) => p.encounters === 0 },
  { metric: "Diabetic Eye Exam",      completed: 42, entity: "PrimeCare VIP",  filter: (p: EngagementPatient) => p.flag === "Diabetic" || p.encounters < 2 },
  { metric: "Mammography Screening",  completed: 55, entity: "Hero Healthcare", filter: (p: EngagementPatient) => p.encounters < 3 },
  { metric: "Colorectal Screening",   completed: 38, entity: "Hero Healthcare", filter: (p: EngagementPatient) => p.encounters < 2 },
];

const EngagementPanel = () => {
  const [filters, setFilters] = useState<ReportFilters>({ ...reportDefaults });
  const [drilldown, setDrilldown] = useState<DrilldownContext | null>(null);

  const filteredCohort = useMemo(
    () => filterPatientsByReport(enrolledPatients, filters),
    [filters],
  );

  const open = (ctx: DrilldownContext) => setDrilldown(ctx);

  return (
    <div className="space-y-8">
      {/* Interactive report filter bar */}
      <ReportFilterBar
        filters={filters}
        onChange={setFilters}
        matchedCount={filteredCohort.length}
        totalCount={enrolledPatients.length}
      />

      {/* HealthCompiler-style metric tile grid (live-computed) */}
      <section>
        <div className="flex items-baseline justify-between mb-4">
          <h3 className="font-serif text-lg text-foreground">Engagement & Utilization</h3>
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Click any tile to drill into patients
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
          {metricTiles.map((tile) => {
            const patients = tile.patients(filteredCohort);
            const primary = tile.primary(filteredCohort);
            const secondary = tile.secondary?.(filteredCohort);
            return (
              <MetricTile
                key={tile.key}
                title={tile.title}
                primary={primary}
                primaryUnit={tile.primaryUnit}
                secondary={secondary}
                description={tile.description}
                onClick={() =>
                  open({
                    metric: tile.key,
                    title: tile.title,
                    description: tile.description,
                    patients,
                  })
                }
              />
            );
          })}
        </div>
      </section>

      {/* Onboarding Pipeline (Hint) — live counts */}
      <section className="bg-card border border-border rounded-lg p-6 shadow-card">
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-6">
          Onboarding Pipeline (Hint)
        </h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {onboardingStats.map((stat) => {
            const subset = filteredCohort.filter(stat.filter);
            const value =
              stat.key === "conversion"
                ? `${filteredCohort.length === 0 ? 0 : ((subset.length / filteredCohort.length) * 100).toFixed(1)}%`
                : stat.key === "days"
                  ? "3.2"
                  : stat.key === "month"
                    ? `+${subset.length}`
                    : `${subset.length}`;
            return (
              <button
                key={stat.key}
                onClick={() =>
                  open({
                    metric: "onboarding",
                    title: stat.label,
                    description: "Patients matching this onboarding cohort.",
                    patients: subset,
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
                  {value}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      {/* Service Utilization (Elation) — bars scale with filter */}
      <section className="bg-card border border-border rounded-lg p-6 shadow-card">
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-6">
          Service Utilization (Elation)
        </h3>
        <div className="space-y-3">
          {utilizationBars.map((item) => {
            const subset = filteredCohort.filter(item.filter);
            const value = item.metric(filteredCohort);
            return (
              <button
                key={item.label}
                onClick={() =>
                  open({
                    metric: "utilization",
                    title: item.label,
                    description: `Patients contributing to ${item.label.toLowerCase()}.`,
                    patients: subset,
                  })
                }
                className="w-full text-left p-3 rounded-lg hover:bg-accent/5 border border-transparent hover:border-accent/20 transition-colors group"
              >
                <div className="flex justify-between items-baseline mb-1.5">
                  <span className="text-xs font-medium text-foreground/80 group-hover:text-foreground">
                    {item.label}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-foreground">{value.toLocaleString()}</span>
                    <ChevronRight className="size-3.5 text-muted-foreground group-hover:text-accent transition-colors" />
                  </div>
                </div>
                <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${item.color}`}
                    style={{ width: `${Math.min(100, (value / item.max) * 100)}%` }}
                  />
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Utilization Gaps — clickable */}
      <section className="bg-card border border-border rounded-lg p-6 shadow-card">
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-6">
          Utilization Gaps
        </h3>
        <div className="space-y-3">
          {gaps.map((gap) => {
            const subset = filteredCohort.filter(gap.filter);
            return (
              <button
                key={gap.metric}
                onClick={() =>
                  open({
                    metric: "gap",
                    title: `${gap.metric} — Open Patients`,
                    description: `Patients with an outstanding ${gap.metric.toLowerCase()} gap.`,
                    patients: subset,
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
                    <span className="text-[10px] font-mono text-accent">{subset.length} open</span>
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
            );
          })}
        </div>
      </section>

      <PatientDrilldownDrawer context={drilldown} onClose={() => setDrilldown(null)} />
    </div>
  );
};

export default EngagementPanel;
