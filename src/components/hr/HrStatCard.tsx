import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface Props {
  title: string;
  value: string | number;
  icon: LucideIcon;
  hint?: string;
}

export default function HrStatCard({ title, value, icon: Icon, hint }: Props) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
              {title}
            </p>
            <p className="font-serif text-3xl text-foreground">{value}</p>
            {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-secondary text-primary">
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
