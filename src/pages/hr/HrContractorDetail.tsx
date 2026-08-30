import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
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

const RATE_LABEL: Record<string, string> = {
  hourly: "hourly",
  daily: "daily",
  per_project: "per project",
  retainer: "retainer",
};

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm text-foreground">{value || "—"}</p>
    </div>
  );
}

export default function HrContractorDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasAnyRole } = useAuth();
  const isAdmin = hasAnyRole(["super_admin", "admin", "hr"]);
  const [editOpen, setEditOpen] = useState(false);

  const { data: contractor, isLoading } = useQuery({
    queryKey: ["hr", "contractor", id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hr_contractors")
        .select("*, hr_departments(name)")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("hr_contractors").delete().eq("id", id!);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hr", "contractors"] });
      toast.success("Contractor removed");
      navigate("/hr/contractors");
    },
    onError: (err: any) => toast.error(err.message ?? "Failed to remove contractor"),
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  if (!contractor) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Contractor not found.</p>
        <Button variant="outline" onClick={() => navigate("/hr/contractors")}>
          Back to contractors
        </Button>
      </div>
    );
  }

  const c: any = contractor;
  const initials = `${c.first_name?.[0] ?? ""}${c.last_name?.[0] ?? ""}`.toUpperCase();
  const rate =
    c.rate != null
      ? `$${Number(c.rate).toLocaleString()}${c.rate_type ? ` ${RATE_LABEL[c.rate_type] ?? ""}` : ""}`
      : null;

  return (
    <div className="space-y-6">
      <Button
        variant="ghost"
        className="gap-2 px-0 text-muted-foreground"
        onClick={() => navigate("/hr/contractors")}
      >
        <ArrowLeft className="h-4 w-4" /> Contractors
      </Button>

      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <Avatar className="h-14 w-14">
              <AvatarFallback className="bg-primary text-sm font-semibold text-primary-foreground">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="space-y-1">
              <h2 className="font-serif text-2xl text-foreground">
                {c.first_name} {c.last_name}
              </h2>
              <p className="text-sm text-muted-foreground">
                {c.service_role ?? "Contractor"}
                {c.company_name ? ` · ${c.company_name}` : ""}
              </p>
              <Badge
                variant="secondary"
                className={`text-xs capitalize ${STATUS[c.status] ?? ""}`}
              >
                {String(c.status)}
              </Badge>
            </div>
          </div>
          {isAdmin && (
            <div className="flex gap-2">
              <Button variant="outline" className="gap-2" onClick={() => setEditOpen(true)}>
                <Pencil className="h-4 w-4" /> Edit
              </Button>
              <Button
                variant="destructive"
                className="gap-2"
                disabled={remove.isPending}
                onClick={() => {
                  if (confirm("Remove this contractor record?")) remove.mutate();
                }}
              >
                <Trash2 className="h-4 w-4" /> Remove
              </Button>
            </div>
          )}
        </div>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="space-y-4 p-6">
          <h3 className="font-serif text-lg text-foreground">Contact</h3>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Email" value={c.email} />
            <Field label="Phone" value={c.phone} />
            <div className="col-span-2">
              <Field label="Address" value={c.address} />
            </div>
          </div>
        </Card>

        <Card className="space-y-4 p-6">
          <h3 className="font-serif text-lg text-foreground">Engagement</h3>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Department" value={c.hr_departments?.name} />
            <Field label="Contract #" value={c.contract_number} />
            <Field
              label="Start Date"
              value={c.start_date ? new Date(c.start_date).toLocaleDateString() : null}
            />
            <Field
              label="End Date"
              value={c.end_date ? new Date(c.end_date).toLocaleDateString() : null}
            />
            <Field label="Rate" value={rate} />
            <Field label="W-9 on file" value={c.w9_on_file ? "Yes" : "No"} />
            <div className="col-span-2">
              <Field label="Tax ID" value={c.tax_id ? "•••• on file" : null} />
            </div>
          </div>
        </Card>

        <Card className="space-y-4 p-6 md:col-span-2">
          <h3 className="font-serif text-lg text-foreground">Notes</h3>
          <p className="whitespace-pre-wrap text-sm text-foreground">{c.notes || "—"}</p>
        </Card>
      </div>

      {isAdmin && (
        <AddContractorDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          contractor={{
            id: c.id,
            first_name: c.first_name ?? "",
            last_name: c.last_name ?? "",
            email: c.email ?? "",
            phone: c.phone ?? "",
            company_name: c.company_name ?? "",
            tax_id: c.tax_id ?? "",
            w9_on_file: Boolean(c.w9_on_file),
            service_role: c.service_role ?? "",
            department_id: c.department_id ?? "",
            start_date: c.start_date ?? "",
            end_date: c.end_date ?? "",
            status: c.status,
            rate: c.rate != null ? String(c.rate) : "",
            rate_type: c.rate_type ?? "",
            contract_number: c.contract_number ?? "",
            address: c.address ?? "",
            notes: c.notes ?? "",
          }}
        />
      )}
    </div>
  );
}
