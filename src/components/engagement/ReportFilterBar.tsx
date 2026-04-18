import { format } from "date-fns";
import { CalendarIcon, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  type ReportFilters,
  reportDefaults,
  employerOptions,
  dpcOptions,
  physicianOptions,
} from "./mockData";

interface Props {
  filters: ReportFilters;
  onChange: (next: ReportFilters) => void;
  matchedCount: number;
  totalCount: number;
}

const labelClass = "text-[10px] font-bold uppercase tracking-widest text-muted-foreground";

const DateField = ({
  label, value, onChange,
}: { label: string; value: Date; onChange: (d: Date) => void }) => (
  <div className="flex flex-col gap-1">
    <span className={labelClass}>{label}</span>
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "h-9 justify-start text-left font-mono text-xs gap-2 bg-secondary border-border",
          )}
        >
          <CalendarIcon className="size-3.5 opacity-60" />
          {format(value, "yyyy-MM-dd")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0 bg-popover" align="start">
        <Calendar
          mode="single"
          selected={value}
          onSelect={(d) => d && onChange(d)}
          initialFocus
          className={cn("p-3 pointer-events-auto")}
        />
      </PopoverContent>
    </Popover>
  </div>
);

const SelectField = ({
  label, value, onChange, options, allLabel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  allLabel: string;
}) => (
  <div className="flex flex-col gap-1 min-w-[180px]">
    <span className={labelClass}>{label}</span>
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 bg-secondary border-border text-xs font-mono">
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

const ReportFilterBar = ({ filters, onChange, matchedCount, totalCount }: Props) => {
  const reset = () => onChange({ ...reportDefaults });
  const isFiltered =
    filters.employer !== "all" ||
    filters.dpc !== "all" ||
    filters.physician !== "all" ||
    filters.startDate.getTime() !== reportDefaults.startDate.getTime() ||
    filters.endDate.getTime() !== reportDefaults.endDate.getTime();

  return (
    <div className="bg-card border border-border rounded-lg p-4 shadow-card">
      <div className="flex flex-wrap items-end gap-3">
        <DateField
          label="Start Date"
          value={filters.startDate}
          onChange={(d) => onChange({ ...filters, startDate: d })}
        />
        <DateField
          label="End Date"
          value={filters.endDate}
          onChange={(d) => onChange({ ...filters, endDate: d })}
        />
        <SelectField
          label="Employer"
          value={filters.employer}
          onChange={(v) => onChange({ ...filters, employer: v })}
          options={employerOptions}
          allLabel="All Sponsored Patients"
        />
        <SelectField
          label="DPC"
          value={filters.dpc}
          onChange={(v) => onChange({ ...filters, dpc: v })}
          options={dpcOptions}
          allLabel="All DPCs"
        />
        <SelectField
          label="Physician"
          value={filters.physician}
          onChange={(v) => onChange({ ...filters, physician: v })}
          options={physicianOptions}
          allLabel="All Physicians"
        />

        <div className="ml-auto flex items-center gap-3">
          <div className="flex flex-col items-end">
            <span className={labelClass}>Patients in cohort</span>
            <span className="font-mono text-lg text-foreground">
              {matchedCount}{" "}
              <span className="text-xs text-muted-foreground">/ {totalCount}</span>
            </span>
          </div>
          {isFiltered && (
            <Button
              variant="outline"
              size="sm"
              onClick={reset}
              className="gap-2 text-xs border-border"
            >
              <RotateCcw className="size-3.5" /> Reset
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ReportFilterBar;
