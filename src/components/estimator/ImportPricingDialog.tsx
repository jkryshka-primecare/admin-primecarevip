import { useState, useRef, useCallback } from "react";
import * as tus from "tus-js-client";
import * as XLSX from "xlsx";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Upload, CheckCircle2, AlertCircle, Loader2, Link, FileUp, PencilLine } from "lucide-react";
import { useProviders } from "@/hooks/useEstimatorDb";
import { useCreateImportJob, useImportJob } from "@/hooks/useImportJob";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { ManualPricingForm } from "@/components/estimator/ManualPricingDialog";

interface ImportPricingDialogProps {
  activeSpecialty: string;
}

type InputMode = "url" | "upload" | "manual";
const MAX_UPLOAD_SIZE = 50 * 1024 * 1024; // 50 MB
const BUCKET_NAME = "pricing-uploads";

export function ImportPricingDialog({ activeSpecialty }: ImportPricingDialogProps) {
  const [open, setOpen] = useState(false);
  const [inputMode, setInputMode] = useState<InputMode>("url");
  const [url, setUrl] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [hospitalName, setHospitalName] = useState("");
  const [hospitalAddress, setHospitalAddress] = useState("");
  const [hospitalCity, setHospitalCity] = useState("");
  const [hospitalState, setHospitalState] = useState("FL");
  const [hospitalZip, setHospitalZip] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [showDuplicateWarning, setShowDuplicateWarning] = useState(false);
  const [previousJob, setPreviousJob] = useState<any>(null);
  const [checking, setChecking] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tusUploadRef = useRef<tus.Upload | null>(null);

  const { data: providers = [] } = useProviders(activeSpecialty);
  const createJob = useCreateImportJob();
  const { data: job } = useImportJob(activeJobId);
  const { toast } = useToast();

  const proceedWithImport = async (importUrl: string) => {
    try {
      const newJob = await createJob.mutateAsync({
        url: importUrl,
        providerId: selectedProviderId || null,
        hospitalName: hospitalName.trim() || null,
        hospitalAddress: hospitalAddress.trim() || null,
        hospitalCity: hospitalCity.trim() || null,
        hospitalState: hospitalState.trim() || null,
        hospitalZip: hospitalZip.trim() || null,
      });
      setActiveJobId(newJob.id);
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    }
  };

  const uploadFile = useCallback((file: File): Promise<string> => {
    return new Promise(async (resolve, reject) => {
      const ext = file.name.split(".").pop() || "json";
      const objectName = `${crypto.randomUUID()}.${ext}`;

      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) {
        reject(new Error("Not authenticated"));
        return;
      }

      const projectUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const upload = new tus.Upload(file, {
        endpoint: `${projectUrl}/storage/v1/upload/resumable`,
        retryDelays: [0, 1000, 3000, 5000, 10000],
        chunkSize: 6 * 1024 * 1024,
        headers: {
          authorization: `Bearer ${accessToken}`,
          apikey: anonKey,
          "x-upsert": "true",
        },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        metadata: {
          bucketName: BUCKET_NAME,
          objectName,
          contentType: file.type || "application/octet-stream",
        },
        onError: (error) => {
          tusUploadRef.current = null;
          reject(new Error(`Upload failed: ${error.message}`));
        },
        onProgress: (bytesUploaded, bytesTotal) => {
          setUploadProgress(Math.round((bytesUploaded / bytesTotal) * 100));
        },
        onSuccess: async () => {
          tusUploadRef.current = null;
          // Bucket is private — generate a signed URL the import edge function can fetch.
          const { data, error } = await supabase.storage
            .from(BUCKET_NAME)
            .createSignedUrl(objectName, 60 * 60 * 6); // 6h
          if (error || !data?.signedUrl) {
            reject(new Error(error?.message ?? "Failed to create signed URL"));
            return;
          }
          resolve(data.signedUrl);
        },
      });

      tusUploadRef.current = upload;
      const previousUploads = await upload.findPreviousUploads();
      if (previousUploads.length > 0) {
        upload.resumeFromPreviousUpload(previousUploads[0]);
      }
      upload.start();
    });
  }, []);

  const convertXlsxToCsv = async (file: File): Promise<File> => {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    const baseName = file.name.replace(/\.(xlsx|xls)$/i, "");
    return new File([csv], `${baseName}.csv`, { type: "text/csv" });
  };

  const handleStart = async () => {
    if (inputMode === "upload") {
      if (!selectedFile) {
        toast({
          title: "No file selected",
          description: "Please select a pricing file to upload.",
          variant: "destructive",
        });
        return;
      }
      if (selectedFile.size > MAX_UPLOAD_SIZE) {
        toast({
          title: "File too large for direct upload",
          description: `Files over 50 MB must be imported via URL. Upload to Google Drive or Dropbox and paste the public download link.`,
          variant: "destructive",
        });
        return;
      }
      setUploading(true);
      try {
        let fileToUpload = selectedFile;
        if (/\.(xlsx|xls)$/i.test(selectedFile.name)) {
          toast({ title: "Converting Excel to CSV", description: "Processing locally before upload…" });
          fileToUpload = await convertXlsxToCsv(selectedFile);
        }
        const signedUrl = await uploadFile(fileToUpload);
        setUploading(false);
        await proceedWithImport(signedUrl);
      } catch (err: any) {
        setUploading(false);
        toast({ title: "Upload failed", description: err.message, variant: "destructive" });
      }
      return;
    }

    const trimmed = url.trim();
    if (!trimmed) {
      toast({ title: "Missing URL", description: "Please enter a pricing file URL.", variant: "destructive" });
      return;
    }
    try {
      new URL(trimmed);
    } catch {
      toast({ title: "Invalid URL", description: "Please enter a valid URL starting with https://", variant: "destructive" });
      return;
    }
    if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
      toast({ title: "Invalid URL", description: "URL must start with http:// or https://", variant: "destructive" });
      return;
    }

    setChecking(true);
    try {
      const { data: existing } = await supabase
        .from("import_jobs")
        .select("*")
        .eq("url", trimmed)
        .eq("status", "done")
        .order("created_at", { ascending: false })
        .limit(1);

      if (existing && existing.length > 0) {
        setPreviousJob(existing[0]);
        setShowDuplicateWarning(true);
        setChecking(false);
        return;
      }
    } catch {
      /* proceed anyway */
    }
    setChecking(false);
    await proceedWithImport(trimmed);
  };

  const handleConfirmDuplicate = async () => {
    setShowDuplicateWarning(false);
    setPreviousJob(null);
    await proceedWithImport(url.trim());
  };

  const handleReset = () => {
    if (tusUploadRef.current) {
      tusUploadRef.current.abort();
      tusUploadRef.current = null;
    }
    setUrl("");
    setSelectedFile(null);
    setSelectedProviderId("");
    setActiveJobId(null);
    setShowDuplicateWarning(false);
    setPreviousJob(null);
    setInputMode("url");
    setHospitalName("");
    setHospitalAddress("");
    setHospitalCity("");
    setHospitalState("FL");
    setHospitalZip("");
    setUploadProgress(0);
  };

  const totalBytes = (job as any)?.total_bytes;
  const byteOffset = (job as any)?.byte_offset ?? 0;
  const progress = totalBytes && totalBytes > 0
    ? Math.min(Math.round((byteOffset / totalBytes) * 100), 100)
    : job?.status === "processing"
    ? undefined
    : 0;

  const isRunning = job?.status === "pending" || job?.status === "processing";
  const isDone = job?.status === "done";
  const isError = job?.status === "error";
  const isBusy = createJob.isPending || checking || uploading;

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) handleReset(); }}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5">
            <Upload className="h-3.5 w-3.5" />
            Import Pricing
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Import Hospital Pricing</DialogTitle>
            <DialogDescription>
              Provide a public pricing file URL or upload a file directly. Supports JSON, CSV, and other CMS formats.
            </DialogDescription>
          </DialogHeader>

          {!activeJobId ? (
            <div className="space-y-4 pt-2">
              <div className="flex rounded-md border border-input overflow-hidden">
                <button
                  type="button"
                  onClick={() => setInputMode("url")}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
                    inputMode === "url"
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Link className="h-3.5 w-3.5" />
                  Paste URL
                </button>
                <button
                  type="button"
                  onClick={() => setInputMode("upload")}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
                    inputMode === "upload"
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <FileUp className="h-3.5 w-3.5" />
                  Upload File
                </button>
                <button
                  type="button"
                  onClick={() => setInputMode("manual")}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
                    inputMode === "manual"
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <PencilLine className="h-3.5 w-3.5" />
                  Manual Entry
                </button>
              </div>

              {inputMode === "manual" && (
                <ManualPricingForm embedded onDone={() => setOpen(false)} />
              )}

              {inputMode === "url" && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Pricing File URL</label>
                  <Input
                    placeholder="https://hospital.com/pricing.json"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    CMS machine-readable file (JSON). Supports files &gt;256 MB.
                  </p>
                </div>
              )}

              {inputMode === "upload" && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Pricing File</label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json,.csv,.txt,.xlsx,.xls"
                    className="hidden"
                    onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center justify-center w-full rounded-md border-2 border-dashed border-input bg-background px-4 py-6 text-sm text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors"
                  >
                    {selectedFile ? (
                      <span className="flex items-center gap-2">
                        <FileUp className="h-4 w-4 text-primary" />
                        <span className="font-medium text-foreground">{selectedFile.name}</span>
                        <span className="text-[11px]">
                          ({(selectedFile.size / 1024 / 1024).toFixed(1)} MB)
                        </span>
                      </span>
                    ) : (
                      <span className="flex flex-col items-center gap-1">
                        <FileUp className="h-5 w-5" />
                        <span>Click to select a file</span>
                      </span>
                    )}
                  </button>
                  <p className="text-[11px] text-muted-foreground">
                    JSON, CSV, TXT, or Excel. Max 50 MB. Excel files are converted to CSV in your browser before upload.
                  </p>
                </div>
              )}

              {inputMode !== "manual" && !selectedProviderId && (
                <div className="space-y-2 rounded-md border border-input p-3">
                  <label className="text-xs font-medium text-foreground">Hospital Info</label>
                  <Input
                    placeholder="Hospital name (e.g. Memorial Hospital Miramar)"
                    value={hospitalName}
                    onChange={(e) => setHospitalName(e.target.value)}
                  />
                  <Input
                    placeholder="Address"
                    value={hospitalAddress}
                    onChange={(e) => setHospitalAddress(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <Input
                      placeholder="City"
                      value={hospitalCity}
                      onChange={(e) => setHospitalCity(e.target.value)}
                      className="flex-1"
                    />
                    <Input
                      placeholder="State"
                      value={hospitalState}
                      onChange={(e) => setHospitalState(e.target.value)}
                      className="w-16"
                    />
                    <Input
                      placeholder="ZIP"
                      value={hospitalZip}
                      onChange={(e) => setHospitalZip(e.target.value)}
                      className="w-24"
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Leave blank to auto-detect from file (JSON only). Required for CSV/Excel uploads.
                  </p>
                </div>
              )}

              {inputMode !== "manual" && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">
                      Existing Provider <span className="text-muted-foreground font-normal">(optional)</span>
                    </label>
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={selectedProviderId}
                      onChange={(e) => setSelectedProviderId(e.target.value)}
                    >
                      <option value="">New provider (use hospital info above)</option>
                      {providers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} — {p.city}, {p.state}
                        </option>
                      ))}
                    </select>
                  </div>

                  {uploading && (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Uploading… {uploadProgress}%
                      </div>
                      <Progress value={uploadProgress} className="h-2" />
                    </div>
                  )}

                  <Button onClick={handleStart} disabled={isBusy} className="w-full">
                    {uploading ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Uploading… {uploadProgress}%</>
                    ) : checking ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Checking…</>
                    ) : createJob.isPending ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Starting…</>
                    ) : (
                      "Start Import"
                    )}
                  </Button>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-4 pt-2">
              {isRunning && (
                <>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {job?.status === "pending"
                      ? "Starting import…"
                      : progress != null && progress > 0
                        ? `${progress}% — ${(job?.rows_imported ?? 0).toLocaleString()} rows imported`
                        : `Importing… ${(job?.rows_imported ?? 0).toLocaleString()} rows`}
                  </div>
                  <Progress value={progress ?? 0} className="h-2" />
                  {totalBytes ? (
                    <p className="text-[11px] text-muted-foreground text-right font-mono">
                      {(byteOffset / 1024 / 1024).toFixed(1)} MB / {(totalBytes / 1024 / 1024).toFixed(1)} MB
                    </p>
                  ) : null}
                </>
              )}

              {isDone && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm text-success">
                    <CheckCircle2 className="h-4 w-4" />
                    Import complete — {job?.rows_imported} rows imported.
                  </div>
                  {job?.hospital_name && (
                    <p className="text-xs text-muted-foreground ml-6">
                      Hospital: {job.hospital_name}
                    </p>
                  )}
                </div>
              )}

              {isError && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4" />
                    Import failed
                  </div>
                  <p className="text-xs text-muted-foreground">{job?.error_message}</p>
                </div>
              )}

              {(isDone || isError) && (
                <Button variant="outline" onClick={handleReset} className="w-full">
                  Import Another
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDuplicateWarning} onOpenChange={setShowDuplicateWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>URL Previously Imported</AlertDialogTitle>
            <AlertDialogDescription>
              This URL was previously imported on{" "}
              <span className="font-medium text-foreground">
                {previousJob ? new Date(previousJob.created_at).toLocaleDateString() : ""}
              </span>
              {previousJob?.rows_imported != null && (
                <> ({previousJob.rows_imported.toLocaleString()} rows)</>
              )}
              {previousJob?.hospital_name && (
                <> for <span className="font-medium text-foreground">{previousJob.hospital_name}</span></>
              )}
              . Are you sure you want to import again? This will update existing prices.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDuplicate}>
              Yes, Import Again
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
