import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, Mail, Phone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import AddEmployeeDialog from "@/components/hr/AddEmployeeDialog";

const STATUS: Record<string, string> = {
  active: "bg-success/10 text-success",
  on_leave: "bg-warning/10 text-warning",
  suspended: "bg-warning/10 text-warning",
  terminated: "bg-destructive/10 text-destructive",
};

export default function HrEmployees() {
  const navigate = useNavigate();
  const { hasAnyRole } = useAuth();
  const isAdmin = hasAnyRole(["super_admin", "admin", "hr"]);
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("All");
  const [addOpen, setAddOpen] = useState(false);

  const { data: departments = [] } = useQuery({
    queryKey: ["hr", "departments"],
    queryFn: async () => {
      const { data } = await supabase.from("hr_departments").select("*").order("name");
      return data ?? [];
    },
  });

  const { data: employees = [] } = useQuery({
    queryKey: ["hr", "employees"],
    queryFn: async () => {
      const { data } = await supabase
        .from("hr_employees")
        .select("*, hr_departments(name)")
        .order("last_name");
      return data ?? [];
    },
  });

  const deptNames = ["All", ...departments.map((d: any) => d.name)];

  const filtered = employees.filter((emp: any) => {
    const name = `${emp.first_name} ${emp.last_name}`.toLowerCase();
    const matchesSearch =
      name.includes(search.toLowerCase()) ||
      String(emp.email).toLowerCase().includes(search.toLowerCase());
    const matchesDept = department === "All" || emp.hr_departments?.name === department;
    return matchesSearch && matchesDept;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-serif text-2xl text-foreground">Employees</h2>
          <p className="text-sm text-muted-foreground">{employees.length} total</p>
        </div>
        {isAdmin && (
          <Button onClick={() => setAddOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Add Employee
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {deptNames.map((dept) => (
            <button
              key={dept}
              onClick={() => setDepartment(dept)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                department === dept
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
              }`}
            >
              {dept}
            </button>
          ))}
        </div>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Employee
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Department
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Role
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Contact
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((emp: any) => {
                const initials = `${emp.first_name?.[0] ?? ""}${emp.last_name?.[0] ?? ""}`.toUpperCase();
                return (
                  <tr
                    key={emp.id}
                    className="cursor-pointer transition-colors hover:bg-muted/50"
                    onClick={() => navigate(`/hr/employees/${emp.id}`)}
                  >
                    <td className="whitespace-nowrap px-6 py-4">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9">
                          <AvatarImage src={emp.avatar_url ?? undefined} alt="" />
                          <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
                            {initials}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {emp.first_name} {emp.last_name}
                          </p>
                          {emp.hire_date && (
                            <p className="text-xs text-muted-foreground">
                              Since{" "}
                              {new Date(emp.hire_date).toLocaleDateString("en-US", {
                                month: "short",
                                year: "numeric",
                              })}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-foreground">
                      {emp.hr_departments?.name ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-muted-foreground">
                      {emp.job_title ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <Badge
                        variant="secondary"
                        className={`text-xs capitalize ${STATUS[emp.employment_status] ?? ""}`}
                      >
                        {String(emp.employment_status).replace("_", " ")}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <div className="flex gap-2 text-muted-foreground">
                        <Mail className="h-4 w-4" />
                        {emp.phone && <Phone className="h-4 w-4" />}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-sm text-muted-foreground">
                    No employees found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {isAdmin && <AddEmployeeDialog open={addOpen} onOpenChange={setAddOpen} />}
    </div>
  );
}
