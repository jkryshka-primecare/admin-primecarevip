import { cn } from "@/lib/utils";

interface PatientRisk {
  id: string;
  condition: string;
  hccScore: number;
  costVariance: string;
  severity: "critical" | "moderate" | "low";
  entity: string;
}

const mockPatients: PatientRisk[] = [
  { id: "VIP-9942-A", condition: "Acute Coronary Syndrome", hccScore: 4.44, costVariance: "+$12,402", severity: "critical", entity: "PrimeCare VIP" },
  { id: "VIP-8210-C", condition: "Type 2 Diabetes Mellitus", hccScore: 2.81, costVariance: "-$2,140", severity: "moderate", entity: "PrimeCare VIP" },
  { id: "VIP-1104-E", condition: "Chronic Kidney Disease (Stage 4)", hccScore: 3.15, costVariance: "+$8,550", severity: "critical", entity: "PrimeCare VIP" },
  { id: "HH-3382-B", condition: "Managed Hypertension", hccScore: 1.10, costVariance: "-$412", severity: "low", entity: "Hero Healthcare" },
  { id: "HH-4501-D", condition: "Major Depressive Disorder", hccScore: 1.84, costVariance: "+$1,204", severity: "moderate", entity: "Hero Healthcare" },
  { id: "VIP-6620-F", condition: "CHF with Reduced Ejection Fraction", hccScore: 4.92, costVariance: "+$22,180", severity: "critical", entity: "PrimeCare VIP" },
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
              <th className="px-6 py-4 font-semibold">Patient ID</th>
              <th className="px-6 py-4 font-semibold">Entity</th>
              <th className="px-6 py-4 font-semibold">Clinical Status</th>
              <th className="px-6 py-4 font-semibold text-right">HCC Score</th>
              <th className="px-6 py-4 font-semibold text-right">Cost Variance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border font-mono text-xs">
            {mockPatients.map((patient) => (
              <tr key={patient.id} className="hover:bg-accent/5 transition-colors cursor-pointer">
                <td className="px-6 py-4 font-medium text-foreground">{patient.id}</td>
                <td className="px-6 py-4 text-muted-foreground font-sans text-[11px]">{patient.entity}</td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <div className={cn("size-2 rounded-full", severityColor[patient.severity])} />
                    <span className="text-foreground/80 font-sans">{patient.condition}</span>
                  </div>
                </td>
                <td className={cn("px-6 py-4 text-right", scoreColor[patient.severity])}>{patient.hccScore.toFixed(2)}</td>
                <td className="px-6 py-4 text-right text-muted-foreground">{patient.costVariance}</td>
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
