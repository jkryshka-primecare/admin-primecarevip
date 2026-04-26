import { useState } from "react";
import { History, ChevronDown, ChevronUp } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { usePriceAuditLog } from "@/hooks/useEstimatorDb";

export function AuditLogPanel() {
  const [open, setOpen] = useState(false);
  const { data: logs = [] } = usePriceAuditLog(50);

  return (
    <div className="mt-6 border border-border rounded-lg bg-card overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className="flex items-center gap-1.5 font-mono uppercase tracking-wider">
          <History className="h-3.5 w-3.5" />
          Price Change History ({logs.length})
        </span>
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      {open && (
        <div className="max-h-64 overflow-y-auto px-4 pb-3 border-t border-border">
          {logs.length === 0 ? (
            <p className="text-xs text-muted-foreground py-3">No price changes recorded yet.</p>
          ) : (
            <div className="space-y-1.5 pt-2">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-baseline justify-between gap-4 text-xs py-1 border-b border-border last:border-b-0"
                >
                  <div className="min-w-0">
                    <span className="font-medium text-foreground">{log.component}</span>
                    <span className="text-muted-foreground ml-1.5 font-mono">
                      ${Number(log.old_price).toLocaleString()} → ${Number(log.new_price).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 text-muted-foreground">
                    {log.changed_by_name && <span>{log.changed_by_name}</span>}
                    <span className="tabular-nums font-mono">
                      {formatDistanceToNow(new Date(log.changed_at), { addSuffix: true })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
