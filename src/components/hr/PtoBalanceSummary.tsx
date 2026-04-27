import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Wallet } from "lucide-react";

export function PtoBalanceSummary() {
  const year = new Date().getFullYear();
  const { data = [] } = useQuery({
    queryKey: ["hr", "my-pto-balances", year],
    queryFn: async () => {
      const { data } = await supabase
        .from("hr_pto_balances")
        .select("type, accrued_days, used_days, carryover_days")
        .eq("year", year);
      return data ?? [];
    },
  });

  if (data.length === 0) return null;

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Wallet className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          My PTO Balance · {year}
        </h3>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {data.map((b: any) => {
          const remaining =
            Number(b.accrued_days) + Number(b.carryover_days) - Number(b.used_days);
          return (
            <div key={b.type} className="rounded-md border border-border p-3">
              <p className="text-xs uppercase tracking-wider text-muted-foreground capitalize">
                {String(b.type).replace("_", " ")}
              </p>
              <p className="mt-1 font-mono text-xl text-foreground">
                {remaining.toFixed(1)}
                <span className="text-xs text-muted-foreground ml-1">days</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {Number(b.used_days).toFixed(1)} used
              </p>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
