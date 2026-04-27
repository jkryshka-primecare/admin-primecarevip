import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Clock, LogIn, LogOut, Plus, Calendar as CalendarIcon } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

const STATUS_STYLE: Record<string, string> = {
  present: "bg-success/10 text-success",
  absent: "bg-destructive/10 text-destructive",
  late: "bg-warning/10 text-warning",
  remote: "bg-accent/10 text-accent",
  holiday: "bg-muted text-muted-foreground",
  sick: "bg-warning/10 text-warning",
};

const STATUSES = ["present", "absent", "late", "remote", "holiday", "sick"] as const;

function fmtTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtHours(h: number | null) {
  if (h == null) return "—";
  return `${h.toFixed(2)}h`;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function HrAttendance() {
  const { hasAnyRole, user } = useAuth();
  const isAdmin = hasAnyRole(["super_admin", "admin", "hr"]);
  const qc = useQueryClient();

  // Filters (admin view)
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 13);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(todayStr());
  const [employeeFilter, setEmployeeFilter] = useState<string>("all");

  // Manual entry dialog (admin)
  const [entryOpen, setEntryOpen] = useState(false);
  const [entryEmp, setEntryEmp] = useState("");
  const [entryDate, setEntryDate] = useState(todayStr());
  const [entryStatus, setEntryStatus] = useState<(typeof STATUSES)[number]>("present");
  const [entryClockIn, setEntryClockIn] = useState("");
  const [entryClockOut, setEntryClockOut] = useState("");
  const [entryNotes, setEntryNotes] = useState("");

  // Current user's employee row
  const { data: me } = useQuery({
    queryKey: ["hr", "me-employee", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("hr_employees")
        .select("id, first_name, last_name")
        .eq("user_id", user!.id)
        .maybeSingle();
      return data;
    },
  });

  // Today's record for current employee
  const { data: today } = useQuery({
    queryKey: ["hr", "attendance-today", me?.id],
    enabled: !!me?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("hr_attendance_records")
        .select("*")
        .eq("employee_id", me!.id)
        .eq("date", todayStr())
        .maybeSingle();
      return data;
    },
  });

  // Personal log (last 30 days)
  const { data: myLog = [] } = useQuery({
    queryKey: ["hr", "attendance-mine", me?.id],
    enabled: !!me?.id,
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const { data } = await supabase
        .from("hr_attendance_records")
        .select("*")
        .eq("employee_id", me!.id)
        .gte("date", since.toISOString().slice(0, 10))
        .order("date", { ascending: false });
      return data ?? [];
    },
  });

  // Admin: all records in range
  const { data: allRecords = [] } = useQuery({
    queryKey: ["hr", "attendance-all", from, to, employeeFilter],
    enabled: isAdmin,
    queryFn: async () => {
      let q = supabase
        .from("hr_attendance_records")
        .select("*, hr_employees(first_name, last_name)")
        .gte("date", from)
        .lte("date", to)
        .order("date", { ascending: false })
        .limit(500);
      if (employeeFilter !== "all") q = q.eq("employee_id", employeeFilter);
      const { data } = await q;
      return data ?? [];
    },
  });

  const { data: employees = [] } = useQuery({
    queryKey: ["hr", "employees-active"],
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

  const stats = useMemo(() => {
    const total = allRecords.length;
    const present = allRecords.filter((r: { status: string }) => r.status === "present" || r.status === "remote").length;
    const late = allRecords.filter((r: { status: string }) => r.status === "late").length;
    const absent = allRecords.filter((r: { status: string }) => r.status === "absent").length;
    const hours = allRecords.reduce(
      (sum: number, r: { hours_worked: number | null }) => sum + (r.hours_worked ?? 0),
      0,
    );
    return { total, present, late, absent, hours };
  }, [allRecords]);

  // Mutations
  const clockIn = useMutation({
    mutationFn: async () => {
      if (!me?.id) throw new Error("No employee record linked.");
      const now = new Date();
      const isLate = now.getHours() > 9 || (now.getHours() === 9 && now.getMinutes() > 15);
      const { error } = await supabase.from("hr_attendance_records").insert({
        employee_id: me.id,
        date: todayStr(),
        clock_in: now.toISOString(),
        status: isLate ? "late" : "present",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hr", "attendance-today"] });
      qc.invalidateQueries({ queryKey: ["hr", "attendance-mine"] });
      qc.invalidateQueries({ queryKey: ["hr", "attendance-all"] });
      toast.success("Clocked in");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const clockOut = useMutation({
    mutationFn: async () => {
      if (!today?.id || !today.clock_in) throw new Error("Not clocked in.");
      const out = new Date();
      const inT = new Date(today.clock_in);
      const hours = Math.max(0, (out.getTime() - inT.getTime()) / 3_600_000);
      const { error } = await supabase
        .from("hr_attendance_records")
        .update({
          clock_out: out.toISOString(),
          hours_worked: Math.round(hours * 100) / 100,
        })
        .eq("id", today.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hr", "attendance-today"] });
      qc.invalidateQueries({ queryKey: ["hr", "attendance-mine"] });
      qc.invalidateQueries({ queryKey: ["hr", "attendance-all"] });
      toast.success("Clocked out");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addEntry = useMutation({
    mutationFn: async () => {
      if (!entryEmp) throw new Error("Select an employee.");
      const payload: {
        employee_id: string;
        date: string;
        status: (typeof STATUSES)[number];
        clock_in?: string;
        clock_out?: string;
        hours_worked?: number;
        notes?: string;
      } = {
        employee_id: entryEmp,
        date: entryDate,
        status: entryStatus,
      };
      if (entryClockIn) payload.clock_in = new Date(`${entryDate}T${entryClockIn}:00`).toISOString();
      if (entryClockOut) payload.clock_out = new Date(`${entryDate}T${entryClockOut}:00`).toISOString();
      if (payload.clock_in && payload.clock_out) {
        const h = (new Date(payload.clock_out).getTime() - new Date(payload.clock_in).getTime()) / 3_600_000;
        payload.hours_worked = Math.round(Math.max(0, h) * 100) / 100;
      }
      if (entryNotes.trim()) payload.notes = entryNotes.trim();
      const { error } = await supabase.from("hr_attendance_records").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hr", "attendance-all"] });
      toast.success("Attendance recorded");
      setEntryOpen(false);
      setEntryEmp("");
      setEntryClockIn("");
      setEntryClockOut("");
      setEntryNotes("");
      setEntryStatus("present");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-serif text-2xl text-foreground">Attendance</h2>
          <p className="text-sm text-muted-foreground">
            Clock in and out, and review attendance history.
          </p>
        </div>
      </div>

      {/* Personal clock card */}
      {me && (
        <Card className="p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-accent/10 p-2 text-accent">
                <Clock className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Today</div>
                <div className="font-serif text-lg text-foreground">
                  {new Date().toLocaleDateString(undefined, {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })}
                </div>
                <div className="mt-2 flex flex-wrap gap-3 text-sm text-muted-foreground">
                  <span>
                    In: <span className="font-mono text-foreground">{fmtTime(today?.clock_in ?? null)}</span>
                  </span>
                  <span>
                    Out: <span className="font-mono text-foreground">{fmtTime(today?.clock_out ?? null)}</span>
                  </span>
                  <span>
                    Hours: <span className="font-mono text-foreground">{fmtHours(today?.hours_worked ?? null)}</span>
                  </span>
                  {today?.status && (
                    <Badge
                      variant="secondary"
                      className={`capitalize text-xs ${STATUS_STYLE[today.status] ?? ""}`}
                    >
                      {today.status}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => clockIn.mutate()}
                disabled={!!today?.clock_in || clockIn.isPending}
                className="gap-2"
              >
                <LogIn className="h-4 w-4" />
                Clock In
              </Button>
              <Button
                variant="outline"
                onClick={() => clockOut.mutate()}
                disabled={!today?.clock_in || !!today?.clock_out || clockOut.isPending}
                className="gap-2"
              >
                <LogOut className="h-4 w-4" />
                Clock Out
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Personal log */}
      {me && (
        <Card>
          <div className="border-b border-border px-6 py-3">
            <h3 className="font-serif text-base text-foreground">My recent attendance</h3>
            <p className="text-xs text-muted-foreground">Last 30 days</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <Th>Date</Th>
                  <Th>Status</Th>
                  <Th>In</Th>
                  <Th>Out</Th>
                  <Th>Hours</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {myLog.map((r: {
                  id: string;
                  date: string;
                  status: string;
                  clock_in: string | null;
                  clock_out: string | null;
                  hours_worked: number | null;
                }) => (
                  <tr key={r.id} className="hover:bg-muted/50 transition-colors">
                    <Td>{new Date(r.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</Td>
                    <Td>
                      <Badge variant="secondary" className={`capitalize text-xs ${STATUS_STYLE[r.status] ?? ""}`}>
                        {r.status}
                      </Badge>
                    </Td>
                    <Td className="font-mono">{fmtTime(r.clock_in)}</Td>
                    <Td className="font-mono">{fmtTime(r.clock_out)}</Td>
                    <Td className="font-mono">{fmtHours(r.hours_worked)}</Td>
                  </tr>
                ))}
                {myLog.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-sm text-muted-foreground">
                      No attendance yet. Clock in to start tracking.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Admin view */}
      {isAdmin && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <StatTile label="Records" value={stats.total} />
            <StatTile label="Present / Remote" value={stats.present} accent="success" />
            <StatTile label="Late" value={stats.late} accent="warning" />
            <StatTile label="Absent" value={stats.absent} accent="destructive" />
            <StatTile label="Total hours" value={`${stats.hours.toFixed(1)}h`} />
          </div>

          <Card className="p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="grid gap-3 sm:grid-cols-3 sm:flex-1">
                <div className="space-y-1.5">
                  <Label htmlFor="from">From</Label>
                  <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="to">To</Label>
                  <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Employee</Label>
                  <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All employees</SelectItem>
                      {employees.map((emp: { id: string; first_name: string; last_name: string }) => (
                        <SelectItem key={emp.id} value={emp.id}>
                          {emp.first_name} {emp.last_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Dialog open={entryOpen} onOpenChange={setEntryOpen}>
                <DialogTrigger asChild>
                  <Button className="gap-2">
                    <Plus className="h-4 w-4" />
                    Add entry
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Record attendance</DialogTitle>
                  </DialogHeader>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      addEntry.mutate();
                    }}
                    className="space-y-4"
                  >
                    <div className="space-y-2">
                      <Label>Employee</Label>
                      <Select value={entryEmp} onValueChange={setEntryEmp}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select employee" />
                        </SelectTrigger>
                        <SelectContent>
                          {employees.map((emp: { id: string; first_name: string; last_name: string }) => (
                            <SelectItem key={emp.id} value={emp.id}>
                              {emp.first_name} {emp.last_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label>Date</Label>
                        <Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} required />
                      </div>
                      <div className="space-y-2">
                        <Label>Status</Label>
                        <Select value={entryStatus} onValueChange={(v) => setEntryStatus(v as (typeof STATUSES)[number])}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {STATUSES.map((s) => (
                              <SelectItem key={s} value={s} className="capitalize">
                                {s}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label>Clock in</Label>
                        <Input type="time" value={entryClockIn} onChange={(e) => setEntryClockIn(e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label>Clock out</Label>
                        <Input type="time" value={entryClockOut} onChange={(e) => setEntryClockOut(e.target.value)} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Notes</Label>
                      <Textarea value={entryNotes} onChange={(e) => setEntryNotes(e.target.value)} />
                    </div>
                    <Button type="submit" className="w-full" disabled={addEntry.isPending}>
                      Save entry
                    </Button>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          </Card>

          <Card>
            <div className="border-b border-border px-6 py-3 flex items-center gap-2">
              <CalendarIcon className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-serif text-base text-foreground">All attendance</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <Th>Date</Th>
                    <Th>Employee</Th>
                    <Th>Status</Th>
                    <Th>In</Th>
                    <Th>Out</Th>
                    <Th>Hours</Th>
                    <Th>Notes</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {allRecords.map((r: {
                    id: string;
                    date: string;
                    status: string;
                    clock_in: string | null;
                    clock_out: string | null;
                    hours_worked: number | null;
                    notes: string | null;
                    hr_employees: { first_name: string; last_name: string } | null;
                  }) => (
                    <tr key={r.id} className="hover:bg-muted/50 transition-colors">
                      <Td>
                        {new Date(r.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </Td>
                      <Td className="font-medium">
                        {r.hr_employees?.first_name} {r.hr_employees?.last_name}
                      </Td>
                      <Td>
                        <Badge variant="secondary" className={`capitalize text-xs ${STATUS_STYLE[r.status] ?? ""}`}>
                          {r.status}
                        </Badge>
                      </Td>
                      <Td className="font-mono">{fmtTime(r.clock_in)}</Td>
                      <Td className="font-mono">{fmtTime(r.clock_out)}</Td>
                      <Td className="font-mono">{fmtHours(r.hours_worked)}</Td>
                      <Td className="text-muted-foreground max-w-[16rem] truncate">{r.notes ?? "—"}</Td>
                    </tr>
                  ))}
                  {allRecords.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-6 py-8 text-center text-sm text-muted-foreground">
                        No attendance records in this range.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </th>
  );
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`whitespace-nowrap px-6 py-4 text-sm ${className}`}>{children}</td>;
}

function StatTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent?: "success" | "warning" | "destructive";
}) {
  const color =
    accent === "success"
      ? "text-success"
      : accent === "warning"
      ? "text-warning"
      : accent === "destructive"
      ? "text-destructive"
      : "text-foreground";
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 font-serif text-2xl ${color}`}>{value}</div>
    </Card>
  );
}
