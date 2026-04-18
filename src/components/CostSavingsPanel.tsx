const savingsData = {
  erAvoidance: { saved: 842000, avoided: 124, avgCostPer: 6790 },
  hospitalizationAvoidance: { saved: 1240000, avoided: 42, avgCostPer: 29524 },
  internalFeatures: [
    { feature: "Telehealth Platform", savings: 320000, category: "Internal" },
    { feature: "Care Navigation", savings: 180000, category: "Internal" },
    { feature: "Chronic Care Management", savings: 440000, category: "Internal" },
    { feature: "Patient Messaging App", savings: 95000, category: "Internal" },
  ],
  externalFeatures: [
    { feature: "Preferred Lab Network", savings: 210000, category: "External" },
    { feature: "Imaging Center Partnerships", savings: 165000, category: "External" },
    { feature: "Pharmacy Benefit Optimization", savings: 280000, category: "External" },
  ],
  claimsComparison: {
    primeCareVIP: { actual: 1422, benchmark: 1680, pmpm: true },
    heroHealthcare: { actual: 1105, benchmark: 1340, pmpm: true },
  },
};

const formatCurrency = (n: number) => `$${(n / 1000).toFixed(0)}K`;

const CostSavingsPanel = () => {
  const totalInternal = savingsData.internalFeatures.reduce((s, f) => s + f.savings, 0);
  const totalExternal = savingsData.externalFeatures.reduce((s, f) => s + f.savings, 0);
  const grandTotal = savingsData.erAvoidance.saved + savingsData.hospitalizationAvoidance.saved + totalInternal + totalExternal;

  return (
    <div className="space-y-8">
      {/* Grand Total */}
      <div className="glass-panel rounded-lg p-6 border-l-4 border-l-success">
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Total Annualized Savings</p>
        <p className="text-4xl font-mono tracking-tighter text-success">${(grandTotal / 1000000).toFixed(2)}M</p>
        <p className="text-xs text-muted-foreground mt-2">Combined PrimeCare VIP & Hero Healthcare</p>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* ER Avoidance */}
        <div className="glass-panel rounded-lg p-6">
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">ER Avoidance</h3>
          <p className="text-2xl font-mono text-foreground">{formatCurrency(savingsData.erAvoidance.saved)}</p>
          <div className="mt-4 space-y-2 text-xs text-muted-foreground">
            <div className="flex justify-between"><span>Visits Avoided</span><span className="font-mono text-foreground">{savingsData.erAvoidance.avoided}</span></div>
            <div className="flex justify-between"><span>Avg Cost/Visit</span><span className="font-mono text-foreground">${savingsData.erAvoidance.avgCostPer.toLocaleString()}</span></div>
          </div>
        </div>

        {/* Hospitalization */}
        <div className="glass-panel rounded-lg p-6">
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">Hospital Avoidance</h3>
          <p className="text-2xl font-mono text-foreground">${(savingsData.hospitalizationAvoidance.saved / 1000000).toFixed(2)}M</p>
          <div className="mt-4 space-y-2 text-xs text-muted-foreground">
            <div className="flex justify-between"><span>Admissions Avoided</span><span className="font-mono text-foreground">{savingsData.hospitalizationAvoidance.avoided}</span></div>
            <div className="flex justify-between"><span>Avg Cost/Admission</span><span className="font-mono text-foreground">${savingsData.hospitalizationAvoidance.avgCostPer.toLocaleString()}</span></div>
          </div>
        </div>
      </div>

      {/* Internal vs External Features */}
      <div className="grid grid-cols-2 gap-6">
        <div className="glass-panel rounded-lg p-6">
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">Internal Feature Savings</h3>
          <div className="space-y-3">
            {savingsData.internalFeatures.map((f) => (
              <div key={f.feature} className="flex justify-between items-center">
                <span className="text-xs text-foreground/80">{f.feature}</span>
                <span className="text-xs font-mono text-success">{formatCurrency(f.savings)}</span>
              </div>
            ))}
            <div className="border-t border-border pt-3 flex justify-between">
              <span className="text-xs font-bold text-foreground">Total Internal</span>
              <span className="text-sm font-mono font-bold text-success">{formatCurrency(totalInternal)}</span>
            </div>
          </div>
        </div>

        <div className="glass-panel rounded-lg p-6">
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">External Feature Savings</h3>
          <div className="space-y-3">
            {savingsData.externalFeatures.map((f) => (
              <div key={f.feature} className="flex justify-between items-center">
                <span className="text-xs text-foreground/80">{f.feature}</span>
                <span className="text-xs font-mono text-accent">{formatCurrency(f.savings)}</span>
              </div>
            ))}
            <div className="border-t border-border pt-3 flex justify-between">
              <span className="text-xs font-bold text-foreground">Total External</span>
              <span className="text-sm font-mono font-bold text-accent">{formatCurrency(totalExternal)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Claims PMPM Comparison */}
      <div className="glass-panel rounded-lg p-6">
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-6">Claims PMPM vs Benchmark</h3>
        <div className="grid grid-cols-2 gap-8">
          <div>
            <p className="text-xs text-muted-foreground mb-2">PrimeCare VIP</p>
            <div className="flex items-baseline gap-3">
              <span className="text-2xl font-mono text-foreground">${savingsData.claimsComparison.primeCareVIP.actual}</span>
              <span className="text-xs text-muted-foreground">vs ${savingsData.claimsComparison.primeCareVIP.benchmark} benchmark</span>
            </div>
            <div className="mt-3 h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-success rounded-full" style={{ width: `${(savingsData.claimsComparison.primeCareVIP.actual / savingsData.claimsComparison.primeCareVIP.benchmark) * 100}%` }} />
            </div>
            <p className="text-[10px] text-success mt-1.5">
              {((1 - savingsData.claimsComparison.primeCareVIP.actual / savingsData.claimsComparison.primeCareVIP.benchmark) * 100).toFixed(1)}% below benchmark
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-2">Hero Healthcare</p>
            <div className="flex items-baseline gap-3">
              <span className="text-2xl font-mono text-foreground">${savingsData.claimsComparison.heroHealthcare.actual}</span>
              <span className="text-xs text-muted-foreground">vs ${savingsData.claimsComparison.heroHealthcare.benchmark} benchmark</span>
            </div>
            <div className="mt-3 h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-accent rounded-full" style={{ width: `${(savingsData.claimsComparison.heroHealthcare.actual / savingsData.claimsComparison.heroHealthcare.benchmark) * 100}%` }} />
            </div>
            <p className="text-[10px] text-accent mt-1.5">
              {((1 - savingsData.claimsComparison.heroHealthcare.actual / savingsData.claimsComparison.heroHealthcare.benchmark) * 100).toFixed(1)}% below benchmark
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CostSavingsPanel;
