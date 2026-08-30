import { useState } from "react";
import { AlertTriangle, Loader2, PauseCircle, Play, RotateCcw, Wrench } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  useArtifactSweepStatus,
  useResetArtifactSweep,
  useRunArtifactSweep,
  type SweepReport,
} from "@/hooks/usePortalAdmin";

/**
 * Artifact repair sweep — operator control for the large tail.
 *
 * The nightly cron still runs at 03:45 with a 100-item cap. This drives the
 * SAME code path on demand with a bigger bound, so a ~2,000-artifact backlog
 * is drained in an afternoon instead of twenty nights.
 *
 * Guardrails, all enforced server-side:
 *   - start/resume and reset need super-admin plus a written reason, and are
 *     attributed before the upstream call;
 *   - status is a counters-only poll, admin-gated and unaudited;
 *   - every artifact fetch goes through the one process-wide Elation gate.
 *
 * Paused / stale-lease are NON-terminal: resume with the same run id.
 */

const RUN_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-mono text-sm text-foreground">{value}</p>
    </div>
  );
}

function statusTone(run: SweepReport | undefined) {
  if (!run) return "border-border bg-muted/30 text-muted-foreground";
  if (run.status === "complete") return "border-success/40 bg-success/10 text-foreground";
  if (run.status === "error") return "border-destructive/40 bg-destructive/10 text-foreground";
  if (run.staleLease || run.status === "paused") return "border-warning/40 bg-warning/10 text-foreground";
  return "border-border bg-muted/30 text-foreground";
}

