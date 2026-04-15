const messagingData = {
  totalMessages: 8204,
  responseRate: 94.2,
  avgResponseTime: "2.4 hrs",
  activeConversations: 342,
  byType: [
    { type: "Clinical Questions", count: 2841, pct: 34.6 },
    { type: "Appointment Requests", count: 1804, pct: 22.0 },
    { type: "Medication Refills", count: 1520, pct: 18.5 },
    { type: "Lab Results Follow-up", count: 1240, pct: 15.1 },
    { type: "Administrative", count: 799, pct: 9.7 },
  ],
  weeklyTrend: [620, 740, 810, 920, 880, 1040, 1194],
};

const MessagingAnalytics = () => {
  const maxWeekly = Math.max(...messagingData.weeklyTrend);

  return (
    <div className="space-y-8">
      {/* KPIs */}
      <div className="grid grid-cols-4 gap-6">
        <div className="glass-panel rounded-lg p-6">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Total Messages</p>
          <p className="text-3xl font-mono tracking-tighter text-foreground">{messagingData.totalMessages.toLocaleString()}</p>
        </div>
        <div className="glass-panel rounded-lg p-6">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Response Rate</p>
          <p className="text-3xl font-mono tracking-tighter text-cyan-clinical">{messagingData.responseRate}%</p>
        </div>
        <div className="glass-panel rounded-lg p-6">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Avg Response Time</p>
          <p className="text-3xl font-mono tracking-tighter text-foreground">{messagingData.avgResponseTime}</p>
        </div>
        <div className="glass-panel rounded-lg p-6">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Active Threads</p>
          <p className="text-3xl font-mono tracking-tighter text-foreground">{messagingData.activeConversations}</p>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-8">
        {/* Weekly Trend */}
        <div className="col-span-7 glass-panel rounded-lg p-6">
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-6">Weekly Message Volume</h3>
          <div className="flex items-end gap-3 h-40">
            {messagingData.weeklyTrend.map((val, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-2">
                <span className="text-[10px] font-mono text-muted-foreground">{val}</span>
                <div
                  className="w-full bg-sapphire/40 rounded-t hover:bg-sapphire/60 transition-colors"
                  style={{ height: `${(val / maxWeekly) * 100}%` }}
                />
                <span className="text-[9px] text-muted-foreground">W{i + 1}</span>
              </div>
            ))}
          </div>
        </div>

        {/* By Type */}
        <div className="col-span-5 glass-panel rounded-lg p-6">
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-6">Message Categories</h3>
          <div className="space-y-4">
            {messagingData.byType.map((t) => (
              <div key={t.type}>
                <div className="flex justify-between mb-1">
                  <span className="text-xs text-foreground/80">{t.type}</span>
                  <span className="text-xs font-mono text-muted-foreground">{t.pct}%</span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-cyan-clinical/60 rounded-full" style={{ width: `${t.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MessagingAnalytics;
