import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  Download,
  FileText,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { differenceInDays, format, parseISO } from "date-fns";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const MAX_MB = 5;

function statusFor(exp: string | null) {
  if (!exp) return { label: "No Expiry", className: "bg-muted text-muted-foreground", Icon: CheckCircle };
  const days = differenceInDays(parseISO(exp), new Date());
  if (days < 0)
    return { label: "Expired", className: "bg-destructive/10 text-destructive", Icon: AlertTriangle };
  if (days <= 30)
    return {
      label: `Expires in ${days}d`,
      className: "bg-destructive/10 text-destructive",
      Icon: AlertTriangle,
    };
  if (days <= 60)
    return { label: `Expires in ${days}d`, className: "bg-warning/10 text-warning", Icon: Clock };
  if (days <= 90)
    return { label: `Expires in ${days}d`, className: "bg-warning/10 text-warning", Icon: Clock };
  return { label: "Valid", className: "bg-success/10 text-success", Icon: CheckCircle };
}

export default function EmployeeCertifications({ employeeId }: { employeeId: string }) {
  const { hasAnyRole } = useAuth();
  const isAdmin = hasAnyRole(["super_admin", "admin", "hr"]);
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({
    name: "",
    issuing_authority: "",
    license_number: "",
    issue_date: "",
    expiration_date: "",
    notes: "",
  });

  const { data: certs = [] } = useQuery({
    queryKey: ["hr", "certs", employeeId],
    queryFn: async () => {
      const { data } = await supabase
        .from("hr_certifications")
        .select("*")
        .eq("employee_id", employeeId)
        .order("expiration_date", { ascending: true, nullsFirst: false });
      return data ?? [];
    },
  });

  const reset = () => {
    setForm({
      name: "",
      issuing_authority: "",
      license_number: "",
      issue_date: "",
      expiration_date: "",
      notes: "",
    });
    setFile(null);
  };

  const add = useMutation({
    mutationFn: async () => {
      let document_url: string | null = null;
      let document_name: string | null = null;
      if (file) {
        if (file.size > MAX_MB * 1024 * 1024) throw new Error(`File must be under ${MAX_MB}MB`);
        const ext = file.name.split(".").pop() ?? "bin";
        const path = `${employeeId}/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from("hr-documents").upload(path, file, {
          upsert: false,
          contentType: file.type,
        });
        if (error) throw error;
        document_url = path;
        document_name = file.name;
      }
      const { error } = await supabase.from("hr_certifications").insert({
        employee_id: employeeId,
        name: form.name,
        issuing_authority: form.issuing_authority || null,
        license_number: form.license_number || null,
        issue_date: form.issue_date || null,
        expiration_date: form.expiration_date || null,
        notes: form.notes || null,
        document_url,
        document_name,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hr", "certs", employeeId] });
      toast.success("Certification added");
      setOpen(false);
      reset();
    },
    onError: (err: any) => toast.error(err.message ?? "Failed"),
  });

  const remove = useMutation({
    mutationFn: async (certId: string) => {
      const { error } = await supabase.from("hr_certifications").delete().eq("id", certId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hr", "certs", employeeId] });
      toast.success("Certification removed");
    },
    onError: (err: any) => toast.error(err.message ?? "Failed"),
  });

  const download = async (cert: any) => {
    if (!cert.document_url) return;
    const { data, error } = await supabase.storage
      .from("hr-documents")
      .createSignedUrl(cert.document_url, 60);
    if (error) {
      toast.error(error.message);
      return;
    }
    window.open(data.signedUrl, "_blank");
  };

  return (
    <Card className="md:col-span-2">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Licenses & Certifications</CardTitle>
        {isAdmin && (
          <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="gap-1.5">
                <Plus className="h-3.5 w-3.5" /> Add
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add License / Certification</DialogTitle>
              </DialogHeader>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!form.name.trim()) return;
                  add.mutate();
                }}
                className="space-y-4"
              >
                <div className="space-y-1.5">
                  <Label className="text-xs">Name *</Label>
                  <Input
                    required
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. RN License, BLS"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Issuing Authority</Label>
                    <Input
                      value={form.issuing_authority}
                      onChange={(e) => setForm((f) => ({ ...f, issuing_authority: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">License #</Label>
                    <Input
                      value={form.license_number}
                      onChange={(e) => setForm((f) => ({ ...f, license_number: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Issue Date</Label>
                    <Input
                      type="date"
                      value={form.issue_date}
                      onChange={(e) => setForm((f) => ({ ...f, issue_date: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Expiration Date</Label>
                    <Input
                      type="date"
                      value={form.expiration_date}
                      onChange={(e) => setForm((f) => ({ ...f, expiration_date: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Document</Label>
                  <div
                    className="flex items-center gap-2 rounded-md border border-dashed border-input p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => fileInput.current?.click()}
                  >
                    <Upload className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground truncate">
                      {file ? file.name : `Click to upload (PDF or image, max ${MAX_MB}MB)`}
                    </span>
                    <input
                      ref={fileInput}
                      type="file"
                      className="hidden"
                      accept=".pdf,.jpg,.jpeg,.png,.webp"
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Notes</Label>
                  <Input
                    value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={add.isPending}>
                  {add.isPending ? "Adding…" : "Add Certification"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent>
        {certs.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No licenses or certifications on file.
          </p>
        ) : (
          <div className="space-y-3">
            {certs.map((cert: any) => {
              const s = statusFor(cert.expiration_date);
              return (
                <div
                  key={cert.id}
                  className="flex items-center justify-between rounded-lg border border-border p-3 transition-colors hover:bg-muted/30"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <FileText className="h-4 w-4" />
                    </div>
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium text-foreground">{cert.name}</p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        {cert.issuing_authority && <span>{cert.issuing_authority}</span>}
                        {cert.license_number && <span>#{cert.license_number}</span>}
                        {cert.expiration_date && (
                          <span>Exp: {format(parseISO(cert.expiration_date), "MMM d, yyyy")}</span>
                        )}
                      </div>
                      {cert.document_name && (
                        <button
                          onClick={() => download(cert)}
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-0.5"
                        >
                          <Download className="h-3 w-3" />
                          {cert.document_name}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className={`gap-1 text-xs ${s.className}`}>
                      <s.Icon className="h-3 w-3" />
                      {s.label}
                    </Badge>
                    {isAdmin && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => remove.mutate(cert.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
