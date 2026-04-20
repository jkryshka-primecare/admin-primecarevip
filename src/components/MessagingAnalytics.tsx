import { useMemo, useState } from "react";
import { MessageSquare, Smartphone, Phone, Voicemail, Clock, AlertTriangle, CheckCircle2 } from "lucide-react";
import { messageThreads, channelLabel, avgResponseMin, slaRate, WEEKDAY_SLA_MIN, WEEKEND_SLA_BAND } from "./messaging/mockData";
import type { MessagingChannel, MessagingDrilldownContext } from "./messaging/types";
import MessagingDrilldownDrawer from "./messaging/MessagingDrilldownDrawer";
import MessagingFilterBar, { type MessagingFilters, messagingFilterDefaults } from "./messaging/MessagingFilterBar";
import ResponderLeaderboard from "./messaging/ResponderLeaderboard";

const channelIcon: Record<MessagingChannel, typeof MessageSquare> = {
  chat: MessageSquare,
  sms: Smartphone,
  voice: Phone,
  voicemail: Voicemail,
};

const MessagingAnalytics = () => {
  const [context, setContext] = useState<MessagingDrilldownContext | null>(null);
  const [filters, setFilters] = useState<MessagingFilters>(() => ({
    ...messagingFilterDefaults,
    channels: new Set(messagingFilterDefaults.channels),
  }));

  // Apply date + channel filters to the dataset before any aggregation
  const filteredThreads = useMemo(() => {
    const start = new Date(filters.startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(filters.endDate);
    end.setHours(23, 59, 59, 999);
    return messageThreads.filter((t) => {
      if (!filters.channels.has(t.channel)) return false;
      const ts = new Date(t.receivedAt).getTime();
      return ts >= start.getTime() && ts <= end.getTime();
    });
  }, [filters]);

  const stats = useMemo(() => {
    const total = filteredThreads.length;
    const weekday = filteredThreads.filter((t) => !t.isWeekend);
    const weekend = filteredThreads.filter((t) => t.isWeekend);
    const open = filteredThreads.filter((t) => t.responseMinutes === null);

    const byChannel = (Object.keys(channelLabel) as MessagingChannel[]).map((ch) => {
      const list = filteredThreads.filter((t) => t.channel === ch);
      return {
        channel: ch,
        count: list.length,
        avg: avgResponseMin(list),
        sla: slaRate(list),
        threads: list,
      };
    });

    return {
      total,
      open: open.length,
      weekday: { count: weekday.length, avg: avgResponseMin(weekday), sla: slaRate(weekday), threads: weekday },
      weekend: { count: weekend.length, avg: avgResponseMin(weekend), sla: slaRate(weekend), threads: weekend },
      overallSla: slaRate(filteredThreads),
      byChannel,
      openThreads: open,
    };
  }, [filteredThreads]);

  // Hourly volume — last 7 days bucketed by day for the trend bar
  const dailyTrend = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of filteredThreads) {
      const key = t.receivedAt.slice(0, 10);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-7)
      .map(([date, count]) => ({ date, count }));
  }, [filteredThreads]);
  const maxDaily = Math.max(...dailyTrend.map((d) => d.count), 1);

  const open = (ctx: MessagingDrilldownContext) => setContext(ctx);

  return (
    <div className="space-y-8">
      <MessagingFilterBar
        filters={filters}
        onChange={setFilters}
        matchedCount={filteredThreads.length}
        totalCount={messageThreads.length}
      />

      {/* SLA Hero */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <button
          onClick={() => open({
            metric: "Overall SLA",
            title: `Within-target responses · ${stats.overallSla.toFixed(1)}%`,
            description: `Weekday target: ≤${WEEKDAY_SLA_MIN} min. Weekend (Fri 6pm – Mon 8am): ${WEEKEND_SLA_BAND[0]}–${WEEKEND_SLA_BAND[1]} min.`,
            threads: filteredThreads.filter((t) => t.responseMinutes !== null),
            defaultTab: "threads",
          })}
          className="text-left glass-panel rounded-lg p-6 hover:border-accent/50 transition-colors"
        >
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Overall SLA Met</p>
            <CheckCircle2 className="size-4 text-success" />
          </div>
          <p className={`text-5xl font-mono tracking-tighter ${stats.overallSla >= 90 ? "text-success" : stats.overallSla >= 75 ? "text-foreground" : "text-destructive"}`}>
            {stats.overallSla.toFixed(1)}<span className="text-2xl text-muted-foreground">%</span>
          </p>
          <p className="text-[11px] text-muted-foreground mt-2">
            of answered messages hit target response time
          </p>
        </button>

        <button
          onClick={() => open({
            metric: "Weekday performance",
            title: `Weekday avg ${stats.weekday.avg.toFixed(1)} min · target ≤${WEEKDAY_SLA_MIN} min`,
            description: `${stats.weekday.count} messages received Mon 8am – Fri 6pm. ${stats.weekday.sla.toFixed(1)}% within SLA.`,
            threads: stats.weekday.threads,
            defaultTab: "threads",
          })}
          className="text-left glass-panel rounded-lg p-6 hover:border-accent/50 transition-colors"
        >
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Weekday · Target ≤{WEEKDAY_SLA_MIN} min</p>
            <Clock className="size-4 text-accent" />
          </div>
          <p className={`text-5xl font-mono tracking-tighter ${stats.weekday.avg <= WEEKDAY_SLA_MIN ? "text-success" : "text-destructive"}`}>
            {stats.weekday.avg.toFixed(1)}<span className="text-2xl text-muted-foreground">m</span>
          </p>
          <div className="flex items-center gap-3 mt-2">
            <span className="text-[11px] text-muted-foreground">{stats.weekday.count} msgs</span>
            <span className="text-[11px] text-muted-foreground">·</span>
            <span className="text-[11px] font-mono text-muted-foreground">{stats.weekday.sla.toFixed(0)}% in SLA</span>
          </div>
        </button>

        <button
          onClick={() => open({
            metric: "Weekend performance",
            title: `Weekend avg ${stats.weekend.avg.toFixed(1)} min · band ${WEEKEND_SLA_BAND[0]}–${WEEKEND_SLA_BAND[1]} min`,
            description: `${stats.weekend.count} messages received Fri 6pm – Mon 8am. ${stats.weekend.sla.toFixed(1)}% within SLA.`,
            threads: stats.weekend.threads,
            defaultTab: "threads",
          })}
          className="text-left glass-panel rounded-lg p-6 hover:border-accent/50 transition-colors"
        >
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Weekend · Target {WEEKEND_SLA_BAND[0]}–{WEEKEND_SLA_BAND[1]} min</p>
            <Clock className="size-4 text-accent" />
          </div>
          <p className={`text-5xl font-mono tracking-tighter ${stats.weekend.avg <= WEEKEND_SLA_BAND[1] ? "text-success" : "text-destructive"}`}>
            {stats.weekend.avg.toFixed(1)}<span className="text-2xl text-muted-foreground">m</span>
          </p>
          <div className="flex items-center gap-3 mt-2">
            <span className="text-[11px] text-muted-foreground">{stats.weekend.count} msgs</span>
            <span className="text-[11px] text-muted-foreground">·</span>
            <span className="text-[11px] font-mono text-muted-foreground">{stats.weekend.sla.toFixed(0)}% in SLA</span>
          </div>
        </button>
      </div>

      {/* Channel tiles */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">By Channel</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          {stats.byChannel.map((c) => {
            const Icon = channelIcon[c.channel];
            const isVoice = c.channel === "voice";
            return (
              <button
                key={c.channel}
                onClick={() => open({
                  metric: channelLabel[c.channel],
                  title: `${channelLabel[c.channel]} · ${c.count} threads`,
                  description: isVoice
                    ? `Inbound calls. Avg time-to-answer reflects voicemail callbacks; live answers shown separately.`
                    : `Avg response ${c.avg.toFixed(1)} min · ${c.sla.toFixed(1)}% within SLA.`,
                  threads: c.threads,
                  defaultTab: "threads",
                })}
                className="text-left glass-panel rounded-lg p-5 hover:border-accent/50 transition-colors"
              >
                <div className="flex items-center justify-between mb-3">
                  <Icon className="size-4 text-accent" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{channelLabel[c.channel]}</span>
                </div>
                <p className="text-3xl font-mono tracking-tighter text-foreground">{c.count}</p>
                <div className="mt-3 space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-muted-foreground">Avg resp</span>
                    <span className="font-mono text-foreground">{c.avg === 0 ? "—" : `${c.avg.toFixed(1)}m`}</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-muted-foreground">SLA met</span>
                    <span className={`font-mono ${c.sla >= 90 ? "text-success" : c.sla >= 75 ? "text-foreground" : "text-destructive"}`}>
                      {c.sla.toFixed(0)}%
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Daily volume */}
        <div className="col-span-12 lg:col-span-7 glass-panel rounded-lg p-6">
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-6">Daily Volume · Last 7 Days</h3>
          <div className="flex items-end gap-3 h-40">
            {dailyTrend.map((d) => {
              const date = new Date(d.date);
              const day = date.getDay();
              const isWeekend = day === 0 || day === 6 || day === 5;
              return (
                <div key={d.date} className="flex-1 flex flex-col items-center gap-2">
                  <span className="text-[10px] font-mono text-muted-foreground">{d.count}</span>
                  <div
                    className={`w-full rounded-t transition-colors ${isWeekend ? "bg-destructive/50 hover:bg-destructive/70" : "bg-accent/60 hover:bg-accent"}`}
                    style={{ height: `${(d.count / maxDaily) * 100}%`, minHeight: "4px" }}
                  />
                  <span className="text-[9px] text-muted-foreground">
                    {date.toLocaleDateString(undefined, { weekday: "short" })}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-4 mt-4 text-[10px] uppercase tracking-wider text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-accent/60" /> Weekday</span>
            <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-destructive/50" /> Weekend window</span>
          </div>
        </div>

        {/* Open / breach watchlist */}
        <button
          onClick={() => open({
            metric: "Open threads",
            title: `${stats.open} open conversations`,
            description: "Patient messages with no staff response yet. Resolve to protect SLA.",
            threads: stats.openThreads,
            defaultTab: "threads",
          })}
          className="col-span-12 lg:col-span-5 text-left glass-panel rounded-lg p-6 hover:border-destructive/50 transition-colors"
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Open · Needs Response</h3>
            <AlertTriangle className="size-4 text-destructive" />
          </div>
          <p className={`text-5xl font-mono tracking-tighter ${stats.open === 0 ? "text-success" : "text-destructive"}`}>
            {stats.open}
          </p>
          <p className="text-[11px] text-muted-foreground mt-2">
            Click to triage open threads across every channel.
          </p>
          <div className="mt-4 space-y-2">
            {stats.openThreads.slice(0, 3).map((t) => {
              const Icon = channelIcon[t.channel];
              return (
                <div key={t.id} className="flex items-center gap-2 text-xs">
                  <Icon className="size-3 text-accent shrink-0" />
                  <span className="text-foreground/80 truncate">{t.patientName}</span>
                  <span className="text-muted-foreground truncate">— {t.subject}</span>
                </div>
              );
            })}
          </div>
        </button>
      </div>

      <ResponderLeaderboard
        threads={filteredThreads}
        onSelectResponder={(responder, threads) =>
          open({
            metric: "Responder",
            title: `${responder} · ${threads.length} threads`,
            description: `All messages handled by ${responder} in the current filter window.`,
            threads,
            defaultTab: "threads",
          })
        }
      />

      <MessagingDrilldownDrawer context={context} onClose={() => setContext(null)} />
    </div>
  );
};

export default MessagingAnalytics;
