import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { CheckCircle2, Clock, XCircle, Plus, Calendar } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CalendarSyncSettings } from "@/components/hr/CalendarSyncSettings";
import { PtoBalanceSummary } from "@/components/hr/PtoBalanceSummary";

const STATUS_ICON: Record<string, typeof CheckCircle2> = {
  pending: Clock,
  approved: CheckCircle2,
  denied: XCircle,
  cancelled: XCircle,
};

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-warning/10 text-warning",
  approved: "bg-success/10 text-success",
  denied: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

export default function HrTimeOff() {
  const { hasAnyRole, user } = useAuth();
  const isAdmin = hasAnyRole(["super_admin", "admin", "hr"]);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [type, setType] = useState("vacation");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");

  const days =
    start && end
      ? Math.max(
          1,
          Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1,
        )
      : 1;

  const { data: requests = [] } = useQuery({
    queryKey: ["hr", "time-off-requests"],
    queryFn: async () => {
      const { data } = await supabase
        .from("hr_time_off_requests")
        .select("*, hr_employees(first_name, last_name)")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const { data: employees = [] } = useQuery({
    queryKey: ["hr", "employees-list-active"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data } = await supabase
        .from("hr_employees")
        .select("id, first_name, last_name, user_id")
        .eq("employment_status", "active")
        .order("last_name");
      return data ?? [];
    },
  });

  const submit = useMutation({
    mutationFn: async () => {
      let empId = employeeId;
      if (!isAdmin) {
        // Find current user's employee row
        const { data: me } = await supabase
          .from("hr_employees")
          .select("id")
          .eq("user_id", user!.id)
          .maybeSingle();
        if (!me) throw new Error("No employee record linked to your account.");
        empId = me.id;
      }
      if (!empId) throw new Error("Select an employee");
      const { error } = await supabase.from("hr_time_off_requests").insert({
        employee_id: empId,
        type: type as any,
        start_date: start,
        end_date: end,
        days,
        reason: reason || null,
        status: "pending",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hr", "time-off-requests"] });
      toast.success("Request submitted");
      setOpen(false);
      setEmployeeId("");
      setType("vacation");
      setStart("");
      setEnd("");
      setReason("");
    },
    onError: (err: any) => toast.error(err.message ?? "Failed"),
  });

  const review = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "approved" | "denied" }) => {
      const { error } = await supabase
        .from("hr_time_off_requests")
        .update({ status, reviewed_by: user!.id, reviewed_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;

      // Sync to Google Calendar (best-effort): create on approve, delete on deny.
      try {
        await supabase.functions.invoke("sync-timeoff-calendar", {
          body: { request_id: id, action: status === "approved" ? "upsert" : "delete" },
        });
      } catch (e) {
        console.warn("Calendar sync failed (non-blocking):", e);
      }
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["hr", "time-off-requests"] });
      toast.success(vars.status === "approved" ? "Request approved" : "Request denied");
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-serif text-2xl text-foreground">Time Off</h2>
          <p className="text-sm text-muted-foreground">
            Request and review employee time-off.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              New Request
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Request Time Off</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit.mutate();
              }}
              className="space-y-4"
            >
              {isAdmin && (
                <div className="space-y-2">
                  <Label>Employee</Label>
                  <Select value={employeeId} onValueChange={setEmployeeId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select employee" />
                    </SelectTrigger>
                    <SelectContent>
                      {employees.map((emp: any) => (
                        <SelectItem key={emp.id} value={emp.id}>
                          {emp.first_name} {emp.last_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="vacation">Vacation</SelectItem>
                    <SelectItem value="sick">Sick</SelectItem>
                    <SelectItem value="personal">Personal</SelectItem>
                    <SelectItem value="bereavement">Bereavement</SelectItem>
                    <SelectItem value="jury_duty">Jury Duty</SelectItem>
                    <SelectItem value="unpaid">Unpaid</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Start</Label>
                  <Input
                    type="date"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>End</Label>
                  <Input
                    type="date"
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Days</Label>
                <Input value={days} readOnly className="bg-muted" />
              </div>
              <div className="space-y-2">
                <Label>Reason</Label>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
              <Button type="submit" className="w-full" disabled={submit.isPending}>
                Submit Request
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <PtoBalanceSummary />

      {isAdmin && <CalendarSyncSettings />}

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
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Dates
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Days
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Status
                </th>
                {isAdmin && (
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {requests.map((req: any) => {
                const Icon = STATUS_ICON[req.status] ?? Clock;
                return (
                  <tr key={req.id} className="transition-colors hover:bg-muted/50">
                    <td className="whitespace-nowrap px-6 py-4 text-sm font-medium">
                      {req.hr_employees?.first_name} {req.hr_employees?.last_name}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-muted-foreground capitalize">
                      {String(req.type).replace("_", " ")}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-muted-foreground">
                      {new Date(req.start_date).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}{" "}
                      –{" "}
                      {new Date(req.end_date).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm">{req.days}</td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <Badge
                        variant="secondary"
                        className={`gap-1 text-xs capitalize ${STATUS_STYLE[req.status] ?? ""}`}
                      >
                        <Icon className="h-3 w-3" />
                        {req.status}
                      </Badge>
                    </td>
                    {isAdmin && (
                      <td className="whitespace-nowrap px-6 py-4">
                        {req.status === "pending" && (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs text-success border-success/30 hover:bg-success/10"
                              onClick={() =>
                                review.mutate({ id: req.id, status: "approved" })
                              }
                            >
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
                              onClick={() => review.mutate({ id: req.id, status: "denied" })}
                            >
                              Deny
                            </Button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
              {requests.length === 0 && (
                <tr>
                  <td
                    colSpan={isAdmin ? 6 : 5}
                    className="px-6 py-8 text-center text-sm text-muted-foreground"
                  >
                    No time-off requests yet.
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
