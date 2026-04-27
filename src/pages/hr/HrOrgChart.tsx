import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Employee {
  id: string;
  first_name: string;
  last_name: string;
  job_title: string | null;
  manager_id: string | null;
  hr_departments: { name: string } | null;
}

function OrgNode({
  employee,
  reports,
  allReports,
  onNavigate,
}: {
  employee: Employee;
  reports: Employee[];
  allReports: Record<string, Employee[]>;
  onNavigate: (id: string) => void;
}) {
  const initials = `${employee.first_name?.[0] ?? ""}${employee.last_name?.[0] ?? ""}`.toUpperCase();
  return (
    <div className="flex flex-col items-center">
      <Card
        className="w-52 cursor-pointer p-3 text-center transition-shadow hover:shadow-md"
        onClick={() => onNavigate(employee.id)}
      >
        <div className="flex flex-col items-center gap-1.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
            {initials}
          </div>
          <p className="text-sm font-semibold text-foreground">
            {employee.first_name} {employee.last_name}
          </p>
          {employee.job_title && (
            <p className="text-xs text-muted-foreground">{employee.job_title}</p>
          )}
          {employee.hr_departments?.name && (
            <Badge variant="secondary" className="text-[10px]">
              {employee.hr_departments.name}
            </Badge>
          )}
        </div>
      </Card>
      {reports.length > 0 && (
        <>
          <div className="h-6 w-px bg-border" />
          <div className="flex gap-6">
            {reports.map((r) => (
              <div key={r.id} className="flex flex-col items-center">
                <div className="h-6 w-px bg-border" />
                <OrgNode
                  employee={r}
                  reports={allReports[r.id] ?? []}
                  allReports={allReports}
                  onNavigate={onNavigate}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function HrOrgChart() {
  const navigate = useNavigate();

  const { data: employees = [] } = useQuery({
    queryKey: ["hr", "org-chart"],
    queryFn: async () => {
      const { data } = await supabase
        .from("hr_employees")
        .select("id, first_name, last_name, job_title, manager_id, hr_departments(name)")
        .eq("employment_status", "active")
        .order("last_name");
      return (data ?? []) as Employee[];
    },
  });

  const byManager: Record<string, Employee[]> = {};
  const roots: Employee[] = [];
  employees.forEach((emp) => {
    if (!emp.manager_id) roots.push(emp);
    else (byManager[emp.manager_id] = byManager[emp.manager_id] ?? []).push(emp);
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif text-2xl text-foreground">Organization Chart</h2>
        <p className="text-sm text-muted-foreground">Reporting structure across the company.</p>
      </div>
      {employees.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No employees found. Add employees and assign managers to build the chart.
        </p>
      ) : (
        <div className="overflow-x-auto pb-8">
          <div className="flex justify-center gap-8 pt-4">
            {roots.map((root) => (
              <OrgNode
                key={root.id}
                employee={root}
                reports={byManager[root.id] ?? []}
                allReports={byManager}
                onNavigate={(id) => navigate(`/hr/employees/${id}`)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
