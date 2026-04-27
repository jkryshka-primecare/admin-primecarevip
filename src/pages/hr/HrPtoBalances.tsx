import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PTO_TYPES = [
  "vacation",
  "sick",
  "personal",
  "bereavement",
  "jury_duty",
  "unpaid",
  "other",
] as const;

type PtoType = (typeof PTO_TYPES)[number];

interface BalanceRow {
  id: string;
  employee_id: string;
  type: PtoType;
  year: number;
  accrual_rate_per_year: number;
  accrued_days: number;
  used_days: number;
  carryover_days: number;
  notes: string | null;
  hr_employees?: { first_name: string; last_name: string };
}

const remaining = (b: BalanceRow) =>
  Number(b.accrued_days) + Number(b.carryover_days) - Number(b.used_days);

export default function HrPtoBalances() {
  const { hasAnyRole } = useAuth();
  const isAdmin = hasAnyRole(["super_admin", "admin", "hr"]);
  const queryClient = useQueryClient();
  const [year, setYear] = useState(new Date().getFullYear());
  const [employeeFilter, setEmployeeFilter] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<BalanceRow | null>(null);

  const [form, setForm] = useState({
    employee_id: "",
    type: "vacation" as PtoType,
    year: new Date().getFullYear(),
    accrual_rate_per_year: 0,
    accrued_days: 0,
    carryover_days: 0,
    notes: "",
  });

  const { data: balances = [], isLoading } = useQuery({
    queryKey: ["hr", "pto-balances", year, employeeFilter],
    queryFn: async () => {
      let q = supabase
        .from("hr_pto_balances")
        .select("*, hr_employees(first_name, last_name)")
        .eq("year", year)
        .order("type");
      if (employeeFilter !== "all") q = q.eq("employee_id", employeeFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as BalanceRow[];
    },
  });

  const { data: employees = [] } = useQuery({
    queryKey: ["hr", "employees-list-active"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data } = await supabase
        .from("hr_employees")
        .select("id, first_name, last_name")
        .eq("employment_status", "active")
        .order("last_name");
      return data ?? [];
    },
  });

  const openNew = () => {
    setEditing(null);
    setForm({
      employee_id: "",
      type: "vacation",
      year,
      accrual_rate_per_year: 0,
      accrued_days: 0,
      carryover_days: 0,
      notes: "",
    });
    setOpen(true);
  };

  const openEdit = (b: BalanceRow) => {
    setEditing(b);
    setForm({
      employee_id: b.employee_id,
      type: b.type,
      year: b.year,
      accrual_rate_per_year: Number(b.accrual_rate_per_year),
      accrued_days: Number(b.accrued_days),
      carryover_days: Number(b.carryover_days),
      notes: b.notes ?? "",
    });
    setOpen(true);
  };

  const upsert = useMutation({
    mutationFn: async () => {
      if (!form.employee_id) throw new Error("Select an employee");
      if (editing) {
        const { error } = await supabase
          .from("hr_pto_balances")
          .update({
            accrual_rate_per_year: form.accrual_rate_per_year,
            accrued_days: form.accrued_days,
            carryover_days: form.carryover_days,
            notes: form.notes || null,
          })
          .eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("hr_pto_balances").insert({
          employee_id: form.employee_id,
          type: form.type,
          year: form.year,
          accrual_rate_per_year: form.accrual_rate_per_year,
          accrued_days: form.accrued_days,
          carryover_days: form.carryover_days,
          notes: form.notes || null,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hr", "pto-balances"] });
      toast.success(editing ? "Balance updated" : "Balance created");
      setOpen(false);
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("hr_pto_balances").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hr", "pto-balances"] });
      toast.success("Removed");
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const summary = useMemo(() => {
    const byType: Record<string, { available: number; used: number }> = {};
    balances.forEach((b) => {
      const t = b.type;
      byType[t] ||= { available: 0, used: 0 };
      byType[t].available += remaining(b);
      byType[t].used += Number(b.used_days);
    });
    return byType;
  }, [balances]);

  const years = useMemo(() => {
    const cur = new Date().getFullYear();
    return [cur - 1, cur, cur + 1];
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-serif text-2xl text-foreground">PTO Balances</h2>
          <p className="text-sm text-muted-foreground">
            Track accrual, carryover, and usage by employee and type.
          </p>
        </div>
        {isAdmin && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button onClick={openNew} className="gap-2">
                <Plus className="h-4 w-4" /> New Balance
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {editing ? "Edit Balance" : "New PTO Balance"}
                </DialogTitle>
              </DialogHeader>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  upsert.mutate();
                }}
                className="space-y-4"
              >
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2 col-span-2">
                    <Label>Employee</Label>
                    <Select
                      value={form.employee_id}
                      onValueChange={(v) => setForm({ ...form, employee_id: v })}
                      disabled={!!editing}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select employee" />
                      </SelectTrigger>
                      <SelectContent>
                        {employees.map((e: any) => (
                          <SelectItem key={e.id} value={e.id}>
                            {e.first_name} {e.last_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Type</Label>
                    <Select
                      value={form.type}
                      onValueChange={(v) => setForm({ ...form, type: v as PtoType })}
                      disabled={!!editing}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PTO_TYPES.map((t) => (
                          <SelectItem key={t} value={t} className="capitalize">
                            {t.replace("_", " ")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Year</Label>
                    <Input
                      type="number"
                      value={form.year}
                      onChange={(e) =>
                        setForm({ ...form, year: parseInt(e.target.value) || year })
                      }
                      disabled={!!editing}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Accrual rate (days/yr)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={form.accrual_rate_per_year}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          accrual_rate_per_year: parseFloat(e.target.value) || 0,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Accrued days</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={form.accrued_days}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          accrued_days: parseFloat(e.target.value) || 0,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Carryover days</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={form.carryover_days}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          carryover_days: parseFloat(e.target.value) || 0,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2 col-span-2">
                    <Label>Notes</Label>
                    <Input
                      value={form.notes}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    />
                  </div>
                </div>
                <Button type="submit" className="w-full" disabled={upsert.isPending}>
                  {editing ? "Save Changes" : "Create Balance"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <Select value={String(year)} onValueChange={(v) => setYear(parseInt(v))}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isAdmin && (
          <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All employees</SelectItem>
              {employees.map((e: any) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.first_name} {e.last_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {Object.keys(summary).length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Object.entries(summary).map(([t, v]) => (
            <Card key={t} className="p-4">
              <p className="text-xs uppercase tracking-wider text-muted-foreground capitalize">
                {t.replace("_", " ")}
              </p>
              <p className="mt-2 font-mono text-2xl text-foreground">
                {v.available.toFixed(1)}
              </p>
              <p className="text-xs text-muted-foreground">
                {v.used.toFixed(1)} used
              </p>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Employee
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Type
                </th>
                <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Accrual/yr
                </th>
                <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Accrued
                </th>
                <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Carryover
                </th>
                <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Used
                </th>
                <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Remaining
                </th>
                {isAdmin && <th className="px-6 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {balances.map((b) => {
                const rem = remaining(b);
                return (
                  <tr key={b.id} className="hover:bg-muted/50 transition-colors">
                    <td className="px-6 py-4 text-sm font-medium whitespace-nowrap">
                      {b.hr_employees?.first_name} {b.hr_employees?.last_name}
                    </td>
                    <td className="px-6 py-4 text-sm text-muted-foreground capitalize whitespace-nowrap">
                      {b.type.replace("_", " ")}
                    </td>
                    <td className="px-6 py-4 text-sm font-mono text-right">
                      {Number(b.accrual_rate_per_year).toFixed(1)}
                    </td>
                    <td className="px-6 py-4 text-sm font-mono text-right">
                      {Number(b.accrued_days).toFixed(1)}
                    </td>
                    <td className="px-6 py-4 text-sm font-mono text-right">
                      {Number(b.carryover_days).toFixed(1)}
                    </td>
                    <td className="px-6 py-4 text-sm font-mono text-right">
                      {Number(b.used_days).toFixed(1)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Badge
                        variant="secondary"
                        className={
                          rem < 0
                            ? "bg-destructive/10 text-destructive font-mono"
                            : rem < 2
                              ? "bg-warning/10 text-warning font-mono"
                              : "bg-success/10 text-success font-mono"
                        }
                      >
                        {rem.toFixed(1)}
                      </Badge>
                    </td>
                    {isAdmin && (
                      <td className="px-6 py-4 text-right whitespace-nowrap">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => openEdit(b)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => {
                              if (confirm("Remove this balance row?"))
                                remove.mutate(b.id);
                            }}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
              {!isLoading && balances.length === 0 && (
                <tr>
                  <td
                    colSpan={isAdmin ? 8 : 7}
                    className="px-6 py-8 text-center text-sm text-muted-foreground"
                  >
                    No balances for {year}. {isAdmin && "Create one to start tracking."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
