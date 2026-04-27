import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Download, FileText, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const MAX_MB = 10;

export default function HrDocuments() {
  const { user, hasAnyRole } = useAuth();
  const isAdmin = hasAnyRole(["super_admin", "admin", "hr"]);
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [employeeId, setEmployeeId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const { data: employees = [] } = useQuery({
    queryKey: ["hr", "employees-active-min"],
    queryFn: async () => {
      const { data } = await supabase
        .from("hr_employees")
        .select("id, first_name, last_name")
        .order("last_name");
      return data ?? [];
    },
  });

  const { data: documents = [] } = useQuery({
    queryKey: ["hr", "documents", employeeId],
    queryFn: async () => {
      let q = supabase
        .from("hr_documents")
        .select("*, hr_employees(first_name, last_name)")
        .order("created_at", { ascending: false });
      if (employeeId) q = q.eq("employee_id", employeeId);
      const { data } = await q;
      return data ?? [];
    },
  });

  const upload = useMutation({
    mutationFn: async () => {
      if (!file || !employeeId) throw new Error("Select an employee and a file");
      if (file.size > MAX_MB * 1024 * 1024) throw new Error(`File must be under ${MAX_MB}MB`);
      const ext = file.name.split(".").pop() ?? "bin";
      const path = `${employeeId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("hr-documents")
        .upload(path, file, { upsert: false, contentType: file.type });
      if (upErr) throw upErr;
      const { error } = await supabase.from("hr_documents").insert({
        employee_id: employeeId,
        name: name || file.name,
        description: description || null,
        file_url: path,
        file_type: file.type,
        file_size: file.size,
        uploaded_by: user!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hr", "documents"] });
      toast.success("Document uploaded");
      setFile(null);
      setName("");
      setDescription("");
      if (fileInput.current) fileInput.current.value = "";
    },
    onError: (err: any) => toast.error(err.message ?? "Failed"),
  });

  const remove = useMutation({
    mutationFn: async (doc: any) => {
      await supabase.storage.from("hr-documents").remove([doc.file_url]);
      const { error } = await supabase.from("hr_documents").delete().eq("id", doc.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hr", "documents"] });
      toast.success("Document removed");
    },
    onError: (err: any) => toast.error(err.message ?? "Failed"),
  });

  const download = async (doc: any) => {
    const { data, error } = await supabase.storage
      .from("hr-documents")
      .createSignedUrl(doc.file_url, 60);
    if (error) {
      toast.error(error.message);
      return;
    }
    window.open(data.signedUrl, "_blank");
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif text-2xl text-foreground">Documents</h2>
        <p className="text-sm text-muted-foreground">
          Upload and manage employee documents (offer letters, W-4s, handbooks).
        </p>
      </div>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Upload Document</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                upload.mutate();
              }}
              className="grid gap-3 md:grid-cols-2"
            >
              <div className="space-y-1.5">
                <Label className="text-xs">Employee</Label>
                <Select value={employeeId} onValueChange={setEmployeeId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select employee" />
                  </SelectTrigger>
                  <SelectContent>
                    {employees.map((emp: any) => (
                      <SelectItem key={emp.id} value={emp.id}>
                        {emp.first_name} {emp.last_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Document Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Offer Letter"
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label className="text-xs">Description</Label>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label className="text-xs">File</Label>
                <div
                  className="flex items-center gap-2 rounded-md border border-dashed border-input p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => fileInput.current?.click()}
                >
                  <Upload className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground truncate">
                    {file ? file.name : `Click to upload (max ${MAX_MB}MB)`}
                  </span>
                  <input
                    ref={fileInput}
                    type="file"
                    className="hidden"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                </div>
              </div>
              <div className="md:col-span-2">
                <Button
                  type="submit"
                  disabled={!employeeId || !file || upload.isPending}
                  className="gap-2"
                >
                  <Upload className="h-4 w-4" />
                  {upload.isPending ? "Uploading…" : "Upload"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All Documents</CardTitle>
        </CardHeader>
        <CardContent>
          {documents.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No documents yet.</p>
          ) : (
            <div className="space-y-2">
              {documents.map((doc: any) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between rounded-md border border-border p-3"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <FileText className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{doc.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {doc.hr_employees?.first_name} {doc.hr_employees?.last_name}
                        {doc.description ? ` · ${doc.description}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => download(doc)}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    {isAdmin && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => remove.mutate(doc)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
