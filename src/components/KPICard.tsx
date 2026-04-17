import { cn } from "@/lib/utils";

interface KPICardProps {
  label: string;
  value: string;
  subtitle?: string;
  delta?: string;
  deltaType?: "positive" | "negative" | "neutral";
  progress?: number;
  progressColor?: string;
}

const KPICard = ({ label, value, subtitle, delta, deltaType = "neutral", progress, progressColor = "bg-pulse" }: KPICardProps) => {
  return (
    <div className="bg-card rounded-2xl p-6 border border-border shadow-card hover:shadow-elevated transition-shadow">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.16em] mb-3">{label}</p>
      <div className="flex items-baseline gap-2">
        <h2 className="font-serif text-4xl font-bold tracking-tight text-foreground">{value}</h2>
        {delta && (
          <span className={cn(
            "text-xs font-medium px-2 py-0.5 rounded-full",
            deltaType === "positive" && "bg-success/10 text-success",
            deltaType === "negative" && "bg-destructive/10 text-destructive",
            deltaType === "neutral" && "bg-muted text-muted-foreground"
          )}>
            {delta}
          </span>
        )}
      </div>
      {subtitle && <p className="mt-3 text-xs text-muted-foreground">{subtitle}</p>}
      {progress !== undefined && (
        <div className="mt-4 h-1.5 w-full bg-muted rounded-full overflow-hidden">
          <div className={cn("h-full rounded-full transition-all", progressColor)} style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
};

export default KPICard;
