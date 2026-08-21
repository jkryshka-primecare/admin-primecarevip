/**
 * Release 2b — dependent (minor) to guardian matching.
 *
 * Minors get no login of their own. A guardian signs in to their own portal
 * account and proxies into the child's record; at 18 the child converts to an
 * independent account and is asked whether to keep sharing with the guardian.
 *
 * This module only *proposes* links. Nothing here writes anywhere: every
 * proposal is reviewed and confirmed by staff before it becomes real, because
 * a wrong guardian link is a PHI disclosure, not a UI bug.
 *
 * Two signals, in priority order (both chosen by the practice):
 *   1. Hint household — same membership (contract) id, guardian is an adult on
 *      that contract. Authoritative: it is the billing relationship.
 *   2. Inferred — shared email + same last name, guardian is an adult. A
 *      heuristic; always requires staff confirmation, never auto-applied.
 */
import type { ReconRow } from "@/hooks/useMemberReconciliation";
import { ADULT_AGE, ageFromDob } from "@/lib/portal/exceptions";
import { isTestFixture, isTestFixtureName } from "@/lib/portal/fixtures";

export type MatchSource = "hint_household" | "inferred_email_name";

export type MatchConfidence =
  | "high" // single adult on the same Hint household
  | "medium" // single adult by shared email + last name
  | "ambiguous" // more than one plausible guardian
  | "none"; // no adult candidate at all

export type GuardianCandidate = {
  row: ReconRow;
  source: MatchSource;
  age: number | null;
  /** Why this person surfaced, in staff-readable words. */
  rationale: string;
};

export type DependentMatch = {
  key: string;
  minor: ReconRow;
  age: number | null;
  confidence: MatchConfidence;
  candidates: GuardianCandidate[];
  /** The candidate to show pre-selected; null when ambiguous or none. */
  suggested: GuardianCandidate | null;
  /** Set when the minor can't be matched at all yet. */
  blocker?: string;
};

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();

const isFixture = (r: ReconRow) =>
  isTestFixture(r.elationId) ||
  isTestFixtureName(r.firstName, r.lastName) ||
  isTestFixtureName(r.name);

/** A person we would be willing to hand a child's chart to. */
function isEligibleGuardian(row: ReconRow, age: number | null): boolean {
  if (age === null || age < ADULT_AGE) return false;
  if (isFixture(row)) return false;
  // The guardian needs a portal identity to proxy from.
  return Boolean(row.elationId);
}

/**
 * Builds one proposal per minor on the roster.
 *
 * `rows` should be the full reconciled roster (members and former members), so
 * a guardian who left the practice but kept portal access still counts.
 */
