import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, Circle, Clock, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const STAGE_LABEL: Record<string, string> = {
  pre_hire: "Pre-Hire",
  first_day: "First Day",
  first_week: "First Week",
  first_month: "First Month",
  complete: "Complete",
};

const STAGE_PROGRESS: Record<string, number> = {
  pre_hire: 15,
  first_day: 35,
  first_week: 55,
  first_month: 80,
  complete: 100,
};

export default function HrOnboarding() {
  const { data: checklists = [] } = useQuery({
    queryKey: ["hr", "onboarding-checklists"],
    queryFn: async () => {
      const { data } = await supabase
        .from("hr_onboarding_checklists")
        .select("*, hr_employees(first_name, last_name, job_title, hr_departments(name)), hr_onboarding_tasks(*)")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  return (
    <div className="space-y-8">
      <div>
        <h2 className="font-serif text-2xl text-foreground">Onboarding</h2>
        <p className="text-sm text-muted-foreground">
          Track and manage new-hire onboarding progress.
        </p>
      </div>

      {checklists.length === 0 ? (
        <div className="text-center py-12">
          <Users className="mx-auto h-12 w-12 text-muted-foreground/50" />
          <p className="mt-4 text-sm text-muted-foreground">No active onboarding checklists.</p>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {checklists.map((checklist: any) => {
            const tasks = checklist.hr_onboarding_tasks ?? [];
            const completed = tasks.filter((t: any) => t.is_completed).length;
            return (
              <Card key={checklist.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                        {checklist.hr_employees?.first_name?.[0]}
                        {checklist.hr_employees?.last_name?.[0]}
                      </div>
                      <div>
                        <CardTitle className="text-sm font-semibold">
                          {checklist.hr_employees?.first_name} {checklist.hr_employees?.last_name}
                        </CardTitle>
                        <p className="text-xs text-muted-foreground">
                          {checklist.hr_employees?.job_title} ·{" "}
                          {checklist.hr_employees?.hr_departments?.name}
                        </p>
                      </div>
                    </div>
                    <Badge variant="secondary" className="text-xs capitalize">
                      {STAGE_LABEL[checklist.stage] ?? checklist.stage}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    Start:{" "}
                    {new Date(checklist.start_date).toLocaleDateString("en-US", {
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-secondary">
                    <div
                      className="h-1.5 rounded-full bg-accent transition-all"
                      style={{ width: `${STAGE_PROGRESS[checklist.stage] ?? 0}%` }}
                    />
                  </div>
                  {tasks.length > 0 && (
                    <div className="space-y-2 pt-2">
                      {tasks
                        .sort((a: any, b: any) => a.sort_order - b.sort_order)
                        .map((t: any) => (
                          <div key={t.id} className="flex items-center gap-2">
                            {t.is_completed ? (
                              <CheckCircle2 className="h-4 w-4 text-success" />
                            ) : (
                              <Circle className="h-4 w-4 text-muted-foreground" />
                            )}
                            <span
                              className={`text-sm ${
                                t.is_completed
                                  ? "text-muted-foreground line-through"
                                  : "text-foreground"
                              }`}
                            >
                              {t.name}
                            </span>
                          </div>
                        ))}
                      <p className="text-xs text-muted-foreground pt-1">
                        {completed}/{tasks.length} tasks completed
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
