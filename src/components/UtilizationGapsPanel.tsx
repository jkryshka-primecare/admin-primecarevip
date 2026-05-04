import { useState } from "react";
import { Info } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { employerOptions, physicianOptions, dpcOptions } from "@/components/engagement/mockData";
import RiskTable from "@/components/RiskTable";

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

const showPatientsOptions = [
  "No Encounters",
  "No Messages",
  "No Rx Activity",
  "No Engagement",
];

const inactivityOptions = ["30", "60", "90", "120", "180"];

const UtilizationGapsPanel = () => {
  const [employer, setEmployer] = useState("all");
  const [dpc, setDpc] = useState("all");
  const [physician, setPhysician] = useState("Jarrod Frydman");
  const [showWith, setShowWith] = useState("No Encounters");
  const [inactivity, setInactivity] = useState("90");

  return (
    <section className="space-y-5">
      <div>
        <h2 className="font-serif text-2xl text-accent tracking-tight">Utilization Gaps</h2>
        <div className="mt-3 h-px bg-border" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SelectField
          label="Employer"
          value={employer}
          onChange={setEmployer}
          options={employerOptions}
          allLabel="All Sponsored Patients"
        />
        <SelectField
          label="DPC"
          value={dpc}
          onChange={setDpc}
          options={dpcOptions}
          allLabel="All DPCs"
        />
        <SelectField
          label="Physician"
          value={physician}
          onChange={setPhysician}
          options={physicianOptions}
          allLabel="All Physicians"
        />
        <div className="flex items-center gap-2 bg-secondary border border-border rounded-md px-3 py-1.5">
          <span className={labelClass}>Show Patients With:</span>
          <Select value={showWith} onValueChange={setShowWith}>
            <SelectTrigger className="h-7 border-0 bg-transparent text-xs font-mono px-1 gap-1 focus:ring-0 shadow-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover">
              {showPatientsOptions.map((opt) => (
                <SelectItem key={opt} value={opt}>{opt}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2 bg-secondary border border-border rounded-md px-3 py-1.5">
          <span className={labelClass}>Inactivity Period:</span>
          <Select value={inactivity} onValueChange={setInactivity}>
            <SelectTrigger className="h-7 border-0 bg-transparent text-xs font-mono px-1 gap-1 focus:ring-0 shadow-none w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover">
              {inactivityOptions.map((opt) => (
                <SelectItem key={opt} value={opt}>{opt} days</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg shadow-card p-5 max-w-xs">
        <div className="flex items-center gap-2 text-sm text-foreground">
          <span>Patients with Utilization Gaps</span>
          <Info className="size-3.5 text-muted-foreground" />
        </div>
        <p className="font-serif text-3xl text-foreground mt-3">136</p>
        <p className="text-xs text-muted-foreground mt-1">Patients meeting utilization gap criteria.</p>
      </div>

      <RiskTable />
    </section>
  );
};

export default UtilizationGapsPanel;
