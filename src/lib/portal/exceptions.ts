/**
 * Roster exception lists.
 *
 * Step 6 closes the adult roster gap: every active Hint member should either be
 * provisionable now, or appear on a named exception list with a reason. Nothing
 * here writes anywhere — these are read-only, reviewable, exportable sets.
 */
import type { ReconRow } from "@/hooks/useMemberReconciliation";
import { isTestFixture } from "@/lib/portal/fixtures";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Minimum age provisioned while minors wait on Release 2b guardian linking. */
export const ADULT_AGE = 18;

/**
 * Age in whole years as of today, computed from the date of birth. Hint's
 * member type ("Child"/"Spouse") is not trustworthy for this — adult
 * dependents appear as "Child" and we have seen a "Spouse" born in 2015.
 */
export function ageFromDob(dob: string | null): number | null {
  if (!dob || !ISO_DATE.test(dob)) return null;
  const [y, m, d] = dob.split("-").map(Number);
  const today = new Date();
  let age = today.getFullYear() - y;
  const beforeBirthday =
    today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}

/**
 * Date of birth is the join key this whole system relies on. Without one, a
 * downstream Elation match can't be trusted, so the row is shown but locked.
 */
export function eligibility(
  row: ReconRow,
  adultsOnly = false,
): { ok: boolean; why?: string } {
  if (isTestFixture(row.elationId)) return { ok: false, why: "Smoke-test fixture" };
  if (!row.hintId) return { ok: false, why: "No Hint id" };
  if (!row.dob || !ISO_DATE.test(row.dob)) return { ok: false, why: "No date of birth" };
  if (!row.firstName || !row.lastName) return { ok: false, why: "Incomplete name" };
  if (adultsOnly) {
    const age = ageFromDob(row.dob);
    if (age === null || age < ADULT_AGE) return { ok: false, why: "Minor — holds for 2b" };
  }
  return { ok: true };
}

export type ExceptionListId =
  | "adults_ready"
  | "minors_held"
  | "identity_incomplete"
  | "ambiguous_identity"
  | "portal_no_membership";

export type ExceptionList = {
  id: ExceptionListId;
  label: string;
  description: string;
  /** Blocking lists need a human before anyone can be provisioned. */
  blocking: boolean;
  rows: ReconRow[];
};

const nameDobKey = (r: ReconRow) =>
  `${r.firstName.trim().toLowerCase()}|${r.lastName.trim().toLowerCase()}|${r.dob ?? ""}`;

/**
 * Split the reconciled roster into the lists we publish alongside a
 * provisioning run. `missing` is the member_no_portal set; `allRows` is the
 * full roster (used for the lapsed-portal list and duplicate detection).
 */
export function buildExceptionLists(
  missing: ReconRow[],
  allRows: ReconRow[],
): ExceptionList[] {
  // Same first + last + DOB across two members means the Elation resolver will
  // return AMBIGUOUS_MATCH and write nothing — surface them before the run.
  const seen = new Map<string, ReconRow[]>();
  for (const r of missing) {
    if (!r.dob) continue;
    const k = nameDobKey(r);
    seen.set(k, [...(seen.get(k) ?? []), r]);
  }
  const ambiguousKeys = new Set(
    [...seen.entries()].filter(([, v]) => v.length > 1).map(([k]) => k),
  );

  const adults: ReconRow[] = [];
  const minors: ReconRow[] = [];
  const incomplete: ReconRow[] = [];
  const ambiguous: ReconRow[] = [];

  for (const r of missing) {
    if (isTestFixture(r.elationId)) continue;
    const identity = eligibility(r, false);
    if (!identity.ok) {
      incomplete.push(r);
      continue;
    }
    if (ambiguousKeys.has(nameDobKey(r))) {
      ambiguous.push(r);
      continue;
    }
    const age = ageFromDob(r.dob);
    if (age === null || age < ADULT_AGE) minors.push(r);
    else adults.push(r);
  }

  const lapsed = allRows.filter((r) => r.bucket === "portal_no_membership");

  return [
    {
      id: "adults_ready",
      label: "Adults ready to provision",
      description:
        "Active members, 18+, with a complete identity and no portal record. This is the set the provisioning dialog acts on.",
      blocking: false,
      rows: adults,
    },
    {
      id: "minors_held",
      label: "Minors held for 2b",
      description:
        "Under 18 by date of birth. Held until guardian linking ships — never provisioned in this release.",
      blocking: false,
      rows: minors,
    },
    {
      id: "identity_incomplete",
      label: "Identity incomplete",
      description:
        "Missing a date of birth or a full name in Hint, so no Elation chart can be matched confidently. Fix in Hint, then re-run.",
      blocking: true,
      rows: incomplete,
    },
    {
      id: "ambiguous_identity",
      label: "Ambiguous identity",
      description:
        "Two or more members share the same first name, last name and date of birth. The Elation resolver returns AMBIGUOUS_MATCH and writes nothing — resolve by hand.",
      blocking: true,
      rows: ambiguous,
    },
    {
      id: "portal_no_membership",
      label: "Portal record, no active membership",
      description:
        "Has a portal record but no active Hint membership — lapsed or ended. Review for access removal; nothing is changed automatically.",
      blocking: false,
      rows: lapsed,
    },
  ];
}

const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export function exceptionsToCsv(lists: ExceptionList[]): string {
  const head = [
    "list",
    "name",
    "first_name",
    "last_name",
    "email",
    "dob",
    "age",
    "phone",
    "hint_id",
    "elation_id",
    "member_type",
    "membership_status",
    "portal_status",
  ];
  const lines: string[] = [];
  for (const list of lists) {
    for (const r of list.rows) {
      lines.push(
        [
          list.label,
          r.name,
          r.firstName,
          r.lastName,
          r.email,
          r.dob,
          ageFromDob(r.dob) ?? "",
          r.phone,
          r.hintId,
          r.elationId,
          r.memberType,
          r.membershipStatus,
          r.portalStatus,
        ]
          .map(esc)
          .join(","),
      );
    }
  }
  return [head.join(","), ...lines].join("\n");
}

export function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