export default function ArtifactSweepRunner() {
  const { isSuperAdmin } = useAuth();
  const [reason, setReason] = useState("");
  const [maxItems, setMaxItems] = useState("2000");
  const [runId, setRunId] = useState("");
  const [resetRunId, setResetRunId] = useState("");
  const [resetReason, setResetReason] = useState("");
  const [force, setForce] = useState(false);
  const [clearGlobalPause, setClearGlobalPause] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const start = useRunArtifactSweep();
  const reset = useResetArtifactSweep();
  const status = useArtifactSweepStatus(activeRunId, Boolean(activeRunId));
  const run = status.data;

  const terminal = run?.status === "complete";
  const resumable = Boolean(run && !terminal && (run.resumable || run.staleLease || run.status === "paused"));

  const go = async (explicitRunId?: string) => {
    setNotice(null);
    const id = (explicitRunId ?? runId).trim();
    if (id && !RUN_ID_RE.test(id)) {
      setNotice("That run id is not valid.");
      return;
    }
    try {
      const res = await start.mutateAsync({
        reason: reason.trim(),
        ...(id ? { runId: id } : {}),
        ...(Number(maxItems) > 0 ? { maxItems: Number(maxItems) } : {}),
      });
      if (res.runId) {
        setActiveRunId(res.runId);
        setRunId(res.runId);
      }
      if (res.alreadyComplete) setNotice("That run is already complete — nothing left to drain.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  };

  const doReset = async () => {
    setNotice(null);
    const id = resetRunId.trim();
    if (!RUN_ID_RE.test(id)) {
      setNotice("Enter the run id you want to reset.");
      return;
    }
    if (!resetReason.trim()) {
      setNotice("A written reason is required to reset a run.");
      return;
    }
    try {
      await reset.mutateAsync({
        runId: id,
        reason: resetReason.trim(),
        ...(force ? { force: true } : {}),
        ...(clearGlobalPause ? { clearGlobalPause: true } : {}),
      });
      setNotice(`Run ${id} reset to paused — it can be resumed with the same id.`);
      setActiveRunId(id);
      setRunId(id);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  };

  const counters = run?.counters ?? {};

  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-soft">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2 font-serif text-base text-foreground">
            <Wrench className="h-4 w-4 text-primary" aria-hidden />
            Artifact repair sweep
          </h3>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            Drains the repair queue the coverage audit fills. Resumable: when the run pauses at the
            instance limit, press Resume with the same run id until it reports complete and nothing
            remains. The nightly job still runs on its own.
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-border px-2 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
          sweep
        </span>
      </div>

      {!isSuperAdmin && (
        <p className="mt-3 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-foreground">
          Running or resetting the sweep requires the super-administrator role. You can still watch a
          run's progress.
        </p>
      )}

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="md:col-span-2">
          <label className="text-xs font-medium text-foreground" htmlFor="sweep-reason">
            Reason (required to run)
          </label>
          <input
            id="sweep-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Drain the post-backfill artifact tail"
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-foreground" htmlFor="sweep-max">
            Max items this run
          </label>
          <input
            id="sweep-max"
            inputMode="numeric"
            value={maxItems}
            onChange={(e) => setMaxItems(e.target.value.replace(/[^0-9]/g, ""))}
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground"
          />
        </div>
        <div className="md:col-span-2">
          <label className="text-xs font-medium text-foreground" htmlFor="sweep-run-id">
            Run id (leave blank to start a new run, or paste one to resume)
          </label>
          <input
            id="sweep-run-id"
            value={runId}
            onChange={(e) => setRunId(e.target.value.trim())}
            placeholder="new run"
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground"
          />
        </div>
        <div className="flex items-end">
          <button
            type="button"
            disabled={!isSuperAdmin || !reason.trim() || start.isPending}
            onClick={() => go()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            {start.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Play className="h-3.5 w-3.5" aria-hidden />
            )}
            {runId ? "Resume run" : "Start sweep"}
          </button>
        </div>
      </div>

      {notice && (
        <p className="mt-3 rounded-md border border-border bg-muted/40 p-2 text-xs text-foreground">
          {notice}
        </p>
      )}

      {activeRunId && (
        <div className={`mt-4 rounded-md border p-3 ${statusTone(run)}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px]">{activeRunId}</span>
            <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[10px] uppercase">
              {run?.staleLease ? "stale lease" : (run?.status ?? "loading")}
            </span>
            {run?.globalPaused && (
              <span className="inline-flex items-center gap-1 rounded-full border border-destructive/40 px-2 py-0.5 text-[10px] uppercase text-foreground">
                <PauseCircle className="h-3 w-3" aria-hidden />
                upstream paused
              </span>
            )}
            {status.isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          </div>

          {(run?.pauseReason || run?.errorReason || run?.globalPauseReason) && (
            <p className="mt-2 flex items-start gap-1.5 text-xs">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="font-mono">
                {run?.errorReason ?? run?.pauseReason ?? run?.globalPauseReason}
              </span>
            </p>
          )}

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Processed" value={run?.processed ?? 0} />
            <Stat label="Healed" value={counters.healed ?? 0} />
            <Stat label="Failed" value={counters.failed ?? 0} />
            <Stat label="Deferred" value={counters.deferred ?? 0} />
            <Stat label="Parked (run)" value={run?.parkedThisRun ?? 0} />
            <Stat label="Remaining" value={run?.remaining ?? "—"} />
            <Stat label="Cycles" value={run?.cycles ?? 0} />
            <Stat label="Max items" value={run?.maxItems ?? "—"} />
          </div>

          {resumable && (
            <button
              type="button"
              disabled={!isSuperAdmin || !reason.trim() || start.isPending}
              onClick={() => go(activeRunId)}
              className="mt-3 inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" aria-hidden />
              Resume (same run id)
            </button>
          )}

          {terminal && (
            <p className="mt-3 text-xs">
              Run complete. Re-run the coverage audit to confirm the queue is empty before calling the
              tail cleared.
            </p>
          )}
        </div>
      )}

      <details className="mt-4 rounded-md border border-border bg-muted/20 p-3">
        <summary className="cursor-pointer text-xs font-medium text-foreground">
          Reset a stuck sweep run
        </summary>
        <p className="mt-2 text-xs text-muted-foreground">
          Clears the lease and status on a run doc so the same id can be resumed. It touches no
          artifacts and no patient data.
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <input
            value={resetRunId}
            onChange={(e) => setResetRunId(e.target.value.trim())}
            placeholder="run id"
            aria-label="Run id to reset"
            className="rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground"
          />
          <input
            value={resetReason}
            onChange={(e) => setResetReason(e.target.value)}
            placeholder="Reason for the reset"
            aria-label="Reset reason"
            className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground md:col-span-2"
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-foreground">
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
            Force (reclaim a live lease)
          </label>
          <label className="flex items-center gap-2 text-xs text-foreground">
            <input
              type="checkbox"
              checked={clearGlobalPause}
              onChange={(e) => setClearGlobalPause(e.target.checked)}
            />
            Also clear the upstream pause
          </label>
          <button
            type="button"
            disabled={!isSuperAdmin || reset.isPending}
            onClick={doReset}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
          >
            {reset.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            )}
            Reset run
          </button>
        </div>
      </details>
    </section>
  );
}
