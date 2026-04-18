const engagementData = {
  onboardingStats: {
    totalOnboarded: 1248,
    thisMonth: 84,
    conversionRate: 72.4,
    avgOnboardingDays: 3.2,
  },
  utilizationMetrics: {
    primaryCareVisits: 3412,
    telehealth: 1894,
    urgentCare: 342,
    messaging: 8204,
  },
  gaps: [
    { metric: "Annual Wellness Visit", completed: 68, total: 100, entity: "PrimeCare VIP" },
    { metric: "Diabetic Eye Exam", completed: 42, total: 100, entity: "PrimeCare VIP" },
    { metric: "Mammography Screening", completed: 55, total: 100, entity: "Hero Healthcare" },
    { metric: "Colorectal Screening", completed: 38, total: 100, entity: "Hero Healthcare" },
  ],
};

const EngagementPanel = () => {
  return (
    <div className="space-y-8">
      {/* Onboarding Stats from Hint */}
      <div className="glass-panel rounded-lg p-6">
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-6">
          Onboarding Pipeline (Hint)
        </h3>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <p className="text-xs text-muted-foreground">Total Onboarded</p>
            <p className="text-2xl font-mono text-foreground">{engagementData.onboardingStats.totalOnboarded.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">This Month</p>
            <p className="text-2xl font-mono text-foreground">+{engagementData.onboardingStats.thisMonth}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Conversion Rate</p>
            <p className="text-2xl font-mono text-accent">{engagementData.onboardingStats.conversionRate}%</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Avg. Days to Onboard</p>
            <p className="text-2xl font-mono text-foreground">{engagementData.onboardingStats.avgOnboardingDays}</p>
          </div>
        </div>
      </div>

      {/* Utilization Metrics from Elation */}
      <div className="glass-panel rounded-lg p-6">
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-6">
          Service Utilization (Elation)
        </h3>
        <div className="space-y-5">
          {[
            { label: "Primary Care Visits", value: engagementData.utilizationMetrics.primaryCareVisits, max: 5000, color: "bg-primary" },
            { label: "Telehealth Sessions", value: engagementData.utilizationMetrics.telehealth, max: 5000, color: "bg-accent" },
            { label: "Urgent Care Diversions", value: engagementData.utilizationMetrics.urgentCare, max: 5000, color: "bg-destructive" },
            { label: "Patient Messages", value: engagementData.utilizationMetrics.messaging, max: 10000, color: "bg-success" },
          ].map((item) => (
            <div key={item.label}>
              <div className="flex justify-between mb-1.5">
                <span className="text-xs font-medium text-foreground/70">{item.label}</span>
                <span className="text-xs font-mono text-foreground">{item.value.toLocaleString()}</span>
              </div>
              <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${item.color}`} style={{ width: `${(item.value / item.max) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Utilization Gaps */}
      <div className="glass-panel rounded-lg p-6">
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-6">
          Utilization Gaps
        </h3>
        <div className="space-y-4">
          {engagementData.gaps.map((gap) => (
            <div key={gap.metric} className="flex items-center justify-between">
              <div className="flex-1">
                <div className="flex justify-between mb-1">
                  <span className="text-xs font-medium text-foreground/80">{gap.metric}</span>
                  <span className="text-[10px] text-muted-foreground">{gap.entity}</span>
                </div>
                <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${gap.completed >= 60 ? "bg-success" : gap.completed >= 40 ? "bg-accent" : "bg-destructive"}`}
                    style={{ width: `${gap.completed}%` }}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">{gap.completed}% compliance</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default EngagementPanel;
