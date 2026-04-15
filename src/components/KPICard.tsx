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

const KPICard = ({ label, value, subtitle, delta, deltaType = "neutral", progress, progressColor = "bg-cyan-clinical" }: KPICardProps) => {
  return (
    <div className="glass-panel p-6 rounded-lg">
      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">{label}</p>
      <div className="flex items-baseline gap-2">
        <h2 className="text-3xl font-mono tracking-tighter text-foreground">{value}</h2>
        {delta && (
          <span className={cn(
            "text-xs font-medium",
            deltaType === "positive" && "text-cyan-clinical",
            deltaType === "negative" && "text-hcc-alert",
            deltaType === "neutral" && "text-muted-foreground"
          )}>
            {delta}
          </span>
        )}
      </div>
      {subtitle && <p className="mt-3 text-[11px] text-muted-foreground font-medium">{subtitle}</p>}
      {progress !== undefined && (
        <div className="mt-4 h-1.5 w-full bg-muted rounded-full overflow-hidden">
          <div className={cn("h-full rounded-full", progressColor)} style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
};

export default KPICard;
