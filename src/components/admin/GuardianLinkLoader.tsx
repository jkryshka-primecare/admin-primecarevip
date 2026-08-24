import { useMemo, useState } from "react";
import { AlertTriangle, HeartHandshake, Loader2, Play, ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useGuardianLinkLoader, type GuardianLinkReport } from "@/hooks/usePortalAdmin";

/**
 * Release 2b Step 1 — loads the finalized guardian-link CSV through the portal
 * control plane, replacing scripts/load-guardian-links.js and the standing
 * serviceAccountTokenCreator grant it required.
 *
 * Everything shown here is advisory. The authority is server-side:
 *   - is_hr_admin for a dry run, super_admin + written reason to apply;
 *   - the CSV is re-parsed and re-validated in the edge function;
 *   - the attribution row is written before the first upstream write;
 *   - adminLinkGuardian re-checks child exists / is a minor / source is known.
 */

const PAGE_SIZE = 50;

function Stat({ label, value, tone }: { label: string; value: string; tone?: "bad" }) {
  return (
    <span
      className={`rounded-md px-2 py-1 font-mono text-[11px] ${
        tone === "bad"
          ? "bg-destructive/10 text-destructive"
          : "border border-border bg-muted/50 text-foreground"
      }`}
    >
      {label}: {value}
    </span>
  );
}

