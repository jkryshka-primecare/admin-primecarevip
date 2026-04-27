import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { ArrowLeft, Camera, Save, UserPlus, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import EmployeeCertifications from "@/components/hr/EmployeeCertifications";
import InviteToPortalDialog from "@/components/hr/InviteToPortalDialog";
import { Badge } from "@/components/ui/badge";

const empty = {
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  job_title: "",
  department_id: "",
  hire_date: "",
  salary: "",
  employment_status: "active",
  address: "",
  date_of_birth: "",
  ssn: "",
  emergency_contact_name: "",
  emergency_contact_phone: "",
  manager_id: "",
};

export default function HrEmployeeDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasAnyRole } = useAuth();
  const isAdmin = hasAnyRole(["super_admin", "admin", "hr"]);
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [form, setForm] = useState(empty);

  const { data: employee, isLoading } = useQuery({
    queryKey: ["hr", "employee", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hr_employees")
        .select("*, hr_departments(id, name)")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: departments = [] } = useQuery({
    queryKey: ["hr", "departments"],
    queryFn: async () => {
      const { data } = await supabase.from("hr_departments").select("*").order("name");
      return data ?? [];
    },
  });

  const { data: managers = [] } = useQuery({
    queryKey: ["hr", "manager-options"],
    queryFn: async () => {
      const { data } = await supabase
        .from("hr_employees")
        .select("id, first_name, last_name")
        .eq("employment_status", "active")
        .order("last_name");
      return data ?? [];
    },
  });

  useEffect(() => {
    if (employee) {
      setForm({
        first_name: employee.first_name ?? "",
        last_name: employee.last_name ?? "",
        email: employee.email ?? "",
        phone: employee.phone ?? "",
        job_title: employee.job_title ?? "",
        department_id: employee.department_id ?? "",
        hire_date: employee.hire_date ?? "",
        salary: employee.salary?.toString() ?? "",
        employment_status: employee.employment_status ?? "active",
        address: employee.address ?? "",
        date_of_birth: employee.date_of_birth ?? "",
        ssn: employee.ssn ?? "",
        emergency_contact_name: employee.emergency_contact_name ?? "",
        emergency_contact_phone: employee.emergency_contact_phone ?? "",
        manager_id: employee.manager_id ?? "",
      });
    }
  }, [employee]);

  const update = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("hr_employees")
        .update({
          first_name: form.first_name,
          last_name: form.last_name,
          email: form.email,
          phone: form.phone || null,
          job_title: form.job_title || null,
          department_id: form.department_id || null,
          hire_date: form.hire_date || null,
          salary: form.salary ? Number(form.salary) : null,
          employment_status: form.employment_status as any,
          address: form.address || null,
          date_of_birth: form.date_of_birth || null,
          ssn: form.ssn || null,
          emergency_contact_name: form.emergency_contact_name || null,
          emergency_contact_phone: form.emergency_contact_phone || null,
          manager_id: form.manager_id || null,
        })
        .eq("id", id!);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hr", "employee", id] });
      queryClient.invalidateQueries({ queryKey: ["hr", "employees"] });
      toast.success("Employee updated");
    },
    onError: (err: any) => toast.error(err.message ?? "Failed"),
  });

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const onAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !id) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() ?? "png";
      const path = `${id}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("hr-avatars")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data: signed } = await supabase.storage
        .from("hr-avatars")
        .createSignedUrl(path, 60 * 60 * 24 * 365);
      const url = signed?.signedUrl ?? null;
      const { error: updErr } = await supabase
        .from("hr_employees")
        .update({ avatar_url: url })
        .eq("id", id);
      if (updErr) throw updErr;
      queryClient.invalidateQueries({ queryKey: ["hr", "employee", id] });
      queryClient.invalidateQueries({ queryKey: ["hr", "employees"] });
      toast.success("Profile picture updated");
    } catch (err: any) {
      toast.error(err.message ?? "Upload failed");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  if (isLoading) {
    return <div className="py-20 text-center text-sm text-muted-foreground">Loading…</div>;
  }
  if (!employee) {
    return <div className="py-20 text-center text-sm text-muted-foreground">Employee not found.</div>;
  }

  const initials = `${employee.first_name?.[0] ?? ""}${employee.last_name?.[0] ?? ""}`.toUpperCase();
  const managerOptions = managers.filter((m: any) => m.id !== id);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/hr/employees")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex items-center gap-3">
          <input
            type="file"
            ref={fileInput}
            accept="image/*"
            className="hidden"
            onChange={onAvatar}
          />
          <div
            className={`relative group ${isAdmin ? "cursor-pointer" : ""}`}
            onClick={() => isAdmin && fileInput.current?.click()}
          >
            <Avatar className="h-12 w-12">
              <AvatarImage src={employee.avatar_url ?? undefined} alt="" />
              <AvatarFallback className="bg-primary text-sm font-bold text-primary-foreground">
                {initials}
              </AvatarFallback>
            </Avatar>
            {isAdmin && (
              <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
                <Camera className="h-4 w-4 text-white" />
              </div>
            )}
            {uploading && (
              <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50">
                <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </div>
          <div>
            <h2 className="font-serif text-xl text-foreground">
              {employee.first_name} {employee.last_name}
            </h2>
            <p className="text-sm text-muted-foreground">
              {employee.job_title ?? "No title"} · {employee.email}
            </p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {employee.user_id ? (
            <Badge variant="secondary" className="gap-1 bg-success/10 text-success">
              <CheckCircle2 className="h-3 w-3" /> Portal linked
            </Badge>
          ) : (
            isAdmin && (
              <Button variant="outline" className="gap-2" onClick={() => setInviteOpen(true)}>
                <UserPlus className="h-4 w-4" /> Invite to Portal
              </Button>
            )
          )}
          {isAdmin && (
            <Button
              className="gap-2"
              onClick={() => update.mutate()}
              disabled={update.isPending}
            >
              <Save className="h-4 w-4" />
              Save Changes
            </Button>
          )}
        </div>
      </div>

      {isAdmin && employee && (
        <InviteToPortalDialog
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          employee={{
            id: employee.id,
            first_name: employee.first_name,
            last_name: employee.last_name,
            email: employee.email,
            user_id: employee.user_id,
          }}
        />
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          update.mutate();
        }}
        className="grid gap-6 md:grid-cols-2"
      >
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Personal Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">First Name</Label>
                <Input
                  value={form.first_name}
                  onChange={(e) => set("first_name", e.target.value)}
                  disabled={!isAdmin}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Last Name</Label>
                <Input
                  value={form.last_name}
                  onChange={(e) => set("last_name", e.target.value)}
                  disabled={!isAdmin}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                disabled={!isAdmin}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Phone</Label>
              <Input
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                disabled={!isAdmin}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Address</Label>
              <Input
                value={form.address}
                onChange={(e) => set("address", e.target.value)}
                disabled={!isAdmin}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Date of Birth</Label>
              <Input
                type="date"
                value={form.date_of_birth}
                onChange={(e) => set("date_of_birth", e.target.value)}
                disabled={!isAdmin}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">SSN</Label>
              <Input
                value={form.ssn}
                onChange={(e) => set("ssn", e.target.value)}
                disabled={!isAdmin}
                placeholder="XXX-XX-XXXX"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Employment Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Job Title</Label>
              <Input
                value={form.job_title}
                onChange={(e) => set("job_title", e.target.value)}
                disabled={!isAdmin}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Department</Label>
              <Select
                value={form.department_id}
                onValueChange={(v) => set("department_id", v)}
                disabled={!isAdmin}
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
            <div className="space-y-1.5">
              <Label className="text-xs">Manager / Supervisor</Label>
              <Select
                value={form.manager_id || "none"}
                onValueChange={(v) => set("manager_id", v === "none" ? "" : v)}
                disabled={!isAdmin}
              >
                <SelectTrigger>
                  <SelectValue placeholder="No manager assigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No manager</SelectItem>
                  {managerOptions.map((m: any) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.first_name} {m.last_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Hire Date</Label>
              <Input
                type="date"
                value={form.hire_date}
                onChange={(e) => set("hire_date", e.target.value)}
                disabled={!isAdmin}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Salary (annual)</Label>
              <Input
                type="number"
                value={form.salary}
                onChange={(e) => set("salary", e.target.value)}
                disabled={!isAdmin}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <Select
                value={form.employment_status}
                onValueChange={(v) => set("employment_status", v)}
                disabled={!isAdmin}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="on_leave">On Leave</SelectItem>
                  <SelectItem value="suspended">Suspended</SelectItem>
                  <SelectItem value="terminated">Terminated</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <EmployeeCertifications employeeId={id!} />

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Emergency Contact</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Contact Name</Label>
              <Input
                value={form.emergency_contact_name}
                onChange={(e) => set("emergency_contact_name", e.target.value)}
                disabled={!isAdmin}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Contact Phone</Label>
              <Input
                value={form.emergency_contact_phone}
                onChange={(e) => set("emergency_contact_phone", e.target.value)}
                disabled={!isAdmin}
              />
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
