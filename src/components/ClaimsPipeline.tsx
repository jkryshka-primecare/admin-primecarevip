import { cn } from "@/lib/utils";

const claims = [
  { id: "C-49204-BT", diagnosis: "Inpatient Cardiac Catheter", cost: "$42,104", status: "pending", entity: "PrimeCare VIP", integrity: 99.8 },
  { id: "C-38192-RX", diagnosis: "Specialty Biological Infusion", cost: "$12,840", status: "approved", entity: "PrimeCare VIP", integrity: 100 },
  { id: "C-41002-ER", diagnosis: "Emergency Out-of-Network", cost: "$8,112", status: "flagged", entity: "Hero Healthcare", integrity: 84.2 },
  { id: "C-55201-PC", diagnosis: "Preventive Wellness Visit", cost: "$385", status: "approved", entity: "PrimeCare VIP", integrity: 100 },
  { id: "C-62304-DM", diagnosis: "Diabetic Supplies (90-day)", cost: "$1,240", status: "approved", entity: "Hero Healthcare", integrity: 98.4 },
  { id: "C-71005-MH", diagnosis: "Behavioral Health Session", cost: "$275", status: "pending", entity: "PrimeCare VIP", integrity: 100 },
];

const statusStyles = {
  pending: "text-accent",
  approved: "text-success",
  flagged: "text-destructive",
};

const statusLabels = {
  pending: "PENDING",
  approved: "APPROVED",
  flagged: "FLAGGED",
};

const ClaimsPipeline = () => {
  const totalClaims = 14102;
  const primeCareRate = 62.4;
  const heroRate = 37.6;

  return (
    <div className="space-y-8">
      {/* Utilization Rate Summary */}
      <div className="grid grid-cols-3 gap-6">
        <div className="glass-panel rounded-lg p-6">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Total Claims YTD</p>
          <p className="text-3xl font-mono tracking-tighter text-foreground">{totalClaims.toLocaleString()}</p>
        </div>
        <div className="glass-panel rounded-lg p-6">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">PrimeCare VIP Rate</p>
          <p className="text-3xl font-mono tracking-tighter text-accent">{primeCareRate}%</p>
          <div className="mt-3 h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-accent rounded-full" style={{ width: `${primeCareRate}%` }} />
          </div>
        </div>
        <div className="glass-panel rounded-lg p-6">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Hero Healthcare Rate</p>
          <p className="text-3xl font-mono tracking-tighter text-primary">{heroRate}%</p>
          <div className="mt-3 h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full" style={{ width: `${heroRate}%` }} />
          </div>
        </div>
      </div>

      {/* Claims Table */}
      <div className="glass-panel rounded-lg overflow-hidden">
        <div className="px-6 py-5 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Recent Claims Activity</h3>
          <button className="px-5 py-2.5 bg-primary text-primary-foreground text-xs font-bold rounded hover:opacity-90 transition-opacity">
            Export Report
          </button>
        </div>
        <table className="w-full text-left">
          <thead>
            <tr className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border bg-secondary/30">
              <th className="px-6 py-4 font-semibold">Claim ID</th>
              <th className="px-6 py-4 font-semibold">Entity</th>
              <th className="px-6 py-4 font-semibold">Diagnosis</th>
              <th className="px-6 py-4 font-semibold text-right">Amount</th>
              <th className="px-6 py-4 font-semibold">Status</th>
              <th className="px-6 py-4 font-semibold text-right">Integrity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border font-mono text-xs">
            {claims.map((claim) => (
              <tr key={claim.id} className="hover:bg-accent/5 transition-colors cursor-pointer">
                <td className="px-6 py-4 font-medium text-foreground">{claim.id}</td>
                <td className="px-6 py-4 text-muted-foreground font-sans text-[11px]">{claim.entity}</td>
                <td className="px-6 py-4 text-foreground/80 font-sans">{claim.diagnosis}</td>
                <td className="px-6 py-4 text-right text-foreground">{claim.cost}</td>
                <td className={cn("px-6 py-4 font-bold", statusStyles[claim.status as keyof typeof statusStyles])}>
                  {statusLabels[claim.status as keyof typeof statusLabels]}
                </td>
                <td className={cn("px-6 py-4 text-right", claim.integrity >= 95 ? "text-success" : "text-destructive")}>
                  {claim.integrity}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ClaimsPipeline;
