import { cn } from "@/lib/utils";

interface PatientRisk {
  id: string;
  name: string;
  age: number;
  phone: string;
  condition: string;
  spruceApp: boolean;
  lastEncounter: string;
  lastMessage: string;
  employer: string;
  dpc: string;
  physician: string;
  hccScore: number;
  severity: "critical" | "moderate" | "low";
}

const mockPatients: PatientRisk[] = [
  { id: "VIP-9942-A", name: "Marcus Bellamy", age: 64, phone: "(305) 555-0142", condition: "Acute Coronary Syndrome", spruceApp: true, lastEncounter: "2026-04-28 09:14", lastMessage: "2026-05-02 16:42", employer: "Aligned Marketplace", dpc: "PrimeCare VIP", physician: "Michael Kieffer", hccScore: 4.44, severity: "critical" },
  { id: "VIP-8210-C", name: "Priya Anand", age: 52, phone: "(786) 555-0188", condition: "Type 2 Diabetes Mellitus", spruceApp: true, lastEncounter: "2026-04-22 11:02", lastMessage: "2026-05-03 08:15", employer: "Ernst & Young", dpc: "PrimeCare VIP", physician: "Lainey Kieffer", hccScore: 2.81, severity: "moderate" },
  { id: "VIP-1104-E", name: "Theodore Hahn", age: 71, phone: "(305) 555-0210", condition: "Chronic Kidney Disease (Stage 4)", spruceApp: false, lastEncounter: "2026-04-30 14:48", lastMessage: "2026-04-29 10:05", employer: "KD Nutra", dpc: "PrimeCare VIP", physician: "Raphael Lopez", hccScore: 3.15, severity: "critical" },
  { id: "HH-3382-B", name: "Jasmine Okafor", age: 39, phone: "(954) 555-0117", condition: "Managed Hypertension", spruceApp: true, lastEncounter: "2026-04-15 08:30", lastMessage: "2026-05-01 19:22", employer: "Mind And Mobility", dpc: "PrimeCare VIP Health - Retail", physician: "Nicole Aguila", hccScore: 1.10, severity: "low" },
  { id: "HH-4501-D", name: "Owen Caldwell", age: 47, phone: "(561) 555-0166", condition: "Major Depressive Disorder", spruceApp: true, lastEncounter: "2026-04-25 13:11", lastMessage: "2026-05-04 07:38", employer: "Persona Healthcare Direct", dpc: "PrimeCare VIP", physician: "Shannon Nelson", hccScore: 1.84, severity: "moderate" },
  { id: "VIP-6620-F", name: "Geneva Whitlock", age: 68, phone: "(305) 555-0193", condition: "CHF with Reduced Ejection Fraction", spruceApp: false, lastEncounter: "2026-05-01 10:20", lastMessage: "2026-05-03 21:09", employer: "Prime Care VIP Health - Retail", dpc: "PrimeCare VIP", physician: "Jarrod Frydman", hccScore: 4.92, severity: "critical" },
  { id: "VIP-7733-G", name: "Daniel Reyes", age: 58, phone: "(786) 555-0149", condition: "COPD with Exacerbation", spruceApp: true, lastEncounter: "2026-04-19 15:55", lastMessage: "2026-04-30 12:01", employer: "Aligned Marketplace", dpc: "PrimeCare VIP", physician: "Melissa Buchanan", hccScore: 3.62, severity: "critical" },
];

const severityColor = {
  critical: "bg-destructive",
  moderate: "bg-accent",
  low: "bg-success",
};

const scoreColor = {
  critical: "text-destructive",
  moderate: "text-accent",
  low: "text-success",
};

const RiskTable = () => {
  return (
    <div className="glass-panel rounded-lg overflow-hidden flex flex-col">
      <div className="px-6 py-5 border-b border-border flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Active Patient Risk Registry
        </h3>
        <span className="text-[10px] font-mono text-muted-foreground">HCC WEIGHTED</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border bg-secondary/30">
              <th className="px-4 py-4 font-semibold">Patient ID</th>
              <th className="px-4 py-4 font-semibold">Patient Name</th>
              <th className="px-4 py-4 font-semibold text-right">Age</th>
              <th className="px-4 py-4 font-semibold">Phone Number</th>
              <th className="px-4 py-4 font-semibold">Medical Condition</th>
              <th className="px-4 py-4 font-semibold text-center">Spruce App</th>
              <th className="px-4 py-4 font-semibold">Last Encounter</th>
              <th className="px-4 py-4 font-semibold">Last Message</th>
              <th className="px-4 py-4 font-semibold">Employer</th>
              <th className="px-4 py-4 font-semibold">DPC</th>
              <th className="px-4 py-4 font-semibold">Physician</th>
              <th className="px-4 py-4 font-semibold text-right">HCC</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border font-mono text-xs">
            {mockPatients.map((p) => (
              <tr key={p.id} className="hover:bg-accent/5 transition-colors cursor-pointer">
                <td className="px-4 py-4 font-medium text-foreground whitespace-nowrap">{p.id}</td>
                <td className="px-4 py-4 font-sans text-foreground whitespace-nowrap">{p.name}</td>
                <td className="px-4 py-4 text-right text-muted-foreground">{p.age}</td>
                <td className="px-4 py-4 text-muted-foreground whitespace-nowrap">{p.phone}</td>
                <td className="px-4 py-4">
                  <div className="flex items-center gap-2">
                    <div className={cn("size-2 rounded-full shrink-0", severityColor[p.severity])} />
                    <span className="text-foreground/80 font-sans whitespace-nowrap">{p.condition}</span>
                  </div>
                </td>
                <td className="px-4 py-4 text-center">
                  <span
                    className={cn(
                      "inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border",
                      p.spruceApp
                        ? "bg-success/10 text-success border-success/30"
                        : "bg-muted text-muted-foreground border-border",
                    )}
                  >
                    {p.spruceApp ? "Yes" : "No"}
                  </span>
                </td>
                <td className="px-4 py-4 text-muted-foreground whitespace-nowrap">{p.lastEncounter}</td>
                <td className="px-4 py-4 text-muted-foreground whitespace-nowrap">{p.lastMessage}</td>
                <td className="px-4 py-4 font-sans text-foreground/80 whitespace-nowrap">{p.employer}</td>
                <td className="px-4 py-4 font-sans text-foreground/80 whitespace-nowrap">{p.dpc}</td>
                <td className="px-4 py-4 font-sans text-foreground/80 whitespace-nowrap">{p.physician}</td>
                <td className={cn("px-4 py-4 text-right", scoreColor[p.severity])}>{p.hccScore.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-auto p-4 bg-secondary/20 border-t border-border flex justify-between items-center">
        <p className="text-[10px] text-muted-foreground font-mono">1,421 RECORDS • LAST SYNC: 4 MIN AGO</p>
        <div className="flex gap-3">
          <button className="px-5 py-2.5 bg-muted rounded border border-border text-xs uppercase font-bold text-muted-foreground hover:text-foreground transition-colors">
            Previous
          </button>
          <button className="px-5 py-2.5 bg-muted rounded border border-border text-xs uppercase font-bold text-foreground hover:bg-muted/80 transition-colors">
            Next Page
          </button>
        </div>
      </div>
    </div>
  );
};

export default RiskTable;
