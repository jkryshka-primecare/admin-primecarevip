import { useState } from "react";
import { AlertTriangle, Bot, Loader2, OctagonX, Play, RotateCcw } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  useDriverStatus,
  useResumeDriver,
  useStartDriver,
  useStopDriver,
  type DriverState,
} from "@/hooks/usePortalAdmin";

/**
 * Auto-resume driver — watch and stop.
 *
 * The driver orchestrates the pieces we already have: it re-POSTs the SAME
 * backfill runId until `pending:0 && abandoned:0`, THEN drives the sweep until
 * `remaining:0`, then triggers the coverage audit and parks at
 * `awaiting_signoff`. It never declares the migration complete — the operator
 * does, on coverage MISS=0.
 *
 * Guardrails live server-side (cycle cap, stop-on-error, failed-rate brake,
 * no-progress guard, kill switch, opt-in). This card only surfaces them.
 * Arming is super-admin + written reason; STOP is admin-level on purpose.
 */

const RUN_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
const DEFAULT_DRIVER_ID = "adult-backfill";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-mono text-sm text-foreground">{value}</p>
    </div>
  );
}

function tone(d: DriverState | undefined) {
  if (!d) return "border-border bg-muted/30 text-muted-foreground";
  if (d.haltReason) return "border-destructive/40 bg-destructive/10 text-foreground";
  if (d.phase === "awaiting_signoff") return "border-success/40 bg-success/10 text-foreground";
  if (d.enabled) return "border-accent/40 bg-accent/10 text-foreground";
  return "border-border bg-muted/30 text-foreground";
}

