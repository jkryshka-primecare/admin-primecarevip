import { useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { X, MessageSquare, Smartphone, Phone, Voicemail } from "lucide-react";
import type { MessagingChannel, MessagingDrilldownContext } from "./types";
import { channelLabel, formatResponse } from "./mockData";

interface Props {
  context: MessagingDrilldownContext | null;
  onClose: () => void;
}

const channelIcon: Record<MessagingChannel, typeof MessageSquare> = {
  chat: MessageSquare,
  sms: Smartphone,
  voice: Phone,
  voicemail: Voicemail,
};

const MessagingDrilldownDrawer = ({ context, onClose }: Props) => {
  const [tab, setTab] = useState<"patients" | "threads">(context?.defaultTab ?? "patients");

  const patientRows = useMemo(() => {
    if (!context) return [];
    const map = new Map<string, { id: string; name: string; threads: typeof context.threads; avg: number; sla: number }>();
    for (const t of context.threads) {
      const key = t.patientId;
      const entry = map.get(key) ?? { id: t.patientId, name: t.patientName, threads: [], avg: 0, sla: 0 };
      entry.threads.push(t);
      map.set(key, entry);
    }
    return Array.from(map.values()).map((p) => {
      const answered = p.threads.filter((t) => t.responseMinutes !== null);
      const live = p.threads.filter((t) => t.channel === "voice" && t.responseMinutes === 0);
      const timed = answered.filter((t) => !(t.channel === "voice" && t.responseMinutes === 0));
      const avg = timed.length === 0 ? 0 : timed.reduce((a, t) => a + (t.responseMinutes ?? 0), 0) / timed.length;
      const slaCount = answered.filter((t) => t.withinSla).length;
      const sla = answered.length === 0 ? 0 : (slaCount / answered.length) * 100;
      return { ...p, avg, sla, liveCalls: live.length };
    }).sort((a, b) => b.threads.length - a.threads.length);
  }, [context]);

  if (!context) {
    return <Sheet open={false} onOpenChange={() => onClose()}><SheetContent /></Sheet>;
  }

  return (
    <Sheet open={!!context} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-3xl bg-card border-l border-border p-0 flex flex-col"
      >
        <SheetHeader className="px-6 py-5 border-b border-border space-y-2">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-widest text-accent">
                {context.metric}
              </p>
              <SheetTitle className="font-serif text-xl tracking-tight text-foreground">
                {context.title}
              </SheetTitle>
              <SheetDescription className="text-xs text-muted-foreground">
                {context.description}
              </SheetDescription>
            </div>
            <button
              onClick={onClose}
              className="size-8 rounded-full border border-border bg-secondary text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center shrink-0"
              aria-label="Close drilldown"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <span className="px-2 py-0.5 rounded bg-accent/10 text-accent text-[10px] font-bold uppercase tracking-wider border border-accent/20">
              {context.threads.length} threads · {patientRows.length} patients
            </span>
          </div>
        </SheetHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "patients" | "threads")} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="mx-6 mt-4 self-start">
            <TabsTrigger value="patients">Patients</TabsTrigger>
            <TabsTrigger value="threads">Threads</TabsTrigger>
          </TabsList>

          <TabsContent value="patients" className="flex-1 overflow-y-auto mt-4">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card border-b border-border">
                <tr className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  <th className="text-left px-6 py-3">Patient</th>
                  <th className="text-right px-3 py-3">Threads</th>
                  <th className="text-right px-3 py-3">Avg Resp</th>
                  <th className="text-right px-3 py-3">SLA %</th>
                  <th className="text-right px-6 py-3">Live Calls</th>
                </tr>
              </thead>
              <tbody>
                {patientRows.map((p) => (
                  <tr key={p.id} className="border-b border-border hover:bg-accent/10 transition-colors">
                    <td className="px-6 py-3">
                      <div className="flex flex-col">
                        <span className="font-mono text-xs text-accent">{p.id}</span>
                        <span className="text-foreground">{p.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-xs">{p.threads.length}</td>
                    <td className="px-3 py-3 text-right font-mono text-xs">{p.avg === 0 ? "—" : `${p.avg.toFixed(1)}m`}</td>
                    <td className="px-3 py-3 text-right font-mono text-xs">
                      <span className={p.sla >= 90 ? "text-success" : p.sla >= 70 ? "text-foreground" : "text-destructive"}>
                        {p.sla.toFixed(0)}%
                      </span>
                    </td>
                    <td className="px-6 py-3 text-right font-mono text-xs">{p.liveCalls}</td>
                  </tr>
                ))}
                {patientRows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-sm text-muted-foreground">
                      No patients match this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </TabsContent>

          <TabsContent value="threads" className="flex-1 overflow-y-auto mt-4">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card border-b border-border">
                <tr className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  <th className="text-left px-6 py-3">Channel</th>
                  <th className="text-left px-3 py-3">Patient · Subject</th>
                  <th className="text-left px-3 py-3">Received</th>
                  <th className="text-right px-3 py-3">Response</th>
                  <th className="text-right px-6 py-3">SLA</th>
                </tr>
              </thead>
              <tbody>
                {context.threads.map((t) => {
                  const Icon = channelIcon[t.channel];
                  const breach = t.responseMinutes !== null && !t.withinSla;
                  return (
                    <tr key={t.id} className="border-b border-border hover:bg-accent/10 transition-colors">
                      <td className="px-6 py-3">
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          <Icon className="size-3.5 text-accent" />
                          <span className="text-foreground/80">{channelLabel[t.channel]}</span>
                          {t.isWeekend && (
                            <span className="ml-1 px-1.5 py-0.5 rounded bg-secondary text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                              W/E
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-col">
                          <span className="text-foreground text-xs">{t.patientName}</span>
                          <span className="text-[11px] text-muted-foreground truncate max-w-[260px]">{t.subject}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 font-mono text-[11px] text-muted-foreground">
                        {new Date(t.receivedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-xs">
                        {formatResponse(t.responseMinutes, t.channel)}
                      </td>
                      <td className="px-6 py-3 text-right">
                        {t.responseMinutes === null ? (
                          <span className="text-[10px] font-bold uppercase tracking-wider text-destructive">Open</span>
                        ) : breach ? (
                          <span className="text-[10px] font-bold uppercase tracking-wider text-destructive">Breach</span>
                        ) : (
                          <span className="text-[10px] font-bold uppercase tracking-wider text-success">Met</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {context.threads.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-sm text-muted-foreground">
                      No threads match this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
};

export default MessagingDrilldownDrawer;
