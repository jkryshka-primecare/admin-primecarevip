import { evaluateGate, type CoverageReport } from "@/hooks/useArtifactCoverage";
import type { SmokeReport } from "@/hooks/usePortalAdmin";

/**
 * Builds a hand-off Markdown report an operator can paste to their agent:
 * the strict audit's numbers, the go/no-go gate lines, and the latest
 * read-path smoke result.
 *
 * De-identified by default — counts and pass/fail only. Patient ids, document
 * ids and storage paths are PHI and are only appended when the operator
 * explicitly asks for them (`includePhi`), matching the audited CSV export.
 */
export type HandoffOptions = {
  report: CoverageReport;
  smoke?: SmokeReport | null;
  includePhi?: boolean;
  generatedAt?: Date;
};

const yn = (b: boolean) => (b ? "PASS" : "FAIL");

function segLine(label: string, s: {
  referenced: number;
  present: number;
  missing: number;
  unpathed: number;
  errored: number;
  coveragePct: number | null;
  ingestableCoveragePct?: number | null;
  ingestableDenominator?: number;
  ingestableMissing?: number;
  excluded?: number;
}) {
  const ip = s.ingestableCoveragePct;
  const pct = ip === undefined || ip === null ? "n/a" : `${ip.toFixed(1)}%`;
  return `| ${label} | ${pct} | ${s.referenced} | ${s.present} | ${s.missing} | ${s.unpathed} | ${s.errored} |`;
}

