import { useQuery } from "@tanstack/react-query";
import { Download, DollarSign } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const fmt = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function HrPayroll() {
  const { hasAnyRole } = useAuth();
  const isAdmin = hasAnyRole(["super_admin", "admin", "hr"]);

  const { data: records = [] } = useQuery({
    queryKey: ["hr", "payroll-records", isAdmin],
    queryFn: async () => {
      const { data } = await supabase
        .from("hr_payroll_records")
        .select("*, hr_employees(first_name, last_name)")
        .order("period_end", { ascending: false });
      return data ?? [];
    },
  });

  const periods = isAdmin
    ? Array.from(new Set(records.map((r: any) => `${r.period_start}|${r.period_end}`)))
        .slice(0, 12)
        .map((key) => {
          const [start, end] = (key as string).split("|");
          const subset = records.filter(
            (r: any) => r.period_start === start && r.period_end === end,
          );
          return {
            key,
            period: `${new Date(start).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })} – ${new Date(end).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}`,
            status: subset[0]?.status,
            grossPay: subset.reduce((s: number, r: any) => s + Number(r.gross_pay), 0),
            netPay: subset.reduce((s: number, r: any) => s + Number(r.net_pay), 0),
            employees: subset.length,
          };
        })
    : [];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-serif text-2xl text-foreground">Payroll</h2>
          <p className="text-sm text-muted-foreground">
            {isAdmin
              ? "Payroll processing and compensation overview."
              : "Your pay stubs and compensation history."}
          </p>
        </div>
        {isAdmin && (
          <Button variant="outline" className="gap-2">
            <Download className="h-4 w-4" />
            Export
          </Button>
        )}
      </div>

      {isAdmin && periods.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">Payroll History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Period
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Status
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Gross
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Net
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Employees
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {periods.map((row) => (
                    <tr key={row.key as string} className="hover:bg-muted/50 transition-colors">
                      <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-foreground">
                        {row.period}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <Badge
                          variant="secondary"
                          className={`text-xs capitalize ${
                            row.status === "paid" || row.status === "processed"
                              ? "bg-success/10 text-success"
                              : "bg-warning/10 text-warning"
                          }`}
                        >
                          {row.status}
                        </Badge>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-sm">
                        {fmt(row.grossPay)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-medium">
                        {fmt(row.netPay)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-muted-foreground">
                        {row.employees}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {!isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">Your Pay Stubs</CardTitle>
          </CardHeader>
          <CardContent>
            {records.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No pay stubs available yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Period
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Gross
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Taxes
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Deductions
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Net
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {records.map((r: any) => (
                      <tr key={r.id} className="hover:bg-muted/50 transition-colors">
                        <td className="whitespace-nowrap px-4 py-3 text-sm">
                          {new Date(r.period_start).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })}{" "}
                          –{" "}
                          {new Date(r.period_end).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-sm">
                          {fmt(Number(r.gross_pay))}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-muted-foreground">
                          {fmt(Number(r.taxes))}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-muted-foreground">
                          {fmt(Number(r.deductions))}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-medium">
                          {fmt(Number(r.net_pay))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {isAdmin && periods.length === 0 && (
        <div className="text-center py-12">
          <DollarSign className="mx-auto h-12 w-12 text-muted-foreground/50" />
          <p className="mt-4 text-sm text-muted-foreground">
            No payroll records yet. Run your first payroll to get started.
          </p>
        </div>
      )}
    </div>
  );
}
