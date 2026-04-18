import { ChevronRight } from "lucide-react";

interface Props {
  title: string;
  primary: string;
  primaryUnit?: string;
  secondary?: { value: string; label: string }[];
  description: string;
  onClick: () => void;
}

const MetricTile = ({ title, primary, primaryUnit, secondary, description, onClick }: Props) => {
  return (
    <button
      onClick={onClick}
      className="group relative text-left bg-card border border-border rounded-lg p-5 shadow-card hover:shadow-elevated hover:border-accent/40 transition-all flex flex-col justify-between min-h-[148px] focus:outline-none focus:ring-2 focus:ring-accent/40"
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground leading-tight">
          {title}
        </h4>
        <ChevronRight className="size-4 text-muted-foreground group-hover:text-accent transition-colors shrink-0" />
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex items-baseline gap-1">
          <span className="font-mono text-3xl font-bold text-foreground tabular-nums">
            {primary}
          </span>
          {primaryUnit && (
            <span className="font-mono text-base text-muted-foreground">{primaryUnit}</span>
          )}
        </div>

        {secondary && secondary.length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {secondary.map((s) => (
              <div key={s.label} className="flex items-baseline gap-1">
                <span className="font-mono text-xs font-semibold text-accent">{s.value}</span>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {s.label}
                </span>
              </div>
            ))}
          </div>
        )}

        <p className="text-[10px] text-muted-foreground leading-snug pt-1">{description}</p>
      </div>
    </button>
  );
};

export default MetricTile;
