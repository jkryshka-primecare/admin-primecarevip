import { useMemo } from "react";
import { useFirestoreList, type FirestoreDoc } from "@/hooks/useFirestore";

/**
 * Release 2a/2b — artifact coverage.
 *
 * READ-ONLY view of the nightly audit report written by the Firebase job
 * `auditArtifactCoverage`. The job proves one thing only: every document
 * reference marked `hasArtifact: true` has a real object in Storage — i.e. no
 * dangling 404s. It does NOT prove we hold everything Elation has; that is the
 * Elation-exit question.
 *
 * Release 2b Part B adds per-cohort splits (`bySegment.adult` /
 * `bySegment.minor`) and, inside the minor cohort, a linkage sub-split
 * (`byLinkage.chartBacked` / `.emailOnFile`). The join gate for flipping
 * `GUARDIAN_READS_ENABLED` reads those lines, never the rounded overall
 * number: a `null` coveragePct (zero denominator) is NOT a pass.
 *
 * The report contains patient ids, document ids and storage paths. It is PHI:
 * it is read through the staff-gated `firestore-bridge`, and every read
 * (including a CSV export, which re-reads the report) is written to
 * `phi_access_log`.
 */

export type CoverageMiss = {
  patientId: string;
  documentId: string;
  path: string;
  firstSeenAt: string | null;
  failures: number;
  parked: boolean;
  cohort: "adult" | "minor" | null;
  chartBacked: boolean | null;
};

export type CoverageUnpathed = {
  patientId: string;
  documentId: string;
  cohort: "adult" | "minor" | null;
  chartBacked: boolean | null;
  reason: string;
};

/** One counted bucket as written by the audit job. */
export type SegmentCounts = {
  referenced: number;
  present: number;
  missing: number;
  unpathed: number;
  errored: number;
  coveragePct: number | null;
  /** Misses that SHOULD have bytes — the only ones the gate counts. */
  ingestableMissing: number;
  /** Machine-excluded misses (unsigned / deleted upstream / still in grace). */
  excluded: number;
  /** present + ingestableMissing. Zero is never a pass. */
  ingestableDenominator: number;
  /** THE gate number for this cohort. */
  ingestableCoveragePct: number | null;
};

/** Named residual buckets (D-307), so the number is a list, not a mystery. */
export type ReasonCounts = {
  unsigned: number;
  deletedInElation: number;
  pendingSweep: number;
  ingestable: number;
};

/** The explicit exit criterion for residual monitoring. */
export type Convergence = {
  windowRuns: number;
  residualSeries: number[];
  erroredSeries: number[];
  nonIncreasing: boolean;
  erroredClean: boolean;
  sweptWithinCycle: boolean;
  converged: boolean;
};

export type CoverageReport = {
  runId: string;
  generatedAt: string | null;
  totalReferenced: number;
  presentCount: number;
  missingCount: number;
  parkedCount: number;
  /** Referenced docs that cannot be keyed yet — excluded from the percentage. */
  unpathedCount: number;
  /** Read-path smoke fixtures, excluded from every other count. */
  fixtureExcludedCount: number;
  /** Storage probes that FAILED (e.g. 403). "Couldn't check" is not "absent". */
  erroredCount: number;
  errorStatusCounts: Record<string, number>;
  /** True when >= 25% of probes errored: the run refuses to queue repairs. */
  systemicStorageFailure: boolean;
  status: string;
  /** True when the walk hit its per-run cap: the number is partial. */
  truncatedWalk: boolean;
  /**
   * Always true from the strict audit: the run evaluates ONLY the internalUid
   * path and never counts a legacy-keyed object as present. Older reports
   * (produced when the audit honoured the env flag) may still be false.
   */
  legacyFallbackDisabled: boolean;

  coveragePct: number | null;
  /** Coverage over the ingestable denominator — what the gate reads. */
  ingestableCoveragePct: number | null;
  ingestableDenominator: number;
  ingestableMissingCount: number;
  excludedCount: number;
  byReason: ReasonCounts;
  /** D-111 decay metric: unclaimed patients still owed artifact work. */
  unclaimedWithPendingReports: number;
  convergence: Convergence | null;
  adult: SegmentCounts;
  minor: SegmentCounts;
  minorChartBacked: SegmentCounts;
  minorEmailOnFile: SegmentCounts;
  misses: CoverageMiss[];
  unpathed: CoverageUnpathed[];
};

