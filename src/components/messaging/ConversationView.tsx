import { useMemo, useState } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { X, Send, MessageSquare, Smartphone, Phone, Voicemail, User, Stethoscope, Clock, CheckCircle2, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { MessageThread, MessagingChannel } from "./types";
import { channelLabel, formatResponse, WEEKDAY_SLA_MIN, WEEKEND_SLA_BAND } from "./mockData";

interface Props {
  thread: MessageThread | null;
  onClose: () => void;
}

const channelIcon: Record<MessagingChannel, typeof MessageSquare> = {
  chat: MessageSquare,
  sms: Smartphone,
  voice: Phone,
  voicemail: Voicemail,
};

interface TimelineEntry {
  id: string;
  author: "patient" | "staff" | "system";
  authorName: string;
  body: string;
  /** ISO */
  at: string;
}

/** Deterministic conversation timeline derived from the thread. */
const buildTimeline = (t: MessageThread): TimelineEntry[] => {
  const received = new Date(t.receivedAt);
  const entries: TimelineEntry[] = [];

  // Initial inbound
  if (t.channel === "voicemail") {
    entries.push({
      id: `${t.id}-vm`,
      author: "system",
      authorName: "Voicemail system",
      body: `Voicemail received from ${t.patientName} — 0:42 duration. Transcript: "${t.subject}. Please call me back when you can."`,
      at: received.toISOString(),
    });
  } else if (t.channel === "voice") {
    entries.push({
      id: `${t.id}-call`,
      author: "system",
      authorName: "Phone system",
      body: `Inbound call from ${t.patientName}.`,
      at: received.toISOString(),
    });
  } else {
    entries.push({
      id: `${t.id}-in`,
      author: "patient",
      authorName: t.patientName,
      body: `${t.subject}. Could you take a look when you have a moment? Thanks.`,
      at: received.toISOString(),
    });
  }

  if (t.responseMinutes !== null) {
    const respondedAt = new Date(received.getTime() + t.responseMinutes * 60_000);
    if (t.channel === "voice" && t.responseMinutes === 0) {
      entries.push({
        id: `${t.id}-live`,
        author: "staff",
        authorName: t.responder ?? "Front Desk",
        body: `Answered live. Call duration ~6 min. Notes: addressed "${t.subject}" and confirmed next steps with patient.`,
        at: respondedAt.toISOString(),
      });
    } else if (t.channel === "voicemail") {
      entries.push({
        id: `${t.id}-cb`,
        author: "staff",
        authorName: t.responder ?? "Care Team",
        body: `Returned call. Spoke with ${t.patientName} re: "${t.subject}". Outcome documented in chart.`,
        at: respondedAt.toISOString(),
      });
    } else {
      entries.push({
        id: `${t.id}-reply`,
        author: "staff",
        authorName: t.responder ?? "Care Team",
        body: `Hi ${t.patientName.split(" ")[0]} — thanks for reaching out. We've reviewed your note and will help you with this right away. Let us know if anything changes in the meantime.`,
        at: respondedAt.toISOString(),
      });
      // Patient ack
      entries.push({
        id: `${t.id}-ack`,
        author: "patient",
        authorName: t.patientName,
        body: `Thank you, appreciate the quick response.`,
        at: new Date(respondedAt.getTime() + 4 * 60_000).toISOString(),
      });
    }
  }

  return entries;
};

const ConversationView = ({ thread, onClose }: Props) => {
  const { toast } = useToast();
  const [reply, setReply] = useState("");
  const [extraEntries, setExtraEntries] = useState<TimelineEntry[]>([]);

  const timeline = useMemo(() => {
    if (!thread) return [];
    return [...buildTimeline(thread), ...extraEntries];
  }, [thread, extraEntries]);

  if (!thread) {
    return <Sheet open={false} onOpenChange={() => onClose()}><SheetContent /></Sheet>;
  }

  const Icon = channelIcon[thread.channel];
  const slaTarget = thread.isWeekend
    ? `${WEEKEND_SLA_BAND[0]}–${WEEKEND_SLA_BAND[1]} min`
    : `≤${WEEKDAY_SLA_MIN} min`;

  const handleSend = () => {
    const body = reply.trim();
    if (!body) return;
    setExtraEntries((prev) => [
      ...prev,
      {
        id: `${thread.id}-new-${prev.length}`,
        author: "staff",
        authorName: "You",
        body,
        at: new Date().toISOString(),
      },
    ]);
    setReply("");
    toast({
      title: "Reply sent",
      description: `Sent to ${thread.patientName} via ${channelLabel[thread.channel]}.`,
    });
  };

  return (
    <Sheet open={!!thread} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl bg-card border-l border-border p-0 flex flex-col"
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-border space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1.5 min-w-0">
              <div className="flex items-center gap-2">
                <Icon className="size-4 text-accent shrink-0" />
                <p className="text-[10px] font-bold uppercase tracking-widest text-accent">
                  {channelLabel[thread.channel]} · {thread.id}
                </p>
              </div>
              <h2 className="font-serif text-xl tracking-tight text-foreground truncate">
                {thread.subject}
              </h2>
              <p className="text-xs text-muted-foreground">
                <span className="font-mono text-accent">{thread.patientId}</span> · {thread.patientName}
              </p>
            </div>
            <button
              onClick={onClose}
              className="size-8 rounded-full border border-border bg-secondary text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center shrink-0"
              aria-label="Close conversation"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="px-2 py-0.5 rounded bg-secondary text-[10px] font-bold uppercase tracking-wider text-muted-foreground border border-border">
              {thread.isWeekend ? "Weekend" : "Weekday"} · target {slaTarget}
            </span>
            {thread.responder && (
              <span className="px-2 py-0.5 rounded bg-accent/10 text-accent text-[10px] font-bold uppercase tracking-wider border border-accent/20">
                Responder · {thread.responder}
              </span>
            )}
            {thread.responseMinutes === null ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-destructive/10 text-destructive text-[10px] font-bold uppercase tracking-wider border border-destructive/20">
                <AlertTriangle className="size-3" /> Open
              </span>
            ) : thread.withinSla ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-success/10 text-success text-[10px] font-bold uppercase tracking-wider border border-success/20">
                <CheckCircle2 className="size-3" /> Met · {formatResponse(thread.responseMinutes, thread.channel)}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-destructive/10 text-destructive text-[10px] font-bold uppercase tracking-wider border border-destructive/20">
                <AlertTriangle className="size-3" /> Breach · {formatResponse(thread.responseMinutes, thread.channel)}
              </span>
            )}
          </div>
        </div>

        {/* Timeline */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
          {timeline.map((entry) => {
            const isPatient = entry.author === "patient";
            const isSystem = entry.author === "system";
            return (
              <div key={entry.id} className={`flex gap-3 ${isPatient ? "flex-row" : isSystem ? "flex-row" : "flex-row-reverse"}`}>
                <div className={`size-8 shrink-0 rounded-full flex items-center justify-center border ${
                  isPatient ? "bg-secondary border-border text-muted-foreground"
                    : isSystem ? "bg-secondary border-border text-muted-foreground"
                    : "bg-accent/15 border-accent/30 text-accent"
                }`}>
                  {isPatient ? <User className="size-4" /> : isSystem ? <Clock className="size-4" /> : <Stethoscope className="size-4" />}
                </div>
                <div className={`max-w-[75%] space-y-1 ${isPatient || isSystem ? "items-start" : "items-end"} flex flex-col`}>
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider">
                    <span className={`font-bold ${isPatient ? "text-foreground" : isSystem ? "text-muted-foreground" : "text-accent"}`}>
                      {entry.authorName}
                    </span>
                    <span className="font-mono text-muted-foreground">
                      {new Date(entry.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    </span>
                  </div>
                  <div className={`rounded-lg px-4 py-2.5 text-sm leading-relaxed ${
                    isPatient ? "bg-secondary text-foreground border border-border"
                      : isSystem ? "bg-secondary/50 text-muted-foreground border border-dashed border-border italic"
                      : "bg-accent/10 text-foreground border border-accent/20"
                  }`}>
                    {entry.body}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Reply composer */}
        <div className="border-t border-border px-6 py-4 bg-card space-y-3">
          <Textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder={`Reply to ${thread.patientName} via ${channelLabel[thread.channel]}…`}
            rows={3}
            className="resize-none bg-background"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
              ⌘/Ctrl + Enter to send
            </p>
            <Button onClick={handleSend} disabled={!reply.trim()} className="gap-2">
              <Send className="size-3.5" /> Send reply
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default ConversationView;
