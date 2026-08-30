import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ContractorStatus = "active" | "inactive" | "terminated";
type RateType = "hourly" | "daily" | "per_project" | "retainer";

export interface ContractorFormValues {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  company_name: string;
  tax_id: string;
  w9_on_file: boolean;
  service_role: string;
  department_id: string;
  start_date: string;
  end_date: string;
  status: ContractorStatus;
  rate: string;
  rate_type: string;
  contract_number: string;
  address: string;
  notes: string;
}

const empty: ContractorFormValues = {
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  company_name: "",
  tax_id: "",
  w9_on_file: false,
  service_role: "",
  department_id: "",
  start_date: "",
  end_date: "",
  status: "active",
  rate: "",
  rate_type: "",
  contract_number: "",
  address: "",
  notes: "",
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided the dialog edits this contractor instead of creating one. */
  contractor?: (Partial<ContractorFormValues> & { id: string }) | null;
}

export default function AddContractorDialog({ open, onOpenChange, contractor }: Props) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ContractorFormValues>(empty);
  const isEdit = Boolean(contractor?.id);

  useEffect(() => {
    if (!open) return;
    setForm(contractor ? { ...empty, ...contractor } : empty);
  }, [open, contractor]);

  const { data: departments = [] } = useQuery({
    queryKey: ["hr", "departments"],
    queryFn: async () => {
      const { data } = await supabase.from("hr_departments").select("*").order("name");
      return data ?? [];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        first_name: form.first_name,
        last_name: form.last_name,
        email: form.email,
        phone: form.phone || null,
        company_name: form.company_name || null,
        tax_id: form.tax_id || null,
        w9_on_file: form.w9_on_file,
        service_role: form.service_role || null,
        department_id: form.department_id || null,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        status: form.status,
        rate: form.rate ? Number(form.rate) : null,
        rate_type: (form.rate_type || null) as RateType | null,
        contract_number: form.contract_number || null,
        address: form.address || null,
        notes: form.notes || null,
      };

      if (isEdit && contractor) {
        const { error } = await supabase
          .from("hr_contractors")
          .update(payload)
          .eq("id", contractor.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("hr_contractors").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hr", "contractors"] });
      queryClient.invalidateQueries({ queryKey: ["hr", "contractor"] });
      toast.success(isEdit ? "Contractor updated" : "Contractor added");
      setForm(empty);
      onOpenChange(false);
    },
    onError: (err: any) => toast.error(err.message ?? "Failed to save contractor"),
  });

  const set = <K extends keyof ContractorFormValues>(k: K, v: ContractorFormValues[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Contractor" : "Add Contractor"}</DialogTitle>
          <DialogDescription>
            Independent contractors (1099). Kept separate from employee payroll and PTO.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">First Name *</Label>
              <Input
                required
                value={form.first_name}
                onChange={(e) => set("first_name", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Last Name *</Label>
              <Input
                required
                value={form.last_name}
                onChange={(e) => set("last_name", e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Email *</Label>
              <Input
                required
                type="email"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Phone</Label>
              <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Company / DBA</Label>
              <Input
                value={form.company_name}
                onChange={(e) => set("company_name", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Tax ID (EIN / SSN)</Label>
              <Input
                type="password"
                placeholder="XX-XXXXXXX"
                value={form.tax_id}
                onChange={(e) => set("tax_id", e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Service / Role</Label>
              <Input
                value={form.service_role}
                onChange={(e) => set("service_role", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Department</Label>
              <Select
                value={form.department_id}
                onValueChange={(v) => set("department_id", v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((d: any) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Start Date</Label>
              <Input
                type="date"
                value={form.start_date}
                onChange={(e) => set("start_date", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">End Date</Label>
              <Input
                type="date"
                value={form.end_date}
                onChange={(e) => set("end_date", e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Rate</Label>
              <Input
                type="number"
                step="0.01"
                value={form.rate}
                onChange={(e) => set("rate", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Rate Type</Label>
              <Select value={form.rate_type} onValueChange={(v) => set("rate_type", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select rate type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hourly">Hourly</SelectItem>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="per_project">Per Project</SelectItem>
                  <SelectItem value="retainer">Retainer</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => set("status", v as ContractorStatus)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="terminated">Terminated</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Contract Number</Label>
              <Input
                value={form.contract_number}
                onChange={(e) => set("contract_number", e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <Label className="text-xs">W-9 on file</Label>
            <Switch
              checked={form.w9_on_file}
              onCheckedChange={(v) => set("w9_on_file", v)}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Address</Label>
            <Textarea
              rows={2}
              value={form.address}
              onChange={(e) => set("address", e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Notes</Label>
            <Textarea
              rows={2}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                !form.first_name || !form.last_name || !form.email || save.isPending
              }
            >
              {save.isPending ? "Saving…" : isEdit ? "Save Changes" : "Add Contractor"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
