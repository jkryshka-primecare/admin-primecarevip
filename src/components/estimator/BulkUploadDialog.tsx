import { useState, useRef, useCallback } from "react";
import * as tus from "tus-js-client";
import * as XLSX from "xlsx";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Upload, FileUp, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient, useQuery } from "@tanstack/react-query";

const BUCKET = "pricing-uploads";
const MAX_UPLOAD_SIZE = 50 * 1024 * 1024; // 50 MB

export function BulkUploadDialog() {
  const [open, setOpen] = useState(false);
  const [network, setNetwork] = useState("Tendo");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [jobId, setJobId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const tusRef = useRef<tus.Upload | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: job } = useQuery({
    queryKey: ["bulk-import-job", jobId],
    enabled: !!jobId,
    refetchInterval: (q) => {
      const s = (q.state.data as any)?.status;
      return s === "pending" || s === "processing" ? 2000 : false;
    },
    queryFn: async () => {
      if (!jobId) return null;
      const { data, error } = await supabase
        .from("import_jobs")
        .select("*")
        .eq("id", jobId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const reset = () => {
    if (tusRef.current) { tusRef.current.abort(); tusRef.current = null; }
    setFile(null); setJobId(null); setProgress(0); setUploading(false);
  };

  const convertXlsxToCsv = async (f: File): Promise<File> => {
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    const baseName = f.name.replace(/\.(xlsx|xls)$/i, "");
    return new File([csv], `${baseName}.csv`, { type: "text/csv" });
  };

  const uploadToStorage = useCallback((f: File): Promise<string> => {
    return new Promise(async (resolve, reject) => {
      const objectName = `bulk/${crypto.randomUUID()}.csv`;
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) return reject(new Error("Not authenticated"));
      const projectUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const upload = new tus.Upload(f, {
        endpoint: `${projectUrl}/storage/v1/upload/resumable`,
        retryDelays: [0, 1000, 3000, 5000, 10000],
        chunkSize: 6 * 1024 * 1024,
        headers: { authorization: `Bearer ${accessToken}`, apikey: anonKey, "x-upsert": "true" },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        metadata: { bucketName: BUCKET, objectName, contentType: "text/csv" },
        onError: (err) => { tusRef.current = null; reject(new Error(err.message)); },
        onProgress: (b, t) => setProgress(Math.round((b / t) * 100)),
        onSuccess: async () => {
          tusRef.current = null;
          const { data, error } = await supabase.storage
            .from(BUCKET).createSignedUrl(objectName, 60 * 60 * 6);
          if (error || !data?.signedUrl) return reject(new Error(error?.message ?? "signed url failed"));
          resolve(data.signedUrl);
        },
      });
      tusRef.current = upload;
      upload.start();
    });
  }, []);

  const handleStart = async () => {
    if (!file) return toast({ title: "No file selected", variant: "destructive" });
    if (!network.trim()) return toast({ title: "Network name required", variant: "destructive" });
    if (file.size > MAX_UPLOAD_SIZE) {
      return toast({ title: "File too large", description: "Max 50 MB", variant: "destructive" });
    }
    setUploading(true);
    try {
      const csvFile = /\.(xlsx|xls)$/i.test(file.name) ? await convertXlsxToCsv(file) : file;
      const signedUrl = await uploadToStorage(csvFile);
      const { data: { user } } = await supabase.auth.getUser();
      const { data: newJob, error } = await supabase
        .from("import_jobs")
        .insert({
          url: signedUrl,
          status: "pending",
          kind: "bulk_csv",
          network: network.trim(),
          created_by: user?.id ?? null,
        } as any)
        .select("id")
        .single();
      if (error || !newJob) throw new Error(error?.message ?? "failed to create job");
      setJobId(newJob.id);
      supabase.functions.invoke("bulk-import-pricing", { body: { job_id: newJob.id } });
      setUploading(false);
    } catch (e: any) {
      setUploading(false);
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    }
  };

  const isDone = (job as any)?.status === "done";
  const isError = (job as any)?.status === "error";
  const isRunning = (job as any)?.status === "pending" || (job as any)?.status === "processing";
  const rowsImported = (job as any)?.rows_imported ?? 0;
  const totalRows = (job as any)?.total_rows ?? 0;
  const pct = totalRows > 0 ? Math.round((rowsImported / totalRows) * 100) : undefined;

  return (
    <Dialog open={open} onOpenChange={(o) => {
      setOpen(o);
      if (!o) {
        if (isDone) qc.invalidateQueries({ queryKey: ["estimator"] });
        reset();
      }
    }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Upload className="h-3.5 w-3.5" />
          Bulk Upload (CSV/XLSX)
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Bulk Upload Pricing</DialogTitle>
          <DialogDescription>
            Upload a CSV or XLSX containing multiple providers and prices. Each row becomes its own
            provider entry tagged with the network you specify. Required columns: Hospital, Provider,
            procedure, Address, City, State, ZIP, Total Price.
          </DialogDescription>
        </DialogHeader>

        {!jobId ? (
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Network</label>
              <Input value={network} onChange={(e) => setNetwork(e.target.value)} placeholder="Tendo" />
              <p className="text-[11px] text-muted-foreground">
                Every provider created from this file is tagged with this network.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">File</label>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex items-center justify-center w-full rounded-md border-2 border-dashed border-input bg-background px-4 py-6 text-sm text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors"
              >
                {file ? (
                  <span className="flex items-center gap-2">
                    <FileUp className="h-4 w-4 text-primary" />
                    <span className="font-medium text-foreground">{file.name}</span>
                    <span className="text-[11px]">({(file.size / 1024 / 1024).toFixed(1)} MB)</span>
                  </span>
                ) : (
                  <span className="flex flex-col items-center gap-1">
                    <FileUp className="h-5 w-5" />
                    <span>Click to select CSV or XLSX</span>
                  </span>
                )}
              </button>
            </div>

            {uploading && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Uploading… {progress}%
                </div>
                <Progress value={progress} className="h-2" />
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={handleStart} disabled={!file || uploading}>
                {uploading ? "Uploading…" : "Start Import"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 pt-2">
            {isRunning && (
              <>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {totalRows > 0
                    ? `Processing ${rowsImported.toLocaleString()} of ${totalRows.toLocaleString()} prices…`
                    : "Parsing file and mapping procedures to CPT codes…"}
                </div>
                <Progress value={pct} className="h-2" />
                <p className="text-[11px] text-muted-foreground">
                  This can take a few minutes for large files. You can close this dialog and come back.
                </p>
              </>
            )}
            {isDone && (
              <div className="flex flex-col items-center gap-2 py-4 text-center">
                <CheckCircle2 className="h-8 w-8 text-primary" />
                <p className="text-sm font-medium">Imported {rowsImported.toLocaleString()} prices</p>
                <Button onClick={() => { qc.invalidateQueries({ queryKey: ["estimator"] }); setOpen(false); reset(); }}>
                  Done
                </Button>
              </div>
            )}
            {isError && (
              <div className="flex flex-col items-center gap-2 py-4 text-center">
                <AlertCircle className="h-8 w-8 text-destructive" />
                <p className="text-sm font-medium">Import failed</p>
                <p className="text-xs text-muted-foreground">{(job as any)?.error_message}</p>
                <Button variant="outline" onClick={reset}>Try again</Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
