import { format } from "date-fns";
import { CalendarIcon, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { channelLabel } from "./mockData";
import type { MessagingChannel } from "./types";

export interface MessagingFilters {
  startDate: Date;
  endDate: Date;
  channels: Set<MessagingChannel>;
}

export const ALL_CHANNELS: MessagingChannel[] = ["chat", "sms", "voice", "voicemail"];

export const messagingFilterDefaults: MessagingFilters = {
  startDate: new Date("2026-04-10"),
  endDate: new Date("2026-04-17"),
  channels: new Set(ALL_CHANNELS),
};

interface Props {
  filters: MessagingFilters;
  onChange: (next: MessagingFilters) => void;
  matchedCount: number;
  totalCount: number;
}

const labelClass = "text-[10px] font-bold uppercase tracking-widest text-muted-foreground";

const DateField = ({
  label, value, onChange,
}: { label: string; value: Date; onChange: (d: Date) => void }) => (
  <div className="flex flex-col gap-1">
    <span className={labelClass}>{label}</span>
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="h-9 justify-start text-left font-mono text-xs gap-2 bg-secondary border-border"
        >
          <CalendarIcon className="size-3.5 opacity-60" />
          {format(value, "yyyy-MM-dd")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0 bg-popover" align="start">
        <Calendar
          mode="single"
          selected={value}
          onSelect={(d) => d && onChange(d)}
          initialFocus
          className={cn("p-3 pointer-events-auto")}
        />
      </PopoverContent>
    </Popover>
  </div>
);

const MessagingFilterBar = ({ filters, onChange, matchedCount, totalCount }: Props) => {
  const toggleChannel = (ch: MessagingChannel) => {
    const next = new Set(filters.channels);
    if (next.has(ch)) {
      // Don't allow zero channels — re-enable all if user tries to deselect last
      if (next.size === 1) {
        onChange({ ...filters, channels: new Set(ALL_CHANNELS) });
        return;
      }
      next.delete(ch);
    } else {
      next.add(ch);
    }
    onChange({ ...filters, channels: next });
  };

  const reset = () =>
    onChange({
      startDate: messagingFilterDefaults.startDate,
      endDate: messagingFilterDefaults.endDate,
      channels: new Set(ALL_CHANNELS),
    });

  const isFiltered =
    filters.channels.size !== ALL_CHANNELS.length ||
    filters.startDate.getTime() !== messagingFilterDefaults.startDate.getTime() ||
    filters.endDate.getTime() !== messagingFilterDefaults.endDate.getTime();

  return (
    <div className="bg-card border border-border rounded-lg p-4 shadow-card">
      <div className="flex flex-wrap items-end gap-3">
        <DateField
          label="Start Date"
          value={filters.startDate}
          onChange={(d) => onChange({ ...filters, startDate: d })}
        />
        <DateField
          label="End Date"
          value={filters.endDate}
          onChange={(d) => onChange({ ...filters, endDate: d })}
        />

        <div className="flex flex-col gap-1">
          <span className={labelClass}>Channels</span>
          <div className="flex flex-wrap gap-1.5">
            {ALL_CHANNELS.map((ch) => {
              const active = filters.channels.has(ch);
              return (
                <button
                  key={ch}
                  type="button"
                  onClick={() => toggleChannel(ch)}
                  className={cn(
                    "h-9 px-3 rounded-md text-xs font-mono border transition-colors",
                    active
                      ? "bg-accent/15 border-accent/60 text-foreground"
                      : "bg-secondary border-border text-muted-foreground hover:text-foreground",
                  )}
                  aria-pressed={active}
                >
                  {channelLabel[ch]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <div className="flex flex-col items-end">
            <span className={labelClass}>Threads in window</span>
            <span className="font-mono text-lg text-foreground">
              {matchedCount}{" "}
              <span className="text-xs text-muted-foreground">/ {totalCount}</span>
            </span>
          </div>
          {isFiltered && (
            <Button
              variant="outline"
              size="sm"
              onClick={reset}
              className="gap-2 text-xs border-border"
            >
              <RotateCcw className="size-3.5" /> Reset
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default MessagingFilterBar;