/** A single line of the go/no-go gate. */
export type GateLine = {
  key: string;
  label: string;
  counts: SegmentCounts;
  pass: boolean;
  /** Why it is not a pass, in words a non-engineer can act on. */
  detail: string;
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const EMPTY_SEGMENT: SegmentCounts = {
  referenced: 0,
  present: 0,
  missing: 0,
  unpathed: 0,
  errored: 0,
  coveragePct: null,
  ingestableMissing: 0,
  excluded: 0,
  ingestableDenominator: 0,
  ingestableCoveragePct: null,
};

function toSegment(raw: unknown): SegmentCounts {
  const o = (raw ?? {}) as Record<string, unknown>;
  const pct =
    o.coveragePct === undefined || o.coveragePct === null ? null : num(o.coveragePct);
  const ipct =
    o.ingestableCoveragePct === undefined || o.ingestableCoveragePct === null
      ? null
      : num(o.ingestableCoveragePct);
  return {
    referenced: num(o.referenced),
    present: num(o.present),
    missing: num(o.missing),
    unpathed: num(o.unpathed),
    errored: num(o.errored),
    coveragePct: pct,
    ingestableMissing: num(o.ingestableMissing),
    excluded: num(o.excluded),
    ingestableDenominator: num(o.ingestableDenominator),
    ingestableCoveragePct: ipct,
  };
}

const toCohort = (v: unknown): "adult" | "minor" | null =>
  v === "adult" || v === "minor" ? v : null;

function toMiss(raw: unknown): CoverageMiss {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    patientId: String(o.patientId ?? o.internalPatientId ?? ""),
    documentId: String(o.documentId ?? o.docId ?? ""),
    path: String(o.path ?? o.expectedPath ?? ""),
    firstSeenAt: o.firstSeenAt ? String(o.firstSeenAt) : null,
    failures: num(o.failures),
    parked: o.parked === true,
    cohort: toCohort(o.cohort),
    chartBacked: o.chartBacked === undefined ? null : o.chartBacked === true,
  };
}

function toUnpathed(raw: unknown): CoverageUnpathed {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    patientId: String(o.patientId ?? ""),
    documentId: String(o.documentId ?? ""),
    cohort: toCohort(o.cohort),
    chartBacked: o.chartBacked === undefined ? null : o.chartBacked === true,
    reason: String(o.reason ?? "no storage key"),
  };
}

function toConvergence(raw: unknown): Convergence {
  const o = (raw ?? {}) as Record<string, unknown>;
  const series = (v: unknown) => (Array.isArray(v) ? v.map(num) : []);
  return {
    windowRuns: num(o.windowRuns),
    residualSeries: series(o.residualSeries),
    erroredSeries: series(o.erroredSeries),
    nonIncreasing: o.nonIncreasing === true,
    erroredClean: o.erroredClean === true,
    sweptWithinCycle: o.sweptWithinCycle === true,
    converged: o.converged === true,
  };
}

