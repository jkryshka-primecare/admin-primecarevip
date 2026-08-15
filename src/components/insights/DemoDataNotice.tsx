import { FlaskConical } from "lucide-react";

/**
 * Marks a legacy panel that still renders illustrative (non-production) data,
 * so live Elation/Hint figures are never confused with demo figures.
 */
export default function DemoDataNotice({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 px-4 py-2">
      <FlaskConical className="h-3.5 w-3.5 text-muted-foreground" />
      <p className="text-xs text-muted-foreground">
        {label ?? "Demo data"} — illustrative figures, not from Elation or Hint.
      </p>
    </div>
  );
}
