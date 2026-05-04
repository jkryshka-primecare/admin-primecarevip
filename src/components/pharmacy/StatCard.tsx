import { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  subtitleClassName?: string;
  icon: LucideIcon;
  variant?: "default" | "warning" | "success" | "info";
}

const variantClasses = {
  default: "bg-primary/10 text-primary",
  warning: "bg-warning/10 text-warning",
  success: "bg-success/10 text-success",
  info: "bg-info/10 text-info",
};

export function StatCard({ title, value, subtitle, subtitleClassName, icon: Icon, variant = "default" }: StatCardProps) {
  return (
    <Card className="animate-fade-in">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold tracking-tight">{value}</p>
            {subtitle && (
              <p className={subtitleClassName ?? "text-xs text-muted-foreground"}>{subtitle}</p>
            )}
          </div>
          <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${variantClasses[variant]}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