export default function AutoResumeDriver() {
  const { isSuperAdmin } = useAuth();
  const [driverId, setDriverId] = useState(DEFAULT_DRIVER_ID);
  const [backfillRunId, setBackfillRunId] = useState("");
  const [patientIdsRaw, setPatientIdsRaw] = useState("");
  const [reason, setReason] = useState("");
  const [stopReason, setStopReason] = useState("");
  const [watching, setWatching] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const start = useStartDriver();
  const stop = useStopDriver();
  const resume = useResumeDriver();
  const status = useDriverStatus(driverId, watching);
  const d = status.data;

  const patientIds = patientIdsRaw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const arm = async () => {
    setNotice(null);
    if (!RUN_ID_RE.test(backfillRunId.trim())) {
      setNotice("Enter the existing backfill run id the driver should resume.");
      return;
    }
    if (patientIds.length === 0) {
      setNotice("Paste the cohort's Elation patient ids.");
      return;
    }
    if (reason.trim().length < 8) {
      setNotice("A written reason is required to arm an unattended run.");
      return;
    }
    try {
      await start.mutateAsync({
        driverId: driverId.trim(),
        backfillRunId: backfillRunId.trim(),
        patientIds,
        reason: reason.trim(),
        cohort: "adults",
      });
      setWatching(true);
      setNotice("Driver armed. The scheduler picks it up within two minutes.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not arm the driver.");
    }
  };

  const kill = async () => {
    setNotice(null);
    if (stopReason.trim().length < 4) {
      setNotice("Give a short reason for the stop — it is written to the audit trail.");
      return;
    }
    try {
      await stop.mutateAsync({ driverId: driverId.trim(), reason: stopReason.trim() });
      setNotice("Kill switch set. The driver halts on its next tick.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not stop the driver.");
    }
  };

  const rearm = async () => {
    setNotice(null);
    if (stopReason.trim().length < 8) {
      setNotice("Clearing a halt needs a written reason.");
      return;
    }
    try {
      await resume.mutateAsync({ driverId: driverId.trim(), reason: stopReason.trim() });
      setNotice("Halt cleared; the driver resumes from its cursor.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not resume the driver.");
    }
  };

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <header className="mb-3 flex items-center gap-2">
        <Bot className="h-4 w-4 text-accent" aria-hidden />
        <h3 className="font-serif text-lg text-foreground">Auto-resume driver</h3>
      </header>
      <p className="mb-4 text-sm text-muted-foreground">
        Drives the backfill to <span className="font-mono">pending:0</span>, then the repair sweep
        to <span className="font-mono">remaining:0</span>, then triggers the coverage audit and
        stops. It never declares the migration complete — you do, on coverage MISS=0.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Driver id</span>
          <input
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-sm"
            value={driverId}
            onChange={(e) => setDriverId(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Backfill run id to resume</span>
          <input
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-sm"
            value={backfillRunId}
            onChange={(e) => setBackfillRunId(e.target.value)}
            placeholder="existing runId"
          />
        </label>
      </div>

      {isSuperAdmin && (
        <>
          <label className="mt-3 block text-sm">
            <span className="mb-1 block text-muted-foreground">
              Cohort patient ids ({patientIds.length})
            </span>
            <textarea
              className="h-20 w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs"
              value={patientIdsRaw}
              onChange={(e) => setPatientIdsRaw(e.target.value)}
              placeholder="Elation ids, comma or newline separated"
            />
          </label>
          <label className="mt-3 block text-sm">
            <span className="mb-1 block text-muted-foreground">Reason (required to arm)</span>
            <input
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        </>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {isSuperAdmin && (
          <button
            type="button"
            onClick={arm}
            disabled={start.isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground disabled:opacity-50"
          >
            {start.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Play className="h-3.5 w-3.5" aria-hidden />
            )}
            Arm driver
          </button>
        )}
        <button
          type="button"
          onClick={() => setWatching(true)}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground"
        >
          Watch
        </button>
        <input
          className="min-w-[12rem] flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          value={stopReason}
          onChange={(e) => setStopReason(e.target.value)}
          placeholder="Reason for stop / resume"
        />
        <button
          type="button"
          onClick={kill}
          disabled={stop.isPending}
          className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground disabled:opacity-50"
        >
          {stop.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <OctagonX className="h-3.5 w-3.5" aria-hidden />
          )}
          Stop
        </button>
        {isSuperAdmin && d?.haltReason && (
          <button
            type="button"
            onClick={rearm}
            disabled={resume.isPending}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-foreground disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            Clear halt
          </button>
        )}
      </div>

      {notice && <p className="mt-3 text-sm text-muted-foreground">{notice}</p>}

      {watching && (
        <div className={`mt-4 rounded-md border p-3 ${tone(d)}`}>
          {status.isLoading && !d ? (
            <p className="text-sm">Reading driver state…</p>
          ) : (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-mono">{d?.phase ?? "idle"}</span>
                <span className="text-muted-foreground">
                  {d?.enabled ? "running" : "not armed"}
                </span>
                {d?.killSwitch && <span className="font-medium">kill switch set</span>}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Cycles" value={d?.cycles ?? 0} />
                <Stat label="Backfill" value={d?.backfillCycles ?? 0} />
                <Stat label="Sweep" value={d?.sweepCycles ?? 0} />
                <Stat label="No-progress" value={d?.noProgressStreak ?? 0} />
              </div>
              {d?.lastAction && (
                <p className="mt-2 font-mono text-xs text-muted-foreground">
                  last: {d.lastAction}
                  {d.lastActionReason ? ` (${d.lastActionReason})` : ""}
                  {d.lastActionAt ? ` · ${d.lastActionAt}` : ""}
                </p>
              )}
              {d?.haltReason && (
                <p className="mt-2 flex items-start gap-1.5 text-sm">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>
                    Halted: <span className="font-mono">{d.haltReason}</span>
                    {d.haltDetail ? ` — ${d.haltDetail}` : ""}
                  </span>
                </p>
              )}
              {d?.phase === "awaiting_signoff" && (
                <p className="mt-2 text-sm">
                  Backfill and sweep are drained and the coverage audit was triggered. Run the
                  final coverage check and confirm MISS=0 before calling this done.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