function ReportView({ report }: { report: GuardianLinkReport }) {
  const rejected = report.rejected ?? [];
  const failures = report.failures ?? [];
  const preview = report.preview ?? [];

  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap gap-2">
        <Stat label="Rows" value={String(report.totalRows ?? 0)} />
        <Stat label="Children" value={String(report.uniqueChildren ?? 0)} />
        {report.duplicates ? <Stat label="Duplicates dropped" value={String(report.duplicates)} /> : null}
        {report.apply && <Stat label="Processed" value={String(report.processed ?? 0)} />}
        {report.apply && <Stat label="Created" value={String(report.created ?? 0)} />}
        {report.apply && <Stat label="Updated" value={String(report.updated ?? 0)} />}
        <Stat
          label={report.apply ? "Failed" : "Rejected"}
          value={String(report.apply ? failures.length : rejected.length)}
          tone={(report.apply ? failures.length : rejected.length) > 0 ? "bad" : undefined}
        />
        <Stat label="Status" value={report.done ? "done" : `resume at ${report.nextOffset ?? 0}`} />
      </div>

      {!report.apply && preview.length > 0 && (
        <div className="rounded-md border border-border bg-muted/40 p-3">
          <p className="text-xs font-medium text-foreground">First rows that would be linked</p>
          <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-muted-foreground">
            {preview.map((p) => (
              <li key={`${p.childElationId}-${p.guardianRef}`}>
                {p.childElationId} &larr; {p.guardianRef} [{p.source}]
              </li>
            ))}
          </ul>
        </div>
      )}

      {rejected.length > 0 && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
          <p className="font-medium text-foreground">
            {rejected.length} row(s) refused before any call was made:
          </p>
          <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-muted-foreground">
            {rejected.slice(0, 25).map((r) => (
              <li key={`${r.line}-${r.reason}`}>
                line {r.line} — {r.childElationId ?? "no chart id"} — {r.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {failures.length > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs">
          <p className="font-medium text-destructive">{failures.length} link(s) failed upstream:</p>
          <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-destructive/90">
            {failures.slice(0, 25).map((f) => (
              <li key={`${f.childElationId}-${f.guardianRef}`}>
                {f.childElationId} &larr; {f.guardianRef} — {f.reason} ({f.status})
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function GuardianLinkLoader() {
  const { isSuperAdmin } = useAuth();
  const run = useGuardianLinkLoader();

  const [csv, setCsv] = useState("");
  const [reason, setReason] = useState("");
  const [onlyChild, setOnlyChild] = useState("");
  const [offset, setOffset] = useState(0);
  const [report, setReport] = useState<GuardianLinkReport | null>(null);
  const [mode, setMode] = useState<"dry" | "apply" | null>(null);

  const localRowCount = useMemo(
    () => csv.split(/\r?\n/).filter((l) => l.trim()).length - 1,
    [csv],
  );
  const csvReady = csv.trim().length > 0 && localRowCount > 0;
  const onlyChildValid = !onlyChild.trim() || /^\d{6,25}$/.test(onlyChild.trim());

  async function go(apply: boolean, runToEnd = false) {
    setMode(apply ? "apply" : "dry");
    let cur = offset;
    try {
      for (let page = 0; page < 100; page += 1) {
        const res = await run.mutateAsync({
          csv,
          apply,
          reason: reason.trim(),
          offset: cur,
          pageSize: PAGE_SIZE,
          ...(onlyChild.trim() ? { onlyChildElationId: onlyChild.trim() } : {}),
        });
        setReport(res);
        cur = res.nextOffset ?? 0;
        setOffset(res.done ? 0 : cur);
        if (!runToEnd || !apply || res.done || res.partial || !res.nextOffset) break;
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
          <div className="flex items-center gap-2">
            <HeartHandshake className="h-4 w-4 text-primary" />
            <h3 className="font-serif text-base text-foreground">Guardian links (Step 1)</h3>
          </div>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            Paste the finalized guardian-links CSV. A dry run validates every row server-side and
            makes <span className="font-medium">no</span> upstream call. Applying attaches guardians
            one child at a time in pages of {PAGE_SIZE}, and is idempotent — re-running the same CSV
            updates rather than duplicates. The minor records must already exist (Provision Missing
            with &ldquo;Adults only&rdquo; off); missing ones come back as{" "}
            <span className="font-mono">CHILD_NOT_FOUND</span>.
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-border px-2 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
          dry-run default
        </span>
      </div>

      <div className="mt-3">
        <label className="text-xs font-medium text-foreground">Guardian links CSV</label>
        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={6}
          placeholder="minor_name,minor_dob,minor_elation_id,...,match_source,confirmed_at"
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-[11px] text-foreground"
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          {csvReady ? `${localRowCount} data row(s) pasted` : "Include the header row"} · parsed and
          validated server-side.
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs font-medium text-foreground">Single child (stage 2)</label>
          <input
            value={onlyChild}
            onChange={(e) => setOnlyChild(e.target.value.replace(/\D/g, ""))}
            placeholder="minor Elation id"
            className="mt-1 w-44 rounded-md border border-border bg-background px-3 py-1.5 font-mono text-xs text-foreground"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            {onlyChildValid ? "blank = the whole CSV" : "not a valid chart id"} · filters the pasted
            CSV, it does not replace it
          </p>

        </div>
        <div className="text-xs text-muted-foreground">
          Resume offset: <span className="font-mono">{offset}</span>
          {offset > 0 && (
            <button onClick={() => setOffset(0)} className="ml-2 underline hover:text-foreground">
              reset
            </button>
          )}
        </div>
        <div className="min-w-[220px] flex-1">
          <label className="text-xs font-medium text-foreground">
            Reason {isSuperAdmin && <span className="text-muted-foreground">(required to apply)</span>}
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
          disabled={busy || !csvReady || !onlyChildValid}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
        >
          {busy && mode === "dry" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          Dry run (validate)
        </button>

        {isSuperAdmin && (
          <>
            <button
              onClick={() => go(true)}
              disabled={busy || !csvReady || !onlyChildValid || !reason.trim()}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {busy && mode === "apply" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ShieldAlert className="h-3.5 w-3.5" />
              )}
              Apply one page
            </button>
            <button
              onClick={() => go(true, true)}
              disabled={busy || !csvReady || !onlyChildValid || !reason.trim()}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              Apply all pages
            </button>
          </>
        )}

        {report && report.apply && !report.done && (
          <span className="text-[11px] text-muted-foreground">
            Run again to continue from offset {report.nextOffset ?? 0}.
          </span>
        )}
      </div>

      {!isSuperAdmin && (
        <p className="mt-2 rounded-md bg-muted/60 p-2 text-[11px] text-muted-foreground">
          You can validate. Creating guardian links requires the super-administrator role.
        </p>
      )}

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
