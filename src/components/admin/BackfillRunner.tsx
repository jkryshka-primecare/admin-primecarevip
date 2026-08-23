import { useState } from "react";
import { AlertTriangle, Loader2, Play, ShieldAlert, Users } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  useBackfillRunner,
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
    title: "Minor-track report ingest",
    blurb:
      "Ingests Elation reports for guardian-proxied minors only. The id list is re-validated against the minor set upstream.",
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

      {rejected.length > 0 && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
          <p className="font-medium text-foreground">
            {rejected.length} id(s) refused upstream — not in the minor set:
          </p>
          <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-muted-foreground">
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

  const ids = idsText
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const badIds = ids.filter((id) => !/^\d{6,25}$/.test(id));
  const idsReady = !def.needsIds || (ids.length > 0 && badIds.length === 0);

  async function go(apply: boolean, runToEnd = false) {
    setMode(apply ? "apply" : "dry");
    let cur = cursor;
    try {
      // Batches are capped server-side (100) so a page always finishes inside
      // the 150s function window. "Run to completion" just walks the cursor.
      for (let page = 0; page < 500; page += 1) {
        const res = await run.mutateAsync({
          apply,
          reason: reason.trim(),
          ...(limit ? { limit: Number(limit) } : {}),
          ...(cur ? { cursor: cur } : {}),
          ...(def.needsIds ? { patientIds: ids } : {}),
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
        <div className="mt-3">
          <label className="text-xs font-medium text-foreground">
            Minor Elation patient ids
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
            re-validated against <span className="font-mono">dependent.isMinor</span> upstream.
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
      </div>


      {run.error && (
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
