import { useState } from "react";
import {
  AlertTriangle,
  Loader2,
  PauseCircle,
  Play,
  RotateCcw,
  ShieldAlert,
  Users,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  useBackfillRunner,
  useBackfillRunStatus,
  useResetBackfillRun,
  type BackfillAction,
  type BackfillReport,
} from "@/hooks/usePortalAdmin";

/**
 * Release 2b Part B — the migration runners that used to be curl in Cloud Shell.
 *
 * Guardrails, all enforced server-side and mirrored here for clarity:
 *  1. Dry run is the default. `Apply` is hidden for anyone below super-admin.
 *  2. The minor-track list is shape-validated here, re-validated in the edge
 *     function, and authoritatively validated against `dependent.isMinor`
 *     inside the Cloud Function wrapper.
 *  3. Every apply writes an attribution row before the upstream call.
 *  4. Nothing on this screen changes a feature flag.
 */

type RunnerDef = {
  action: BackfillAction;
  title: string;
  blurb: string;
  paged: boolean;
  needsIds?: boolean;
};

const RUNNERS: RunnerDef[] = [
  {
    action: "backfillUids",
    title: "Internal UIDs",
    blurb:
      "Mints the stable internal uid on every patient record. Idempotent — re-run until nothing remains.",
    paged: false,
  },
  {
    action: "backfillArtifacts",
    title: "Artifact objects (re-key)",
    blurb:
      "Copies legacy-path objects to the uid-keyed path. Copy-never-move: the legacy object is left in place.",
    paged: true,
  },
  {
    action: "backfillMinorReports",
    title: "Report ingest (minors / adults)",
    blurb:
      "Ingests Elation reports into the store. Pick the cohort — every id is re-validated upstream against the minor rule or the soft-adult rule. Dry run returns the report-type census.",
    paged: false,
    needsIds: true,
  },
];

