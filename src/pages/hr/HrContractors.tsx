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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import AddContractorDialog from "@/components/hr/AddContractorDialog";

const STATUS: Record<string, string> = {
  active: "bg-success/10 text-success",
  inactive: "bg-warning/10 text-warning",
  terminated: "bg-destructive/10 text-destructive",
};

const STATUS_FILTERS = ["All", "active", "inactive", "terminated"];

export default function HrContractors() {
  const navigate = useNavigate();
  const { hasAnyRole } = useAuth();
  const isAdmin = hasAnyRole(["super_admin", "admin", "hr"]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("All");
  const [addOpen, setAddOpen] = useState(false);

  const { data: contractors = [] } = useQuery({
    queryKey: ["hr", "contractors"],
    queryFn: async () => {
      const { data } = await supabase
        .from("hr_contractors")
        .select("*, hr_departments(name)")
        .order("last_name");
      return data ?? [];
    },
  });

  const filtered = contractors.filter((c: any) => {
    const haystack = `${c.first_name} ${c.last_name} ${c.email} ${c.company_name ?? ""}`.toLowerCase();
    const matchesSearch = haystack.includes(search.toLowerCase());
    const matchesStatus = status === "All" || c.status === status;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-serif text-2xl text-foreground">Contractors</h2>
          <p className="text-sm text-muted-foreground">{contractors.length} total</p>
        </div>
        {isAdmin && (
          <Button onClick={() => setAddOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Add Contractor
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, or company…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                status === s
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {["Contractor", "Company", "Service", "Status", "Contact"].map((h) => (
                  <th
                    key={h}
                    className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((c: any) => {
                const initials = `${c.first_name?.[0] ?? ""}${c.last_name?.[0] ?? ""}`.toUpperCase();
                return (
                  <tr
                    key={c.id}
                    className="cursor-pointer transition-colors hover:bg-muted/50"
                    onClick={() => navigate(`/hr/contractors/${c.id}`)}
                  >
                    <td className="whitespace-nowrap px-6 py-4">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9">
                          <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
                            {initials}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {c.first_name} {c.last_name}
                          </p>
                          {c.start_date && (
                            <p className="text-xs text-muted-foreground">
                              Since{" "}
                              {new Date(c.start_date).toLocaleDateString("en-US", {
                                month: "short",
                                year: "numeric",
                              })}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-foreground">
                      {c.company_name ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-muted-foreground">
                      {c.service_role ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <Badge
                        variant="secondary"
                        className={`text-xs capitalize ${STATUS[c.status] ?? ""}`}
                      >
                        {String(c.status)}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <div className="flex gap-2 text-muted-foreground">
                        <Mail className="h-4 w-4" />
                        {c.phone && <Phone className="h-4 w-4" />}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-6 py-8 text-center text-sm text-muted-foreground"
                  >
                    No contractors found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {isAdmin && <AddContractorDialog open={addOpen} onOpenChange={setAddOpen} />}
    </div>
  );
}
