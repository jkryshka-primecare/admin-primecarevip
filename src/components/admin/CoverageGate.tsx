import { Check, X, ShieldAlert, ShieldCheck } from "lucide-react";
import { evaluateGate, type CoverageReport, type SegmentCounts } from "@/hooks/useArtifactCoverage";

/**
 * Release 2b Part B — the go/no-go gate for flipping `GUARDIAN_READS_ENABLED`.
 *
 * This is a gate dashboard, not a data dump: counts, percentages and an
 * explicit pass/fail per cohort line. A `null` coveragePct (zero denominator)
 * renders as a visible FAIL, never as blank and never as 100% — a whole cohort
 * that never populated is exactly what this surface exists to expose.
 *
 * No PHI here: cohort counts only. Patient-level rows stay behind the
 * reveal step in the parent panel, under the same audited bridge read.
 */
export default function CoverageGate({ report }: { report: CoverageReport }) {
  const verdict = evaluateGate(report);

  return (
    <div className="mt-5 overflow-hidden rounded-xl border border-border">
      <div
        className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 ${
          verdict.pass ? "bg-success/10" : "bg-warning/10"
        }`}
      >
        <div className="flex items-center gap-2">
          {verdict.pass ? (
            <ShieldCheck className="h-4 w-4 text-success" />
          ) : (
            <ShieldAlert className="h-4 w-4 text-warning" />
          )}
          <p className="text-sm font-medium text-foreground">
            {!verdict.validGateRun
              ? "Not a valid gate run — legacy uid fallback was ON"
              : `Guardian-read join gate — ${verdict.pass ? "all conditions met" : "not met"}`}
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          {!verdict.validGateRun
            ? "Re-run with the fallback disabled to evaluate the gate."
            : "Pass requires 100% over a non-zero denominator on every line."}
        </p>
      </div>

      {!verdict.validGateRun && (
        <div className="border-t border-border bg-destructive/10 px-4 py-3 text-xs text-destructive">
          This report was produced with <span className="font-mono">ARTIFACT_LEGACY_UID_FALLBACK</span>{" "}
          enabled (or the run predates the flag). Legacy-path objects were counted as present, so
          the cohort figures below can read green while the uid-keyed path is still empty. They
          cannot be used to flip <span className="font-mono">GUARDIAN_READS_ENABLED</span>.
        </div>
      )}


      <table className="w-full text-left text-xs">
        <thead className="bg-muted/60 text-muted-foreground">
          <tr>
            <th className="w-10 px-3 py-2 font-medium" />
            <th className="px-3 py-2 font-medium">Cohort</th>
            <th className="px-3 py-2 font-medium">Coverage</th>
            <th className="px-3 py-2 font-medium">Referenced</th>
            <th className="px-3 py-2 font-medium">Present</th>
            <th className="px-3 py-2 font-medium">Missing</th>
            <th className="px-3 py-2 font-medium">Notes</th>
          </tr>
        </thead>
        <tbody>
          {verdict.lines.map((l) => (
            <tr
              key={l.key}
              className={`border-t border-border ${l.key.startsWith("minor-") ? "bg-muted/20" : ""}`}
            >
              <td className="px-3 py-2">
                <Mark pass={l.pass} />
              </td>
              <td className={`px-3 py-2 ${l.key.startsWith("minor-") ? "pl-6 text-muted-foreground" : "text-foreground"}`}>
                {l.label}
              </td>
              <td className="px-3 py-2 font-mono">
                <Pct counts={l.counts} pass={l.pass} />
              </td>
              <td className="px-3 py-2 font-mono">{l.counts.referenced.toLocaleString()}</td>
              <td className="px-3 py-2 font-mono">{l.counts.present.toLocaleString()}</td>
              <td className={`px-3 py-2 font-mono ${l.counts.missing ? "text-destructive" : ""}`}>
                {l.counts.missing.toLocaleString()}
              </td>
              <td className="px-3 py-2 text-muted-foreground">{l.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="grid gap-2 border-t border-border bg-background px-4 py-3 sm:grid-cols-2">
        {verdict.checks.map((c) => (
          <div key={c.key} className="flex items-start gap-2 text-xs">
            <Mark pass={c.pass} />
            <span className={c.pass ? "text-muted-foreground" : "text-destructive"}>
              <span className="font-medium text-foreground">{c.label}</span> — {c.detail}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Mark({ pass }: { pass: boolean }) {
  return pass ? (
    <Check className="h-3.5 w-3.5 shrink-0 text-success" />
  ) : (
    <X className="h-3.5 w-3.5 shrink-0 text-destructive" />
  );
}

/**
 * A missing percentage is rendered as "—  no denominator" in the fail colour.
 * It must never read as blank (looks like a rendering bug) or as 100%.
 */
function Pct({ counts, pass }: { counts: SegmentCounts; pass: boolean }) {
  if (counts.coveragePct === null) {
    return (
      <span className="text-destructive">
        — <span className="font-sans text-[11px]">no denominator</span>
      </span>
    );
  }
  return (
    <span className={pass ? "text-success" : "text-destructive"}>
      {counts.coveragePct.toFixed(1)}%
    </span>
  );
}