export function buildDependentMatches(rows: ReconRow[]): DependentMatch[] {
  const withAge = rows.map((row) => ({ row, age: ageFromDob(row.dob) }));

  const byHousehold = new Map<string, typeof withAge>();
  const byEmail = new Map<string, typeof withAge>();
  for (const entry of withAge) {
    const hh = norm(entry.row.membershipId);
    if (hh) {
      if (!byHousehold.has(hh)) byHousehold.set(hh, []);
      byHousehold.get(hh)!.push(entry);
    }
    const email = norm(entry.row.email);
    if (email) {
      if (!byEmail.has(email)) byEmail.set(email, []);
      byEmail.get(email)!.push(entry);
    }
  }

  const out: DependentMatch[] = [];

  for (const { row: minor, age } of withAge) {
    if (isFixture(minor)) continue;
    if (age === null || age >= ADULT_AGE) continue;

    if (!minor.dob) {
      out.push({
        key: minor.key,
        minor,
        age,
        confidence: "none",
        candidates: [],
        suggested: null,
        blocker: "No date of birth — identity can't be confirmed",
      });
      continue;
    }

    const seen = new Set<string>();
    const candidates: GuardianCandidate[] = [];

    const household = norm(minor.membershipId)
      ? byHousehold.get(norm(minor.membershipId)) ?? []
      : [];
    for (const { row, age: gAge } of household) {
      if (row.key === minor.key || seen.has(row.key)) continue;
      if (!isEligibleGuardian(row, gAge)) continue;
      seen.add(row.key);
      candidates.push({
        row,
        age: gAge,
        source: "hint_household",
        rationale: `Adult on the same Hint membership${
          row.memberType ? ` (${row.memberType})` : ""
        }`,
      });
    }

    const shared = norm(minor.email) ? byEmail.get(norm(minor.email)) ?? [] : [];
    for (const { row, age: gAge } of shared) {
      if (row.key === minor.key || seen.has(row.key)) continue;
      if (!isEligibleGuardian(row, gAge)) continue;
      if (norm(row.lastName) !== norm(minor.lastName)) continue;
      seen.add(row.key);
      candidates.push({
        row,
        age: gAge,
        source: "inferred_email_name",
        rationale: "Shares the child's email address and last name",
      });
    }

    // Prefer household evidence; within a source, prefer the oldest adult.
    candidates.sort((a, b) => {
      if (a.source !== b.source) return a.source === "hint_household" ? -1 : 1;
      return (b.age ?? 0) - (a.age ?? 0);
    });

    const householdCandidates = candidates.filter((c) => c.source === "hint_household");
    let confidence: MatchConfidence;
    let suggested: GuardianCandidate | null = null;

    if (householdCandidates.length === 1) {
      confidence = "high";
      suggested = householdCandidates[0];
    } else if (householdCandidates.length > 1) {
      confidence = "ambiguous";
    } else if (candidates.length === 1) {
      confidence = "medium";
      suggested = candidates[0];
    } else if (candidates.length > 1) {
      confidence = "ambiguous";
    } else {
      confidence = "none";
    }

    out.push({
      key: minor.key,
      minor,
      age,
      confidence,
      candidates,
      suggested,
      blocker:
        confidence === "none"
          ? "No adult found on the household or sharing the email"
          : undefined,
    });
  }

  return out.sort((a, b) => {
    const order: MatchConfidence[] = ["ambiguous", "none", "medium", "high"];
    const d = order.indexOf(a.confidence) - order.indexOf(b.confidence);
    return d !== 0 ? d : a.minor.name.localeCompare(b.minor.name);
  });
}

export const CONFIDENCE_LABEL: Record<MatchConfidence, string> = {
  high: "Household match",
  medium: "Inferred — confirm",
  ambiguous: "Needs a decision",
  none: "No guardian found",
};

/** A staff-confirmed link, ready to hand to the portal control plane. */
export type ConfirmedLink = {
  minorKey: string;
  minorName: string;
  minorDob: string | null;
  minorElationId: string | null;
  minorHintId: string | null;
  guardianName: string;
  guardianElationId: string | null;
  guardianHintId: string | null;
  source: MatchSource;
  confirmedAt: string;
};

export function toConfirmedLink(
  match: DependentMatch,
  candidate: GuardianCandidate,
): ConfirmedLink {
  return {
    minorKey: match.key,
    minorName: match.minor.name,
    minorDob: match.minor.dob,
    minorElationId: match.minor.elationId,
    minorHintId: match.minor.hintId,
    guardianName: candidate.row.name,
    guardianElationId: candidate.row.elationId,
    guardianHintId: candidate.row.hintId,
    source: candidate.source,
    confirmedAt: new Date().toISOString(),
  };
}

export function linksToCsv(links: ConfirmedLink[]): string {
  const head = [
    "minor_name",
    "minor_dob",
    "minor_elation_id",
    "minor_hint_id",
    "guardian_name",
    "guardian_elation_id",
    "guardian_hint_id",
    "match_source",
    "confirmed_at",
  ];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [
    head.join(","),
    ...links.map((l) =>
      [
        l.minorName,
        l.minorDob,
        l.minorElationId,
        l.minorHintId,
        l.guardianName,
        l.guardianElationId,
        l.guardianHintId,
        l.source,
        l.confirmedAt,
      ]
        .map(esc)
        .join(","),
    ),
  ].join("\n");
}
