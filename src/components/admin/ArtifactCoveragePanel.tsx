import { useState } from "react";
import { motion } from "framer-motion";
import { ShieldCheck, RefreshCw, Download, AlertTriangle, FileWarning, PlayCircle, Stethoscope, Check, X } from "lucide-react";
import { useArtifactCoverage, missesToCsv } from "@/hooks/useArtifactCoverage";
import { useRunArtifactAudit, useRunReadPathSmoke, type SmokeReport } from "@/hooks/usePortalAdmin";
import { useToast } from "@/hooks/use-toast";

/**
 * Release 2a — Artifact Coverage.
 *
 * Shows the nightly audit's number for the *referenced* set only: every
 * document reference marked `hasArtifact: true` resolves to a real object in
 * Storage. 100% here means "no dangling 404s" — it does not mean we hold
 * everything Elation has, which is a Release 2b question.
 *
 * Read-only except for "Run audit now", which asks the Firebase job to run
 * ahead of its 03:15 schedule. The job writes a report; it never touches
 * member data. The export re-reads the report through the staff-gated bridge
 * so the download itself lands in the PHI access log.
 */
export default function ArtifactCoveragePanel() {
  const { report, loading, fetching, error, refetch } = useArtifactCoverage();
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);
  const runAudit = useRunArtifactAudit();
  const runSmoke = useRunReadPathSmoke();
  const [smoke, setSmoke] = useState<SmokeReport | null>(null);

  const pct = report?.coveragePct;
  const healthy = pct !== null && pct !== undefined && pct >= 100;

  const triggerAudit = async () => {
    try {
      const res = await runAudit.mutateAsync({});
      toast({
        title: "Audit started",
        description: res?.runId
          ? `Run ${res.runId} queued. Refresh in a few minutes for the report.`
          : "The coverage job is running. Refresh in a few minutes for the report.",
      });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Could not start the audit",
        description: e instanceof Error ? e.message : String(e),
      });
    }
  };


  const triggerSmoke = async () => {
    setSmoke(null);
    try {
      const res = await runSmoke.mutateAsync({});
      setSmoke(res);
      toast({
        title: res.failed ? "Read-path smoke finished with failures" : "Read-path smoke passed",
        description: `${res.passed ?? 0}/${res.total ?? 0} checks passed`,
        variant: res.failed ? "destructive" : undefined,
      });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Could not run the read-path smoke",
        description: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      // Re-read before exporting: the bridge writes an audit row for this read,
      // so the download is attributable to the signed-in staff member.
      const fresh = await refetch();
      void fresh;
      const misses = report?.misses ?? [];
      if (!misses.length) {
        toast({ title: "Nothing to export", description: "No missing artifacts in the latest run." });
        return;
      }
      const blob = new Blob([missesToCsv(misses)], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `artifact-coverage-misses-${report?.runId ?? "latest"}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Export written", description: `${misses.length} rows. This download is audited.` });
    } finally {
      setExporting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-border bg-card p-6 shadow-soft"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`rounded-lg p-2.5 ${healthy ? "bg-success/10" : "bg-warning/10"}`}>
            <ShieldCheck className={`h-5 w-5 ${healthy ? "text-success" : "text-warning"}`} />
          </div>
          <div>
            <h2 className="font-serif text-lg text-card-foreground">Artifact Coverage</h2>
            <p className="text-sm text-muted-foreground">
              Referenced artifacts present in Storage — proves no dangling documents. Not a
              measure of whether we hold everything Elation has.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={triggerAudit}
            disabled={runAudit.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
          >
            <PlayCircle className={`h-3 w-3 ${runAudit.isPending ? "animate-pulse" : ""}`} />
            {runAudit.isPending ? "Starting…" : "Run audit now"}
          </button>
          <button
            onClick={triggerSmoke}
            disabled={runSmoke.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
          >
            <Stethoscope className={`h-3 w-3 ${runSmoke.isPending ? "animate-pulse" : ""}`} />
            {runSmoke.isPending ? "Running smoke…" : "Run read-path smoke"}
          </button>
          <button
            onClick={() => refetch()}
            disabled={fetching}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${fetching ? "animate-spin" : ""}`} /> Refresh
          </button>

          <button
            onClick={exportCsv}
            disabled={exporting || !report?.misses.length}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Download className="h-3 w-3" /> Export misses (audited)
          </button>
        </div>
      </div>

      {smoke && (
        <div className="mt-4 overflow-hidden rounded-xl border border-border">
          <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/60 px-3 py-2">
            <p className="text-xs font-medium text-foreground">
              Live read-path smoke — {smoke.passed ?? 0}/{smoke.total ?? 0} passed
              {smoke.fixture ? ` · fixture ${smoke.fixture.patientId}` : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              {smoke.ranAt ? new Date(smoke.ranAt).toLocaleString() : ""}
            </p>
          </div>
          <table className="w-full text-left text-xs">
            <tbody>
              {(smoke.results ?? []).map((c) => (
                <tr key={c.name} className="border-t border-border">
                  <td className="w-8 px-3 py-2">
                    {c.pass ? (
                      <Check className="h-3.5 w-3.5 text-success" />
                    ) : (
                      <X className="h-3.5 w-3.5 text-destructive" />
                    )}
                  </td>
                  <td className="px-3 py-2 text-foreground">{c.name}</td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">{c.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error && (
        <p className="mt-4 flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" /> {error}
        </p>
      )}

      {loading && <p className="mt-4 text-xs text-muted-foreground">Loading the latest audit run…</p>}

      {!loading && !report && !error && (
        <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <FileWarning className="h-3.5 w-3.5" />
          No audit run yet. The nightly <span className="font-mono">auditArtifactCoverage</span> job
          publishes the first report once deployed.
        </p>
      )}

      {report && (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-4">
            <Stat
              label="Referenced artifacts present"
              value={pct === null ? "—" : `${pct.toFixed(1)}%`}
              tone={healthy ? "good" : "warn"}
            />
            <Stat label="Referenced" value={report.totalReferenced.toLocaleString()} />
            <Stat label="Missing" value={report.missingCount.toLocaleString()} tone={report.missingCount ? "warn" : "good"} />
            <Stat label="Parked (alerting)" value={report.parkedCount.toLocaleString()} tone={report.parkedCount ? "bad" : "good"} />
          </div>

          {(report.unpathedCount > 0 || report.truncatedWalk) && (
            <div className="mt-3 space-y-1.5">
              {report.truncatedWalk && (
                <p className="flex items-center gap-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
                  <AlertTriangle className="h-3.5 w-3.5" /> Partial walk — this run hit its
                  per-run cap, so the percentage is not complete coverage.
                </p>
              )}
              {report.unpathedCount > 0 && (
                <p className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                  <FileWarning className="h-3.5 w-3.5" /> {report.unpathedCount.toLocaleString()}{" "}
                  referenced documents have no storage key yet (no artifactPath, unclaimed record).
                  They are excluded from the percentage and never queued for repair.
                </p>
              )}
            </div>
          )}

          <p className="mt-3 text-xs text-muted-foreground">
            Run <span className="font-mono">{report.runId}</span>
            {report.generatedAt ? ` · ${new Date(report.generatedAt).toLocaleString()}` : ""}
          </p>

          {report.misses.length > 0 && (
            <div className="mt-4 overflow-hidden rounded-xl border border-border">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/60 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Patient</th>
                    <th className="px-3 py-2 font-medium">Document</th>
                    <th className="px-3 py-2 font-medium">Expected path</th>
                    <th className="px-3 py-2 font-medium">Failures</th>
                  </tr>
                </thead>
                <tbody>
                  {report.misses.slice(0, 25).map((m) => (
                    <tr key={`${m.patientId}:${m.documentId}`} className="border-t border-border">
                      <td className="px-3 py-2 font-mono">{m.patientId || "—"}</td>
                      <td className="px-3 py-2 font-mono">{m.documentId || "—"}</td>
                      <td className="px-3 py-2 font-mono text-muted-foreground">{m.path || "—"}</td>
                      <td className={`px-3 py-2 ${m.parked ? "text-destructive" : ""}`}>
                        {m.failures}
                        {m.parked ? " · parked" : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {report.misses.length > 25 && (
                <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
                  Showing 25 of {report.misses.length}. Export for the full list.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const toneClass =
    tone === "good"
      ? "text-success"
      : tone === "warn"
        ? "text-warning"
        : tone === "bad"
          ? "text-destructive"
          : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-background px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 font-mono text-lg ${toneClass}`}>{value}</p>
    </div>
  );
}
