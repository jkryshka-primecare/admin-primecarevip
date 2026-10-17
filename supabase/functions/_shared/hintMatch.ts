// Pure matching rule for billing: only bill a Hint patient when exactly one
// candidate matches exact first name + last name + date of birth. Never guess.
export type HintPatientLike = Record<string, unknown>;

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");

export function splitPatientName(fullName: unknown) {
  const parts = String(fullName ?? "").trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || "", lastName: parts.slice(1).join(" ") || "" };
}

export type MatchResult =
  | { kind: "match"; patient: HintPatientLike }
  | { kind: "none" }
  | { kind: "ambiguous"; count: number };

export function selectExactHintPatient(
  candidates: HintPatientLike[],
  fullName: unknown,
  dob: unknown,
): MatchResult {
  const { firstName, lastName } = splitPatientName(fullName);
  const d = String(dob ?? "").trim();
  if (!firstName || !lastName || !d) return { kind: "none" };
  const hits = candidates.filter(
    (p) =>
      norm(p.first_name) === norm(firstName) &&
      norm(p.last_name) === norm(lastName) &&
      String(p.date_of_birth ?? "").slice(0, 10) === d.slice(0, 10),
  );
  if (hits.length === 1) return { kind: "match", patient: hits[0] };
  if (hits.length === 0) return { kind: "none" };
  return { kind: "ambiguous", count: hits.length };
}
