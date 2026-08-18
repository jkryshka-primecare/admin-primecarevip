import { useMemo } from "react";
import { useFirestoreList, type FirestoreDoc } from "@/hooks/useFirestore";

/**
 * Release 2a — artifact coverage.
 *
 * READ-ONLY view of the nightly audit report written by the Firebase job
 * `auditArtifactCoverage`. The job proves one thing only: every document
 * reference marked `hasArtifact: true` has a real object in Storage — i.e. no
 * dangling 404s. It does NOT prove we hold everything Elation has; that is the
 * Elation-exit question and belongs to Release 2b.
 *
 * The report contains patient ids, document ids and storage paths. It is PHI:
 * it is read through the staff-gated `firestore-bridge`, and every read (including
 * a CSV export, which re-reads the report) is written to `phi_access_log`.
 */

export type CoverageMiss = {
  patientId: string;
  documentId: string;
  path: string;
  firstSeenAt: string | null;
  failures: number;
  parked: boolean;
};

export type CoverageReport = {
  runId: string;
  generatedAt: string | null;
  totalReferenced: number;
  presentCount: number;
  missingCount: number;
  parkedCount: number;
  /** Referenced docs with no artifactPath and no firebaseUid — cannot be keyed yet. */
  unpathedCount: number;
  /** True when the walk hit its per-run cap: the number is partial, not complete. */
  truncatedWalk: boolean;
  coveragePct: number | null;
  misses: CoverageMiss[];
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function toMiss(raw: unknown): CoverageMiss {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    patientId: String(o.patientId ?? o.internalPatientId ?? ""),
    documentId: String(o.documentId ?? o.docId ?? ""),
    path: String(o.path ?? o.expectedPath ?? ""),
    firstSeenAt: o.firstSeenAt ? String(o.firstSeenAt) : null,
    failures: num(o.failures),
    parked: o.parked === true,
  };
}

function toReport(doc: FirestoreDoc): CoverageReport {
  const total = num(doc.totalReferenced);
  const present = num(doc.presentCount);
  const missesRaw = Array.isArray(doc.missing) ? doc.missing : [];
  const misses = missesRaw.map(toMiss);
  return {
    runId: String(doc.id ?? ""),
    generatedAt: doc.generatedAt ? String(doc.generatedAt) : (doc._updateTime as string) ?? null,
    totalReferenced: total,
    presentCount: present,
    missingCount: doc.missingCount !== undefined ? num(doc.missingCount) : misses.length,
    parkedCount: misses.filter((m) => m.parked).length,
    unpathedCount: num(doc.unpathedCount),
    truncatedWalk: doc.truncatedWalk === true,
    // The job reports coveragePct over the checked (pathed) set; fall back to
    // the same denominator rather than silently counting unpathed docs.
    coveragePct:
      doc.coveragePct !== undefined && doc.coveragePct !== null
        ? num(doc.coveragePct)
        : total > 0
          ? (present / total) * 100
          : null,
    misses,
  };
}

/** Latest nightly report. Sorted client-side so no Firestore index is required. */
export function useArtifactCoverage(enabled = true) {
  const list = useFirestoreList(
    "artifact_coverage_reports",
    { limit: 30 },
    enabled,
  );

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
  const head = ["patient_id", "document_id", "expected_path", "first_seen_at", "failures", "parked"];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [
    head.join(","),
    ...misses.map((m) =>
      [m.patientId, m.documentId, m.path, m.firstSeenAt ?? "", m.failures, m.parked].map(esc).join(","),
    ),
  ].join("\n");
}
