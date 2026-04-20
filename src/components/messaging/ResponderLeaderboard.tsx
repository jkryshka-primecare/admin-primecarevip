import { useMemo } from "react";
import { Trophy, TrendingUp, AlertTriangle } from "lucide-react";
import type { MessageThread } from "./types";
import { formatResponse } from "./mockData";

interface Props {
  threads: MessageThread[];
  onSelectResponder: (responder: string, threads: MessageThread[]) => void;
}

interface Row {
  responder: string;
  total: number;
  answered: number;
  avg: number;
  sla: number;
  weekend: number;
  open: number;
  threads: MessageThread[];
}

const ResponderLeaderboard = ({ threads, onSelectResponder }: Props) => {
  const rows = useMemo<Row[]>(() => {
    const map = new Map<string, MessageThread[]>();
    for (const t of threads) {
      const key = t.responder ?? "Unassigned";
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    }
    return Array.from(map.entries())
      .map(([responder, list]) => {
        const answered = list.filter((t) => t.responseMinutes !== null);
        // exclude live-answered voice from avg so it isn't artificially 0
        const timed = answered.filter((t) => !(t.channel === "voice" && t.responseMinutes === 0));
        const avg = timed.length === 0 ? 0 : timed.reduce((a, t) => a + (t.responseMinutes ?? 0), 0) / timed.length;
        const slaCount = answered.filter((t) => t.withinSla).length;
        const sla = answered.length === 0 ? 0 : (slaCount / answered.length) * 100;
        return {
          responder,
          total: list.length,
          answered: answered.length,
          avg,
          sla,
          weekend: list.filter((t) => t.isWeekend).length,
          open: list.filter((t) => t.responseMinutes === null).length,
          threads: list,
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [threads]);

  const maxVolume = Math.max(...rows.map((r) => r.total), 1);
  const topSla = rows.filter((r) => r.answered >= 2).reduce<Row | null>((best, r) => (!best || r.sla > best.sla ? r : best), null);
  const needsCoaching = rows.filter((r) => r.answered >= 2 && r.sla < 75);

  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="glass-panel rounded-lg p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Responder Leaderboard</h3>
          <p className="text-[11px] text-muted-foreground mt-1">
            Volume, average response time, and SLA hit rate per staff member.
          </p>
        </div>
        <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider">
          {topSla && (
            <span className="inline-flex items-center gap-1.5 text-success">
              <Trophy className="size-3.5" />
              <span className="font-bold">Top: {topSla.responder}</span>
            </span>
          )}
          {needsCoaching.length > 0 && (
            <span className="inline-flex items-center gap-1.5 text-destructive">
              <AlertTriangle className="size-3.5" />
              <span className="font-bold">{needsCoaching.length} need coaching</span>
            </span>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border">
              <th className="text-left py-2 pr-3">Responder</th>
              <th className="text-left py-2 px-3 w-[28%]">Volume</th>
              <th className="text-right py-2 px-3">Answered</th>
              <th className="text-right py-2 px-3">Avg Resp</th>
              <th className="text-right py-2 px-3">SLA %</th>
              <th className="text-right py-2 px-3">Weekend</th>
              <th className="text-right py-2 pl-3">Open</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const slaColor = r.answered === 0
                ? "text-muted-foreground"
                : r.sla >= 90 ? "text-success" : r.sla >= 75 ? "text-foreground" : "text-destructive";
              const isTop = topSla?.responder === r.responder;
              const isCoaching = needsCoaching.some((c) => c.responder === r.responder);
              return (
                <tr
                  key={r.responder}
                  onClick={() => onSelectResponder(r.responder, r.threads)}
                  className="border-b border-border/60 hover:bg-accent/10 transition-colors cursor-pointer"
                >
                  <td className="py-3 pr-3">
                    <div className="flex items-center gap-2">
                      {isTop && <Trophy className="size-3.5 text-success shrink-0" />}
                      {isCoaching && <TrendingUp className="size-3.5 text-destructive shrink-0 rotate-180" />}
                      <span className="text-foreground">{r.responder}</span>
                    </div>
                  </td>
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                        <div
                          className="h-full bg-accent/70 rounded-full"
                          style={{ width: `${(r.total / maxVolume) * 100}%` }}
                        />
                      </div>
                      <span className="font-mono text-xs text-foreground w-8 text-right">{r.total}</span>
                    </div>
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-xs text-muted-foreground">
                    {r.answered}/{r.total}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-xs">
                    {r.avg === 0 ? <span className="text-muted-foreground">—</span> : formatResponse(Math.round(r.avg), "chat")}
                  </td>
                  <td className={`py-3 px-3 text-right font-mono text-xs ${slaColor}`}>
                    {r.answered === 0 ? "—" : `${r.sla.toFixed(0)}%`}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-xs text-muted-foreground">
                    {r.weekend}
                  </td>
                  <td className="py-3 pl-3 text-right font-mono text-xs">
                    <span className={r.open === 0 ? "text-muted-foreground" : "text-destructive"}>{r.open}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ResponderLeaderboard;
