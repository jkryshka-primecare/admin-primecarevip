import { reportFilters } from "./mockData";

const FilterChip = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-center gap-2 px-3 py-2 rounded bg-secondary border border-border">
    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
      {label}
    </span>
    <span className="text-xs font-mono text-foreground">{value}</span>
  </div>
);

const ReportFilterBar = () => (
  <div className="flex flex-wrap gap-2">
    <FilterChip label="Start" value={reportFilters.startDate} />
    <FilterChip label="End" value={reportFilters.endDate} />
    <FilterChip label="Employer" value={reportFilters.employer} />
    <FilterChip label="DPC" value={reportFilters.dpc} />
    <FilterChip label="Physician" value={reportFilters.physician} />
  </div>
);

export default ReportFilterBar;