function toReport(doc: FirestoreDoc): CoverageReport {
  const total = num(doc.totalReferenced);
  const present = num(doc.presentCount);
  const missesRaw = Array.isArray(doc.missing) ? doc.missing : [];
  const misses = missesRaw.map(toMiss);
  const unpathedRaw = Array.isArray(doc.unpathed) ? doc.unpathed : [];

  const bySegment = (doc.bySegment ?? {}) as Record<string, unknown>;
  const reason = (doc.byReason ?? {}) as Record<string, unknown>;
  const minorRaw = (bySegment.minor ?? {}) as Record<string, unknown>;
  const byLinkage = (minorRaw.byLinkage ?? {}) as Record<string, unknown>;

  return {
    runId: String(doc.id ?? ""),
    generatedAt: doc.generatedAt ? String(doc.generatedAt) : ((doc._updateTime as string) ?? null),
    totalReferenced: total,
    presentCount: present,
    missingCount: doc.missingCount !== undefined ? num(doc.missingCount) : misses.length,
    parkedCount: misses.filter((m) => m.parked).length,
    unpathedCount: num(doc.unpathedCount),
    fixtureExcludedCount: num(doc.fixtureExcludedCount),
    erroredCount: num(doc.erroredCount),
    errorStatusCounts: (doc.errorStatusCounts ?? {}) as Record<string, number>,
    systemicStorageFailure: doc.systemicStorageFailure === true,
    status: String(doc.status ?? "ok"),
    truncatedWalk: doc.truncatedWalk === true,
    // Absent on reports written before the flag existed — those predate the
    // gate and must not be trusted as fallback-off runs.
    legacyFallbackDisabled: doc.legacyFallbackDisabled === true,
    coveragePct:
      doc.coveragePct !== undefined && doc.coveragePct !== null
        ? num(doc.coveragePct)
        : total > 0
          ? (present / total) * 100
          : null,
    ingestableCoveragePct:
      doc.ingestableCoveragePct === undefined || doc.ingestableCoveragePct === null
        ? null
        : num(doc.ingestableCoveragePct),
    ingestableDenominator: num(doc.ingestableDenominator),
    ingestableMissingCount: num(doc.ingestableMissingCount),
    excludedCount: num(doc.excludedCount),
    byReason: {
      unsigned: num(reason.unsigned),
      deletedInElation: num(reason.deletedInElation),
      pendingSweep: num(reason.pendingSweep),
      ingestable: num(reason.ingestable),
    },
    unclaimedWithPendingReports: num(doc.unclaimedWithPendingReports),
    convergence: doc.convergence ? toConvergence(doc.convergence) : null,
    adult: bySegment.adult ? toSegment(bySegment.adult) : EMPTY_SEGMENT,
    minor: bySegment.minor ? toSegment(minorRaw) : EMPTY_SEGMENT,
    minorChartBacked: byLinkage.chartBacked ? toSegment(byLinkage.chartBacked) : EMPTY_SEGMENT,
    minorEmailOnFile: byLinkage.emailOnFile ? toSegment(byLinkage.emailOnFile) : EMPTY_SEGMENT,
    misses,
    unpathed: unpathedRaw.map(toUnpathed),
  };
}

/**
 * D-307 — a segment passes at 100% of INGESTABLE over a non-zero ingestable
 * denominator. Documents that can never become an object (unsigned per D-079,
 * deleted in Elation) leave the denominator; documents inside the sweep's first
 * cycle are held out only for that cycle. A null figure — nothing ingestable
 * counted — is NOT a pass: that is exactly how a cohort hides inside a rounded
 * 100%.
 */
export function segmentPasses(s: SegmentCounts): boolean {
  return (
    s.ingestableDenominator > 0 &&
    s.ingestableCoveragePct !== null &&
    s.ingestableCoveragePct >= 100
  );
}

function lineDetail(s: SegmentCounts): string {
  if (s.ingestableDenominator === 0)
    return "Nothing ingestable counted — a zero denominator is not a pass.";
  if (s.ingestableCoveragePct === null)
    return "No coverage figure — storage probes could not be trusted.";
  const tail = s.excluded > 0 ? ` (${s.excluded.toLocaleString()} not ingestable, excluded)` : "";
  if (s.ingestableCoveragePct < 100)
    return `${s.ingestableMissing.toLocaleString()} ingestable documents missing in Storage${tail}.`;
  return `${s.present.toLocaleString()} of ${s.ingestableDenominator.toLocaleString()} present${tail}.`;
}

/** The four cohort lines the Part B join gate reads. */
export function gateLines(report: CoverageReport): GateLine[] {
  const defs: { key: string; label: string; counts: SegmentCounts }[] = [
    { key: "adult", label: "Adults", counts: report.adult },
    { key: "minor", label: "Minors (all)", counts: report.minor },
    {
      key: "minor-chart",
      label: "Minors · chart-backed guardian",
      counts: report.minorChartBacked,
    },
    {
      key: "minor-email",
      label: "Minors · email on file only",
      counts: report.minorEmailOnFile,
    },
  ];
  return defs.map((d) => ({
    ...d,
    pass: segmentPasses(d.counts),
    detail: lineDetail(d.counts),
  }));
}

