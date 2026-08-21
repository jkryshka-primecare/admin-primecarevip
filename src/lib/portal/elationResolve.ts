/**
 * Read-only Elation chart lookup used to fill in a missing Elation patient id
 * for someone we only know from Hint (minors, mostly).
 *
 * Mirrors the server-side resolver in
 * `firebase-handoff/portal-provisioning/functions/core/services/elation/resolvePatient.js`:
 * the match key is first name + last name + DOB, all three required. Email is
 * never a key or a tiebreak — families here share one address. Anything
 * ambiguous comes back unresolved for a human.
 */
import { callElation } from "@/hooks/useElation";

export type ElationResolveOutcome =
  | { status: "resolved"; elationId: string }
  | { status: "no_match" | "ambiguous" | "incomplete" | "error"; reason: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const lower = (v: unknown) => String(v ?? "").trim().toLowerCase();

type ElationPatientLite = {
  id?: number | string;
  first_name?: string;
  last_name?: string;
  dob?: string;
  deleted_date?: string | null;
};

export async function resolveElationId(person: {
  firstName?: string | null;
  lastName?: string | null;
  dob?: string | null;
}): Promise<ElationResolveOutcome> {
  const first = lower(person.firstName);
  const last = lower(person.lastName);
  const dob = String(person.dob ?? "").trim().slice(0, 10);

  if (!first || !last || !ISO_DATE.test(dob)) {
    return { status: "incomplete", reason: "Needs first name, last name and DOB" };
  }

  const res = await callElation<{ results?: ElationPatientLite[] }>("patients", {
    last_name: String(person.lastName ?? "").trim(),
    dob,
    limit: 50,
  });

  if (res.ok === false || (res.status && res.status >= 400)) {
    return { status: "error", reason: res.error ?? `Elation returned ${res.status}` };
  }

  const all = res.data?.results ?? [];
  const candidates = all.filter(
    (p) =>
      p &&
      !p.deleted_date &&
      lower(p.first_name) === first &&
      lower(p.last_name) === last &&
      String(p.dob ?? "").slice(0, 10) === dob,
  );

  if (candidates.length === 0) return { status: "no_match", reason: "No Elation chart found" };
  if (candidates.length > 1) {
    return {
      status: "ambiguous",
      reason: `${candidates.length} charts share this name and DOB`,
    };
  }
  return { status: "resolved", elationId: String(candidates[0].id) };
}

/** Resolve a list serially — Elation rate-limits hard, so no fan-out. */
export async function resolveElationIds<T extends { key: string }>(
  people: (T & { firstName?: string | null; lastName?: string | null; dob?: string | null })[],
  onProgress?: (done: number, total: number) => void,
): Promise<Record<string, ElationResolveOutcome>> {
  const out: Record<string, ElationResolveOutcome> = {};
  let done = 0;
  for (const p of people) {
    out[p.key] = await resolveElationId(p);
    onProgress?.(++done, people.length);
  }
  return out;
}