export function buildCoverageHandoff(opts: HandoffOptions): string {
  const { report, smoke, includePhi = false } = opts;
  const now = opts.generatedAt ?? new Date();
  const gate = evaluateGate(report);
  const pct = report.coveragePct === null ? "n/a" : `${report.coveragePct.toFixed(1)}%`;

  const L: string[] = [];
  L.push("# Artifact coverage hand-off");
  L.push("");
  L.push(`- Exported: ${now.toISOString()}`);
  L.push(`- Audit run: \`${report.runId}\``);
  L.push(`- Run generated: ${report.generatedAt ?? "unknown"}`);
  L.push(`- Run status: ${report.status}`);
  L.push(
    `- Scope: referenced artifacts only (\`hasArtifact: true\` resolves to a real Storage object). This is NOT a measure of whether we hold everything Elation has.`,
  );
  L.push("");

  L.push("## Headline");
  L.push("");
  L.push(`- Referenced artifacts present: **${pct}**`);
  L.push(`- Referenced: ${report.totalReferenced} · present: ${report.presentCount} · missing: ${report.missingCount}`);
  // D-307: the residual as a named list — this is the clinical-ops sign-off line.
  L.push(
    `- Residual by reason: ingestable ${report.byReason.ingestable} · unsigned ${report.byReason.unsigned} · deleted in Elation ${report.byReason.deletedInElation} · pending sweep ${report.byReason.pendingSweep}`,
  );
  L.push(
    `- Ingestable coverage: ${report.ingestableCoveragePct === null ? "n/a" : `${report.ingestableCoveragePct.toFixed(2)}%`} over ${report.ingestableDenominator} documents`,
  );
  L.push(`- Unclaimed patients with pending reports (D-111): ${report.unclaimedWithPendingReports}`);
  if (report.convergence) {
    L.push(
      `- Convergence: residual ${report.convergence.residualSeries.join(" → ")} · ${report.convergence.converged ? "converged" : "not yet converged"}`,
    );
  }
  L.push(`- Parked (alerting): ${report.parkedCount}`);
  L.push(`- Unpathed (no storage key, excluded from %): ${report.unpathedCount}`);
  L.push(`- Failed storage probes: ${report.erroredCount}${
    Object.keys(report.errorStatusCounts ?? {}).length
      ? ` (${Object.entries(report.errorStatusCounts)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ")})`
      : ""
  }`);
  L.push(`- Fixtures excluded: ${report.fixtureExcludedCount}`);
  L.push(`- Truncated walk: ${report.truncatedWalk ? "YES — partial run" : "no"}`);
  L.push(`- Systemic storage failure: ${report.systemicStorageFailure ? "YES — no repairs queued" : "no"}`);
  L.push(`- Legacy uid fallback disabled (strict run): ${report.legacyFallbackDisabled ? "yes" : "NO — not a valid gate run"}`);
  L.push("");

  L.push("## Cohort coverage");
  L.push("");
  L.push("| Cohort | Coverage | Referenced | Present | Missing | Unpathed | Errored |");
  L.push("| --- | --- | --- | --- | --- | --- | --- |");
  L.push(segLine("Adults", report.adult));
  L.push(segLine("Minors (all)", report.minor));
  L.push(segLine("Minors · chart-backed guardian", report.minorChartBacked));
  L.push(segLine("Minors · email on file only", report.minorEmailOnFile));
  L.push("");

  L.push(`## Go/no-go gate — ${gate.pass ? "PASS" : "NOT PASSING"}`);
  L.push("");
  L.push(
    `Gate run valid: ${gate.validGateRun ? "yes" : "no — re-run with the legacy uid fallback disabled"}`,
  );
  L.push("");
  L.push("| Check | Result | Detail |");
  L.push("| --- | --- | --- |");
  for (const l of gate.lines) L.push(`| ${l.label} | ${yn(l.pass)} | ${l.detail} |`);
  for (const c of gate.checks) L.push(`| ${c.label} | ${yn(c.pass)} | ${c.detail} |`);
  L.push("");

  L.push("## Read-path smoke");
  L.push("");
  if (!smoke) {
    L.push("Not run in this session — run it from the Artifact Coverage panel before handing this off.");
  } else {
    L.push(
      `- Ran at: ${smoke.ranAt ?? "unknown"} · ${smoke.passed ?? 0}/${smoke.total ?? 0} passed · ${smoke.failed ?? 0} failed · ${smoke.skipped ?? 0} skipped`,
    );
    if (smoke.fixture) {
      L.push(
        `- Fixture patient: \`${smoke.fixture.patientId}\`${includePhi ? ` (uid \`${smoke.fixture.uid}\`)` : ""}`,
      );
    }
    L.push("");
    L.push("| Result | Check | Detail |");
    L.push("| --- | --- | --- |");
    for (const c of smoke.results ?? []) {
      L.push(`| ${c.skipped ? "SKIP" : c.pass ? "PASS" : "FAIL"} | ${c.name} | ${c.detail} |`);
    }
  }
  L.push("");

  L.push("## Suggested next action");
  L.push("");
  if (report.systemicStorageFailure) {
    L.push("Storage was unreadable on this run — no number here is trustworthy. Fix storage access and re-run the audit before anything else.");
  } else if (!report.legacyFallbackDisabled) {
    L.push("This run counted legacy-keyed objects as present. Re-run the strict audit before evaluating the gate.");
  } else if (report.ingestableMissingCount > 0) {
    L.push(`${report.ingestableMissingCount} ingestable artifact(s) are missing (of ${report.missingCount} total misses; the rest are unsigned or deleted in Elation and are excluded). Run the repair sweep, then re-run the audit and confirm the count drops.`);
  } else if (smoke?.failed) {
    L.push("Coverage is clean but the read-path smoke has failures — investigate those checks before widening guardian reads.");
  } else if (gate.pass) {
    L.push("Gate is green on this run. Proceed with the canary guardian step (scoped allowlist first, then widen).");
  } else {
    L.push("Gate is not passing — see the failing lines above; each one names the blocking condition.");
  }
  L.push("");

  if (includePhi && report.misses.length) {
    L.push("## Missing artifacts (PHI — audited export)");
    L.push("");
    L.push("| Patient | Document | Expected path | Cohort | Failures | Parked |");
    L.push("| --- | --- | --- | --- | --- | --- |");
    for (const m of report.misses) {
      L.push(
        `| \`${m.patientId}\` | \`${m.documentId}\` | \`${m.path}\` | ${m.cohort ?? "—"} | ${m.failures} | ${m.parked ? "yes" : "no"} |`,
      );
    }
    L.push("");
  } else if (report.misses.length) {
    L.push(`_${report.misses.length} missing artifact row(s) withheld — patient-level detail is PHI. Re-export with detail included if your agent needs the ids._`);
    L.push("");
  }

  return L.join("\n");
}