export type GateVerdict = {
  lines: GateLine[];
  /** Run-level conditions that must also hold. */
  checks: { key: string; label: string; pass: boolean; detail: string }[];
  /**
   * False when the run cannot be used to decide anything — today that means a
   * run with the legacy uid fallback still ON, which counts legacy-path objects
   * as present and would otherwise render a false green.
   */
  validGateRun: boolean;
  pass: boolean;
};

/** The full go/no-go verdict for flipping GUARDIAN_READS_ENABLED. */
export function evaluateGate(report: CoverageReport): GateVerdict {
  const lines = gateLines(report);
  const validGateRun = report.legacyFallbackDisabled;
  const checks = [
    {
      key: "legacy-fallback",
      label: "Legacy uid fallback disabled",
      pass: validGateRun,
      detail: validGateRun
        ? "Run probed uid-keyed paths only."
        : "Fallback was ON (or unrecorded) — legacy-path objects counted as present. Re-run with the fallback disabled to evaluate the gate.",
    },
    {
      key: "converged",
      label: "Residual converged",
      pass: report.convergence?.converged === true,
      detail: report.convergence
        ? report.convergence.converged
          ? `Residual ${report.convergence.residualSeries.join(" → ")} across ${report.convergence.windowRuns} runs, no failed probes.`
          : `Residual ${report.convergence.residualSeries.join(" → ")} — needs 3 consecutive non-increasing runs with zero failed probes.`
        : "This run predates the convergence signal.",
    },
    {
      key: "unpathed",
      label: "No unpathed references",
      pass: report.unpathedCount === 0,
      detail: `${report.unpathedCount.toLocaleString()} references have no storage key.`,
    },
    {
      key: "errored",
      label: "No failed storage probes",
      pass: report.erroredCount === 0,
      detail: `${report.erroredCount.toLocaleString()} probes could not be checked.`,
    },
    {
      key: "walk",
      label: "Complete walk",
      pass: !report.truncatedWalk,
      detail: report.truncatedWalk ? "The run hit its per-run cap — partial." : "Full walk.",
    },
    {
      key: "storage",
      label: "Storage readable",
      pass: !report.systemicStorageFailure && report.status === "ok",
      detail: report.systemicStorageFailure
        ? "Systemic storage failure — repairs were refused."
        : `status: ${report.status}`,
    },
  ];
  return {
    lines,
    checks,
    validGateRun,
    pass: validGateRun && lines.every((l) => l.pass) && checks.every((c) => c.pass),
  };
}

/** Latest nightly report. Sorted client-side so no Firestore index is required. */
export function useArtifactCoverage(enabled = true) {
  const list = useFirestoreList("artifact_coverage_reports", { limit: 30 }, enabled);

  const report = useMemo<CoverageReport | null>(() => {
    if (!list.docs.length) return null;
    const sorted = [...list.docs].sort((a, b) =>
      String(b.generatedAt ?? b._updateTime ?? "").localeCompare(
        String(a.generatedAt ?? a._updateTime ?? ""),
      ),
    );
    return toReport(sorted[0]);
  }, [list.docs]);

  return {
    report,
    loading: list.loading,
    fetching: list.fetching,
    error: list.error,
    /** Re-reads through the bridge, which writes a fresh PHI audit row. */
    refetch: list.refetch,
  };
}

export function missesToCsv(misses: CoverageMiss[]): string {
  const head = [
    "patient_id",
    "document_id",
    "expected_path",
    "cohort",
    "chart_backed",
    "first_seen_at",
    "failures",
    "parked",
  ];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [
    head.join(","),
    ...misses.map((m) =>
      [
        m.patientId,
        m.documentId,
        m.path,
        m.cohort ?? "",
        m.chartBacked === null ? "" : m.chartBacked,
        m.firstSeenAt ?? "",
        m.failures,
        m.parked,
      ]
        .map(esc)
        .join(","),
    ),
  ].join("\n");
}
