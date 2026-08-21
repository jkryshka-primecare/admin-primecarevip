import { useMemo } from "react";
import { useHintRoster, type HintMember } from "@/hooks/useHintRoster";
import { useFirestoreList, type FirestoreDoc } from "@/hooks/useFirestore";
import { isTestFixture } from "@/lib/portal/fixtures";

/**
 * READ-ONLY reconciliation between the Hint membership roster (source of truth
 * for "who is a member") and the member-app portal roster in Firestore.
 *
 * Hint patients carry no Elation id, and the Firestore doc id *is* the Elation
 * patient id — so the two are matched on email + date of birth, falling back to
 * name + date of birth. Families share an email in this practice, which is why
 * date of birth is always part of the key.
 */

export type ReconBucket =
  | "member_active" // active member, portal claimed
  | "member_invited" // active member, invited but not claimed
  | "member_no_portal" // active member with no portal record at all
  | "portal_no_membership"; // portal record with no active membership

export type ReconRow = {
  key: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  dob: string | null;
  hintId: string | null;
  elationId: string | null;
  membershipStatus: string;
  portalStatus: string | null;
  memberType: string | null;
  bucket: ReconBucket;
};

export const BUCKET_LABELS: Record<ReconBucket, string> = {
  member_active: "Member · portal active",
  member_invited: "Member · invited",
  member_no_portal: "Member · no portal record",
  portal_no_membership: "Former member · access retained",
};

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();

const emailDobKey = (email: unknown, dob: unknown) => `e:${norm(email)}|${norm(dob)}`;
const nameDobKey = (first: unknown, last: unknown, dob: unknown) =>
  `n:${norm(first)}|${norm(last)}|${norm(dob)}`;

function portalName(doc: FirestoreDoc): string {
  const first = String(doc.firstName ?? "").trim();
  const last = String(doc.lastName ?? "").trim();
  const full = `${first} ${last}`.trim();
  return full || String(doc.name ?? "") || "—";
}

function bucketForMember(member: HintMember, portal: FirestoreDoc | null): ReconBucket {
  if (!portal) return "member_no_portal";
  return norm(portal.status) === "active" ? "member_active" : "member_invited";
}

export function useMemberReconciliation(enabled = true) {
  const hint = useHintRoster(enabled);
  const firestore = useFirestoreList("patients", { fetchAll: true }, enabled);

  const rows = useMemo<ReconRow[]>(() => {
    if (!hint.members.length && !firestore.docs.length) return [];

    // Index the portal roster on both join keys.
    const byEmailDob = new Map<string, FirestoreDoc>();
    const byNameDob = new Map<string, FirestoreDoc>();
    for (const doc of firestore.docs) {
      byEmailDob.set(emailDobKey(doc.email, doc.dob), doc);
      byNameDob.set(nameDobKey(doc.firstName, doc.lastName, doc.dob), doc);
    }

    const out: ReconRow[] = [];
    const claimed = new Set<string>();

    // Every Hint member with an active membership is a member, portal or not.
    for (const m of hint.members) {
      if (m.membershipStatus !== "active") continue;

      const portal =
        byEmailDob.get(emailDobKey(m.email, m.dob)) ??
        byNameDob.get(nameDobKey(m.firstName, m.lastName, m.dob)) ??
        null;
      if (portal?.id) claimed.add(String(portal.id));

      out.push({
        key: `hint:${m.hintId}`,
        name: m.name,
        firstName: m.firstName,
        lastName: m.lastName,
        email: m.email,
        phone: m.phone,
        dob: m.dob,
        hintId: m.hintId,
        elationId: portal?.id ? String(portal.id) : null,
        membershipStatus: m.membershipStatus,
        portalStatus: portal ? String(portal.status ?? "unknown") : null,
        memberType: m.memberType,
        bucket: bucketForMember(m, portal),
      });
    }

    // Portal records left over: they have an app account but no active membership.
    for (const doc of firestore.docs) {
      const id = String(doc.id ?? "");
      if (!id || claimed.has(id)) continue;
      out.push({
        key: `portal:${id}`,
        name: portalName(doc),
        firstName: String(doc.firstName ?? ""),
        lastName: String(doc.lastName ?? ""),
        email: doc.email ? String(doc.email) : null,
        phone: doc.phone ? String(doc.phone) : null,
        dob: doc.dob ? String(doc.dob) : null,
        hintId: null,
        elationId: id,
        membershipStatus: "none",
        portalStatus: String(doc.status ?? "unknown"),
        memberType: null,
        bucket: "portal_no_membership",
      });
    }

    // Smoke-test fixtures are real documents in production. They must never
    // appear in a count that a bulk write is sized against.
    return out
      .filter((r) => !isTestFixture(r.elationId))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [hint.members, firestore.docs]);

  const counts = useMemo(() => {
    const c: Record<ReconBucket, number> = {
      member_active: 0,
      member_invited: 0,
      member_no_portal: 0,
      portal_no_membership: 0,
    };
    for (const r of rows) c[r.bucket] += 1;
    return c;
  }, [rows]);

  /**
   * The exact, reviewable set of active members with no portal record — the
   * only rows a bulk provision may ever act on. Fixtures are already gone.
   */
  const missingMembers = useMemo(
    () => rows.filter((r) => r.bucket === "member_no_portal" && r.hintId),
    [rows],
  );

  const totals = useMemo(() => {
    const activeMembers =
      counts.member_active + counts.member_invited + counts.member_no_portal;
    const fixtures = firestore.docs.filter((d) => isTestFixture(d.id)).length;
    return {
      activeMembers,
      withPortal: counts.member_active + counts.member_invited,
      hintPatients: hint.members.length,
      portalRecords: firestore.docs.length - fixtures,
      fixturesExcluded: fixtures,
    };
  }, [counts, hint.members.length, firestore.docs]);

  return {
    rows,
    counts,
    totals,
    missingMembers,
    loading: hint.loading || firestore.loading,
    fetching: hint.fetching || firestore.fetching,
    error: hint.error ?? firestore.error,
    refetch: () => {
      hint.refetch();
      firestore.refetch();
    },
  };
}
