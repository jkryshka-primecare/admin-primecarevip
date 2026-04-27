import { useQuery } from "@tanstack/react-query";
import { differenceInDays, format, parseISO } from "date-fns";
import { useNavigate } from "react-router-dom";
import { Users, Clock, AlertTriangle, UserPlus, Calendar, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import HrStatCard from "@/components/hr/HrStatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const STAGE_PROGRESS: Record<string, number> = {
  pre_hire: 15,
  first_day: 35,
  first_week: 55,
  first_month: 80,
  complete: 100,
};

export default function HrDashboard() {
  const { hasAnyRole } = useAuth();
  const navigate = useNavigate();
  const isAdmin = hasAnyRole(["super_admin", "admin", "hr"]);

  const { data: employeeCount = 0 } = useQuery({
    queryKey: ["hr", "employee-count"],
    enabled: isAdmin,
    queryFn: async () => {
      const { count } = await supabase
        .from("hr_employees")
        .select("*", { count: "exact", head: true });
      return count ?? 0;
    },
  });

  const { data: pendingRequests = [] } = useQuery({
    queryKey: ["hr", "pending-requests"],
    queryFn: async () => {
      const { data } = await supabase
        .from("hr_time_off_requests")
        .select("*, hr_employees(first_name, last_name)")
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(5);
      return data ?? [];
    },
  });

  const { data: openGrievances = 0 } = useQuery({
    queryKey: ["hr", "open-grievances"],
    enabled: isAdmin,
    queryFn: async () => {
      const { count } = await supabase
        .from("hr_grievances")
        .select("*", { count: "exact", head: true })
        .in("status", ["new", "under_review", "in_progress"]);
      return count ?? 0;
    },
  });

  const { data: onboardingList = [] } = useQuery({
    queryKey: ["hr", "onboarding-active"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data } = await supabase
        .from("hr_onboarding_checklists")
        .select("*, hr_employees(first_name, last_name, job_title)")
        .neq("stage", "complete")
        .order("created_at", { ascending: false })
        .limit(5);
      return data ?? [];
    },
  });

  const { data: expiringCerts = [] } = useQuery({
    queryKey: ["hr", "expiring-certs"],
    enabled: isAdmin,
    queryFn: async () => {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + 90);
      const { data } = await supabase
        .from("hr_certifications")
        .select("*, hr_employees(id, first_name, last_name)")
        .not("expiration_date", "is", null)
        .lte("expiration_date", cutoff.toISOString().split("T")[0])
        .order("expiration_date", { ascending: true })
        .limit(10);
      return data ?? [];
    },
  });

  return (
    <div className="space-y-8">
      <div>
        <h2 className="font-serif text-2xl text-foreground">HR Dashboard</h2>
        <p className="text-sm text-muted-foreground">
          {isAdmin
            ? "Live snapshot of headcount, requests, and compliance."
            : "Welcome to your employee portal."}
        </p>
      </div>

      {isAdmin && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <HrStatCard title="Total Employees" value={employeeCount} icon={Users} />
          <HrStatCard title="Pending Requests" value={pendingRequests.length} icon={Clock} />
          <HrStatCard title="Open Grievances" value={openGrievances} icon={AlertTriangle} />
          <HrStatCard title="In Onboarding" value={onboardingList.length} icon={UserPlus} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">
              {isAdmin ? "Pending Time-Off Requests" : "Your Time-Off Requests"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {pendingRequests.length === 0 ? (
              <p className="text-sm text-muted-foreground">No pending requests.</p>
            ) : (
              <div className="space-y-3">
                {pendingRequests.map((req: any) => (
                  <div key={req.id} className="flex items-start gap-3 rounded-md border border-border p-3">
                    <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground">
                        {req.hr_employees?.first_name} {req.hr_employees?.last_name} —{" "}
                        {String(req.type).replace("_", " ")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(req.start_date).toLocaleDateString()} –{" "}
                        {new Date(req.end_date).toLocaleDateString()} ({req.days} days)
                      </p>
                    </div>
                    <Badge variant="secondary" className="bg-warning/10 text-warning text-xs">
                      Pending
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {isAdmin && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <ShieldAlert className="h-4 w-4 text-warning" />
                Expiring Licenses
              </CardTitle>
            </CardHeader>
            <CardContent>
              {expiringCerts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No certifications expiring in the next 90 days.
                </p>
              ) : (
                <div className="space-y-3">
                  {expiringCerts.map((cert: any) => {
                    const days = differenceInDays(parseISO(cert.expiration_date), new Date());
                    const expired = days < 0;
                    const urgent = days <= 30;
                    return (
                      <div
                        key={cert.id}
                        onClick={() => navigate(`/hr/employees/${cert.hr_employees?.id}`)}
                        className="flex items-center justify-between rounded-md border border-border p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground">{cert.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {cert.hr_employees?.first_name} {cert.hr_employees?.last_name} · Exp:{" "}
                            {format(parseISO(cert.expiration_date), "MMM d, yyyy")}
                          </p>
                        </div>
                        <Badge
                          variant="secondary"
                          className={`text-xs ${
                            expired || urgent
                              ? "bg-destructive/10 text-destructive"
                              : "bg-warning/10 text-warning"
                          }`}
                        >
                          {expired ? "Expired" : `${days}d left`}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {isAdmin && (
          <Card className="lg:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Onboarding Pipeline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {onboardingList.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active onboarding.</p>
              ) : (
                onboardingList.map((item: any) => (
                  <div key={item.id} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {item.hr_employees?.first_name} {item.hr_employees?.last_name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {item.hr_employees?.job_title}
                        </p>
                      </div>
                      <Badge variant="secondary" className="text-xs capitalize">
                        {String(item.stage).replace("_", " ")}
                      </Badge>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-secondary">
                      <div
                        className="h-1.5 rounded-full bg-accent transition-all"
                        style={{ width: `${STAGE_PROGRESS[item.stage] ?? 0}%` }}
                      />
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
