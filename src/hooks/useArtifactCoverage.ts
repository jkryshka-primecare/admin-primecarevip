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
  /** Storage probes that FAILED (e.g. 403). "Couldn't check" is not "absent". */
  erroredCount: number;
  errorStatusCounts: Record<string, number>;
  /** True when >= 25% of probes errored: the run refuses to queue repairs. */
  systemicStorageFailure: boolean;
  status: string;
  /** True when the walk hit its per-run cap: the number is partial. */
  truncatedWalk: boolean;
  /**
   * True only when the run executed with `ARTIFACT_LEGACY_UID_FALLBACK`
   * DISABLED. A fallback-ON run counts legacy-path objects as present, so it is
   * NOT a valid gate run and can never be shown as a pass.
   */
  legacyFallbackDisabled: boolean;
  coveragePct: number | null;
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
};

function toSegment(raw: unknown): SegmentCounts {
  const o = (raw ?? {}) as Record<string, unknown>;
  const pct =
    o.coveragePct === undefined || o.coveragePct === null ? null : num(o.coveragePct);
  return {
    referenced: num(o.referenced),
    present: num(o.present),
    missing: num(o.missing),
    unpathed: num(o.unpathed),
    errored: num(o.errored),
    coveragePct: pct,
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

function toReport(doc: FirestoreDoc): CoverageReport {
  const total = num(doc.totalReferenced);
  const present = num(doc.presentCount);
  const missesRaw = Array.isArray(doc.missing) ? doc.missing : [];
  const misses = missesRaw.map(toMiss);
  const unpathedRaw = Array.isArray(doc.unpathed) ? doc.unpathed : [];

  const bySegment = (doc.bySegment ?? {}) as Record<string, unknown>;
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
    adult: bySegment.adult ? toSegment(bySegment.adult) : EMPTY_SEGMENT,
    minor: bySegment.minor ? toSegment(minorRaw) : EMPTY_SEGMENT,
    minorChartBacked: byLinkage.chartBacked ? toSegment(byLinkage.chartBacked) : EMPTY_SEGMENT,
    minorEmailOnFile: byLinkage.emailOnFile ? toSegment(byLinkage.emailOnFile) : EMPTY_SEGMENT,
    misses,
    unpathed: unpathedRaw.map(toUnpathed),
  };
}

/**
 * A segment passes ONLY at 100% over a non-zero denominator. A null
 * coveragePct means nothing was referenced in that bucket — which is exactly
 * how a whole cohort hides inside a rounded overall 100%, so it fails.
 */
export function segmentPasses(s: SegmentCounts): boolean {
  return s.referenced > 0 && s.coveragePct !== null && s.coveragePct >= 100;
}

function lineDetail(s: SegmentCounts): string {
  if (s.referenced === 0) return "Nothing referenced yet — zero denominator is not a pass.";
  if (s.coveragePct === null) return "No coverage figure — storage probes could not be trusted.";
  if (s.coveragePct < 100) return `${s.missing.toLocaleString()} missing in Storage.`;
  return `${s.present.toLocaleString()} of ${s.referenced.toLocaleString()} present.`;
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
  pass: boolean;
};

/** The full go/no-go verdict for flipping GUARDIAN_READS_ENABLED. */
export function evaluateGate(report: CoverageReport): GateVerdict {
  const lines = gateLines(report);
  const checks = [
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
    pass: lines.every((l) => l.pass) && checks.every((c) => c.pass),
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