function numberOr(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function ReportView({ report }: { report: BackfillReport }) {
  const rows: { label: string; value: string }[] = [];
  const push = (label: string, v: unknown) => {
    const n = numberOr(v);
    if (n !== null) rows.push({ label, value: n.toLocaleString() });
  };
  push("Scanned", report.scanned);
  push("Already present", report.alreadyPresent);
  push("Minted", report.minted);
  push("Would mint", report.wouldMint);
  push("Copied", report.copied);
  push("Would copy", report.wouldCopy);
  push("Eligible", report.eligible);
  push("Would ingest", report.wouldIngest);
  push("Already stored", report.alreadyStored);
  push("Skipped (unsigned)", report.skippedUnsigned);
  push("Skipped (deleted)", report.skippedDeleted);
  push("Skipped (not allowlisted)", report.skippedNotAllowlisted);
  push("Skipped (records deferred)", report.skippedRecordsDeferred);
  push("Ingested", report.ingested);
  push("Skipped", report.skipped);
  push("No legacy object", report.noLegacyObject);
  push("Remaining", report.remaining);
  const failed = Array.isArray(report.failed) ? report.failed.length : 0;
  const rejected = Array.isArray(report.rejected) ? report.rejected : [];

  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap gap-2">
        {rows.map((r) => (
          <span
            key={r.label}
            className="rounded-md border border-border bg-muted/50 px-2 py-1 font-mono text-[11px] text-foreground"
          >
            {r.label}: {r.value}
          </span>
        ))}
        <span
          className={`rounded-md px-2 py-1 font-mono text-[11px] ${
            failed > 0
              ? "bg-destructive/10 text-destructive"
              : "border border-border bg-muted/50 text-muted-foreground"
          }`}
        >
          Failed: {failed}
        </span>
        {report.done !== undefined && (
          <span className="rounded-md border border-border bg-muted/50 px-2 py-1 font-mono text-[11px] text-muted-foreground">
            {report.done ? "done" : "more pages remain"}
          </span>
        )}
      </div>

      {Array.isArray(report.reportTypeCensus) && report.reportTypeCensus.length > 0 && (
        <div className="rounded-md border border-border bg-muted/30 p-3">
          <p className="text-xs font-medium text-foreground">
            Report-type census ({report.reportTypeCensus.length} distinct types)
          </p>
          <table className="mt-2 w-full font-mono text-[11px]">
            <thead className="text-muted-foreground">
              <tr className="text-left">
                <th className="py-0.5 pr-3 font-normal">report_type</th>
                <th className="py-0.5 pr-3 font-normal">count</th>
                <th className="py-0.5 font-normal">mapped category</th>
              </tr>
            </thead>
            <tbody className="text-foreground">
              {report.reportTypeCensus.slice(0, 60).map((row) => (
                <tr key={row.reportType} className="border-t border-border/60">
                  <td className="py-0.5 pr-3">{row.reportType}</td>
                  <td className="py-0.5 pr-3">{row.count.toLocaleString()}</td>
                  <td className="py-0.5">
                    {row.unmappedType ? (
                      <span className="text-warning">unmapped</span>
                    ) : (
                      (row.category ?? "—")
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rejected.length > 0 && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
          <p className="font-medium text-foreground">
            {rejected.length} id(s) refused upstream — not in the requested cohort:
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {Object.entries(
              rejected.reduce<Record<string, string[]>>((acc, r) => {
                const key = r.reason || "UNKNOWN";
                (acc[key] ||= []).push(r.patientId);
                return acc;
              }, {}),
            )
              .sort((a, b) => b[1].length - a[1].length)
              .map(([reasonKey, ids]) => (
                <button
                  key={reasonKey}
                  type="button"
                  onClick={() => navigator.clipboard.writeText(ids.join("\n"))}
                  title="Copy these ids"
                  className="rounded-md border border-border bg-card px-2 py-1 font-mono text-[11px] text-foreground hover:bg-muted"
                >
                  {reasonKey}: {ids.length.toLocaleString()} · copy
                </button>
              ))}
          </div>
          <ul className="mt-2 space-y-0.5 font-mono text-[11px] text-muted-foreground">
            {rejected.slice(0, 20).map((r) => (
              <li key={r.patientId}>
                {r.patientId} — {r.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

    </div>
  );
}

function Runner({ def, canApply }: { def: RunnerDef; canApply: boolean }) {
  const run = useBackfillRunner(def.action);
  const [reason, setReason] = useState("");
  const [idsText, setIdsText] = useState("");
  const [limit, setLimit] = useState<string>("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [report, setReport] = useState<BackfillReport | null>(null);
  const [mode, setMode] = useState<"dry" | "apply" | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [cohort, setCohort] = useState<"minors" | "adults">("minors");
  const [skipExisting, setSkipExisting] = useState(true);
  // Async apply: the upstream wrapper claims a run doc, answers 202, and keeps
  // working server-side. This id is the handle for progress and for resuming.
  const [runId, setRunId] = useState<string | null>(null);
  const [resumeId, setResumeId] = useState("");
  const [attachNotice, setAttachNotice] = useState<string | null>(null);
  // Reset has its own run-id field: it is a destructive maintenance action on
  // a possibly DIFFERENT run than the one being resumed, so sharing state with
  // the resume input would let one silently retarget the other.
  const [resetRunId, setResetRunId] = useState("");
  const [resetReason, setResetReason] = useState("");
  const [resetNotice, setResetNotice] = useState<string | null>(null);
  const reset = useResetBackfillRun();



  const runStatus = useBackfillRunStatus(runId, Boolean(runId));
  const live = runStatus.data ?? null;
  // Only `complete` and `error` are terminal. `paused` (graceful pre-timeout
  // stop) and a stale lease (instance provably dead) are RESUMABLE states —
  // treating them as finished is what stranded runs mid-cohort.
  const paused = live?.status === "paused" || live?.paused === true;
  const staleLease = live?.staleLease === true;
  const runFinished = live?.status === "complete" || live?.status === "error";
  const resumableNow = !runFinished && (paused || staleLease);

  async function resumeSameRun() {
    if (!runId) return;
    setResumeId(runId);
    await go(true);
  }

  async function doReset(targetRunId: string) {
    setResetNotice(null);
    try {
      await reset.mutateAsync({ runId: targetRunId, reason: resetReason.trim() });
      setResetNotice(`Run ${targetRunId} reset — it can now be resumed with the same run id.`);
      runStatus.refetch();
    } catch (e) {
      setResetNotice(e instanceof Error ? e.message : "The reset failed.");
    }
  }
  const stalledMinutes =
    live && !runFinished && live.lastPatientAt
      ? Math.floor((Date.now() - new Date(live.lastPatientAt).getTime()) / 60000)
      : null;


  const ids = idsText
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const badIds = ids.filter((id) => !/^\d{6,25}$/.test(id));
  const idsReady = !def.needsIds || (ids.length > 0 && badIds.length === 0);

  // A dry run is synchronous upstream, so it is still walked in pages. An
  // APPLY is asynchronous: the whole cohort goes up in one call and the run
  // continues server-side, checkpointed per patient.
  const DRY_CHUNK = 100;

  function mergeCensus(
    a: BackfillReport["reportTypeCensus"],
    b: BackfillReport["reportTypeCensus"],
  ): BackfillReport["reportTypeCensus"] {
    if (!a && !b) return undefined;
    const byType = new Map<string, { reportType: string; count: number; category?: string | null; unmappedType?: boolean }>();
    [...(a ?? []), ...(b ?? [])].forEach((row) => {
      const prev = byType.get(row.reportType);
      if (prev) prev.count += row.count;
      else byType.set(row.reportType, { ...row });
    });
    return [...byType.values()].sort((x, y) => y.count - x.count);
  }

  function mergeReports(a: BackfillReport | null, b: BackfillReport): BackfillReport {
    if (!a) return b;
    const num = (x: unknown, y: unknown) =>
      (typeof x === "number" ? x : 0) + (typeof y === "number" ? y : 0);
    return {
      ...a,
      ...b,
      ingested: num(a.ingested, b.ingested),
      skipped: num(a.skipped, b.skipped),
      failed: [...(a.failed ?? []), ...(b.failed ?? [])],
      rejected: [...(a.rejected ?? []), ...(b.rejected ?? [])],
      eligible: num(a.eligible, b.eligible),
      wouldIngest: num(a.wouldIngest, b.wouldIngest),
      alreadyStored: num(a.alreadyStored, b.alreadyStored),
      skippedUnsigned: num(a.skippedUnsigned, b.skippedUnsigned),
      skippedDeleted: num(a.skippedDeleted, b.skippedDeleted),
      skippedNotAllowlisted: num(a.skippedNotAllowlisted, b.skippedNotAllowlisted),
      skippedRecordsDeferred: num(a.skippedRecordsDeferred, b.skippedRecordsDeferred),
      reportTypeCensus: mergeCensus(a.reportTypeCensus, b.reportTypeCensus),
    };
  }

  async function go(apply: boolean, runToEnd = false) {
    setMode(apply ? "apply" : "dry");
    setAttachNotice(null);
    let cur = cursor;
    try {
      if (def.needsIds) {
        if (apply) {
          // One call, one run. The server answers as soon as the run is
          // claimed; the work then proceeds without this browser.
          setReport(null);
          setProgress(null);
          const requestedRunId = resumeId.trim() || null;
          try {
            const res = await run.mutateAsync({
              apply: true,
              reason: reason.trim(),
              patientIds: ids,
              cohort,
              skipExisting,
              ...(requestedRunId ? { runId: requestedRunId } : {}),
            });
            setReport(res);
            if (res.runId) setRunId(res.runId);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            // 409 = this run (or another) is still draining server-side. That
            // is not a failure: attach to it and poll instead of erroring.
            if (/409|already in progress/i.test(msg) && requestedRunId) {
              setRunId(requestedRunId);
              setAttachNotice(
                `A run is already in progress. Attached to ${requestedRunId} — progress below updates every 10s.`,
              );
            } else {
              throw e;
            }
          }
          return;
        }

        let merged: BackfillReport | null = null;
        setReport(null);
        setProgress({ done: 0, total: ids.length });
        for (let i = 0; i < ids.length; i += DRY_CHUNK) {
          const chunk = ids.slice(i, i + DRY_CHUNK);
          const res = await run.mutateAsync({
            apply: false,
            reason: reason.trim(),
            patientIds: chunk,
            cohort,
            skipExisting,
          });
          merged = mergeReports(merged, res);
          setReport(merged);
          setProgress({ done: Math.min(i + DRY_CHUNK, ids.length), total: ids.length });
        }
        return;
      }
      // Batches are capped server-side (100) so a page always finishes inside
      // the 150s function window. "Run to completion" just walks the cursor.
      for (let page = 0; page < 500; page += 1) {
        const res = await run.mutateAsync({
          apply,
          reason: reason.trim(),
          ...(limit ? { limit: Number(limit) } : {}),
          ...(cur ? { cursor: cur } : {}),
        });
        setReport(res);
        cur = def.paged ? (res.nextCursor ?? null) : null;
        if (def.paged) setCursor(cur);
        if (!runToEnd || !def.paged || res.done || !cur) break;
      }
    } catch {
      /* surfaced through run.error */
    } finally {
      setMode(null);
    }
  }

  const busy = run.isPending;



  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-serif text-base text-foreground">{def.title}</h3>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{def.blurb}</p>
        </div>
        <span className="shrink-0 rounded-full border border-border px-2 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
          dry-run default
        </span>
      </div>

      {def.needsIds && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div>
            <label className="text-xs font-medium text-foreground">Cohort</label>
            <div className="mt-1 flex rounded-md border border-border p-0.5">
              {(["minors", "adults"] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setCohort(c)}
                  className={`rounded px-3 py-1 text-xs font-medium capitalize transition-colors ${
                    cohort === c
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-foreground">
            <input
              type="checkbox"
              checked={skipExisting}
              onChange={(e) => setSkipExisting(e.target.checked)}
              className="h-3.5 w-3.5 accent-[hsl(var(--primary))]"
            />
            Skip reports already stored
          </label>
          <div>
            <label className="text-xs font-medium text-foreground">Resume run id</label>
            <input
              value={resumeId}
              onChange={(e) => setResumeId(e.target.value.trim())}
              placeholder="optional"
              className="mt-1 w-56 rounded-md border border-border bg-background px-3 py-1.5 font-mono text-xs text-foreground"
            />
          </div>
        </div>
      )}

      {def.needsIds && (
        <div className="mt-3">
          <label className="text-xs font-medium text-foreground">
            {cohort === "adults" ? "Adult" : "Minor"} Elation patient ids
          </label>
          <textarea
            value={idsText}
            onChange={(e) => setIdsText(e.target.value)}
            rows={3}
            placeholder="One id per line, or comma separated"
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-foreground"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            {ids.length} id(s) parsed
            {badIds.length > 0 && (
              <span className="text-destructive"> · {badIds.length} malformed</span>
            )}
            {" · "}
            re-validated upstream against{" "}
            <span className="font-mono">
              {cohort === "adults" ? "the soft-adult rule" : "dependent.isMinor"}
            </span>
            .
          </p>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs font-medium text-foreground">Batch limit</label>
          <input
            value={limit}
            onChange={(e) => setLimit(e.target.value.replace(/\D/g, ""))}
            placeholder="100 max"
            className="mt-1 w-28 rounded-md border border-border bg-background px-3 py-1.5 font-mono text-xs text-foreground"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">capped at 100 per call</p>
        </div>

        {def.paged && (
          <div className="text-xs text-muted-foreground">
            Cursor:{" "}
            <span className="font-mono">{cursor ?? "start"}</span>
            {cursor && (
              <button
                onClick={() => setCursor(null)}
                className="ml-2 underline hover:text-foreground"
              >
                reset
              </button>
            )}
          </div>
        )}
        <div className="min-w-[220px] flex-1">
          <label className="text-xs font-medium text-foreground">
            Reason {canApply && <span className="text-muted-foreground">(required to apply)</span>}
          </label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why this run is happening"
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground"
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => go(false)}
          disabled={busy || !idsReady}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
        >
          {busy && mode === "dry" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          Dry run
        </button>

        {canApply && (
          <button
            onClick={() => go(true)}
            disabled={busy || !reason.trim() || !idsReady}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busy && mode === "apply" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ShieldAlert className="h-3.5 w-3.5" />
            )}
            Apply
          </button>
        )}

        {def.paged && (
          <button
            onClick={() => go(false, true)}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
          >
            Dry run to completion
          </button>
        )}

        {def.paged && canApply && (
          <button
            onClick={() => go(true, true)}
            disabled={busy || !reason.trim()}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            Apply all pages
          </button>
        )}

        {def.paged && report && !report.done && canApply && (
          <span className="text-[11px] text-muted-foreground">
            Run again to continue from the cursor.
          </span>
        )}

        {def.needsIds && progress && (
          <span className="font-mono text-[11px] text-muted-foreground">
            {progress.done}/{progress.total} ids processed
          </span>
        )}
      </div>

      {attachNotice && (
        <p className="mt-3 rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
          {attachNotice}
        </p>
      )}


      {def.needsIds && runId && (
        <div className="mt-3 rounded-md border border-border bg-muted/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-foreground">
              Run <span className="font-mono">{runId}</span>{" "}
              <span
                className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase ${
                  live?.status === "complete"
                    ? "bg-success/15 text-success"
                    : live?.status === "error"
                      ? "bg-destructive/10 text-destructive"
                      : staleLease
                        ? "bg-warning/15 text-warning"
                        : paused
                          ? "bg-warning/15 text-warning"
                          : "bg-muted text-muted-foreground"
                }`}
              >
                {staleLease && !runFinished ? "stale lease" : (live?.status ?? "starting")}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {!runFinished && !resumableNow && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              )}
              <button
                onClick={() => runStatus.refetch()}
                className="rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground hover:bg-muted"
              >
                Refresh
              </button>
              <button
                onClick={() => setRunId(null)}
                className="text-[11px] text-muted-foreground underline hover:text-foreground"
              >
                Stop watching
              </button>
            </div>
          </div>
          <p className="mt-2 font-mono text-[11px] text-muted-foreground">
            {live?.completed ?? 0}/{live?.requested ?? ids.length} patients
            {typeof live?.pending === "number" && <> · {live.pending} pending</>}
          </p>
          {live?.pendingIds?.length ? (
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              Waiting on: {live.pendingIds.join(", ")}
            </p>
          ) : null}
          {live?.inFlightIds?.length ? (
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              In flight (claimed, not yet checkpointed): {live.inFlightIds.join(", ")}
            </p>
          ) : null}
          {live?.abandonedIds?.length ? (
            <p className="mt-1 font-mono text-[11px] text-destructive">
              Abandoned on resume (already had a turn): {live.abandonedIds.join(", ")}
            </p>
          ) : null}
          {live?.lastPatientAt && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Last patient finished {new Date(live.lastPatientAt).toLocaleTimeString()}
              {stalledMinutes !== null && stalledMinutes >= 5 && (
                <span className="text-destructive">
                  {" "}· no progress for {stalledMinutes} min — likely stalled
                </span>
              )}
            </p>
          )}
          {resumableNow && (
            <div className="mt-3 rounded-md border border-warning/40 bg-warning/10 p-3">
              <p className="flex items-start gap-2 text-xs text-foreground">
                <PauseCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                <span>
                  {staleLease
                    ? "This run's lease expired — the instance that owned it is gone. It is safe to resume."
                    : "This run paused before the function timeout and flushed its cursor."}
                  {live?.pauseReason && (
                    <>
                      {" "}
                      <span className="font-mono">({live.pauseReason})</span>
                    </>
                  )}
                  {live?.leaseExpiresAt && (
                    <>
                      {" "}
                      Lease expired {new Date(live.leaseExpiresAt).toLocaleTimeString()}.
                    </>
                  )}
                  {live?.reclaimedFrom && (
                    <>
                      {" "}
                      Reclaimed from <span className="font-mono">{live.reclaimedFrom}</span>.
                    </>
                  )}
                </span>
              </p>
              {canApply && (
                <button
                  onClick={resumeSameRun}
                  disabled={busy || !reason.trim()}
                  className="mt-2 inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {busy && mode === "apply" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                  Resume (same run id)
                </button>
              )}
              {canApply && !reason.trim() && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  A reason is required to resume.
                </p>
              )}
            </div>
          )}
          {live?.errorReason && (
            <p className="mt-1 text-[11px] text-destructive">{live.errorReason}</p>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">
            The run continues on the server — closing this tab does not stop it. Paste this run id
            into &ldquo;Resume run id&rdquo; to re-attach or continue a partial run.
          </p>
        </div>
      )}

      {def.needsIds && canApply && (
        <div className="mt-3 rounded-md border border-border bg-muted/30 p-3">
          <p className="text-xs font-medium text-foreground">Reset a run</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Clears a run doc left at <span className="font-mono">running</span> by a killed
            instance (a zombie), so the same run id stops answering 409 and can be resumed. It
            ingests nothing and touches no member data. Super-admin only, reason required, audited
            before the call.
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <div>
              <label className="text-[11px] font-medium text-foreground">Run id</label>
              <input
                value={resumeId}
                onChange={(e) => setResumeId(e.target.value.trim())}
                placeholder="run id to reset"
                className="mt-1 w-56 rounded-md border border-border bg-background px-3 py-1.5 font-mono text-xs text-foreground"
              />
            </div>
            <div className="min-w-[200px] flex-1">
              <label className="text-[11px] font-medium text-foreground">Reason</label>
              <input
                value={resetReason}
                onChange={(e) => setResetReason(e.target.value)}
                placeholder="Why this run is being reset"
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground"
              />
            </div>
            <button
              onClick={() => doReset(resumeId.trim())}
              disabled={reset.isPending || !resumeId.trim() || !resetReason.trim()}
              className="inline-flex items-center gap-2 rounded-md border border-destructive/40 bg-background px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              {reset.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5" />
              )}
              Reset run
            </button>
          </div>
          {resetNotice && (
            <p className="mt-2 text-[11px] text-muted-foreground">{resetNotice}</p>
          )}
        </div>
      )}

      {run.error && !attachNotice && (
        <p className="mt-3 flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {run.error instanceof Error ? run.error.message : "The run failed."}
        </p>
      )}

      {report && <ReportView report={report} />}
    </section>
  );
}

export default function BackfillRunner() {
  const { isSuperAdmin } = useAuth();

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4 shadow-soft">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          <h2 className="font-serif text-lg text-foreground">Migration &amp; backfills</h2>
        </div>
        <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
          These run against live member data through the portal control plane. Dry run first,
          always. Applying is limited to super administrators and every apply is recorded with your
          name and reason before it runs. Nothing here changes{" "}
          <span className="font-mono">GUARDIAN_READS_ENABLED</span> or any other flag.
        </p>
        {!isSuperAdmin && (
          <p className="mt-2 rounded-md bg-muted/60 p-2 text-[11px] text-muted-foreground">
            You can run dry runs. Applying requires the super-administrator role.
          </p>
        )}
      </div>

      {RUNNERS.map((def) => (
        <Runner key={def.action} def={def} canApply={isSuperAdmin} />
      ))}
    </div>
  );
}
