import { useMemo, useState } from "react";
import { AlertTriangle, Download, Loader2, UserPlus } from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import {
  useProvisionPortalRecords,
  type ProvisionMember,
  type ProvisionResult,
} from "@/hooks/usePortalAdmin";
import type { ReconRow } from "@/hooks/useMemberReconciliation";
import { isTestFixture } from "@/lib/portal/fixtures";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/** Matches MAX_PROVISION_BATCH in the portal-admin edge function. */
const MAX_BATCH = 300;

/** Size of the recommended first validation run against production. */
const VALIDATION_BATCH = 5;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Minimum age provisioned while minors wait on Release 2b guardian linking. */
const ADULT_AGE = 18;

/**
 * Age in whole years as of today, computed from the date of birth. Hint's
 * member type ("Child"/"Spouse") is not trustworthy for this — adult
 * dependents appear as "Child" and we have seen a "Spouse" born in 2015.
 */
function ageFromDob(dob: string | null): number | null {
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
function eligibility(row: ReconRow, adultsOnly = false): { ok: boolean; why?: string } {
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


function toCsv(rows: ReconRow[], adultsOnly: boolean): string {
  const head = [
    "name", "email", "dob", "age", "phone", "hint_id", "member_type", "eligible", "reason",
  ];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = rows.map((r) => {
    const e = eligibility(r, adultsOnly);
    return [r.name, r.email, r.dob, ageFromDob(r.dob) ?? "", r.phone, r.hintId, r.memberType, e.ok, e.why ?? ""]
      .map(esc)
      .join(",");
  });

  return [head.join(","), ...lines].join("\n");
}

type Outcome = {
  key: string;
  name: string;
  hintId: string;
  status: "created" | "unresolved" | "skipped";
  detail: string;
};

/**
 * Bulk provisioning of portal roster records for active members who have none.
 *
 * Selection is opt-in: nothing is selected until staff choose rows, so the
 * first production run can be a small validation batch. Creating a record does
 * NOT invite anyone. No email is sent, nothing is written to Elation or Hint,
 * and each member creates its own audit row.
 */
export default function ProvisionMissingDialog({
  open,
  onOpenChange,
  missing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  missing: ReconRow[];
}) {
  const { isAdmin } = useAuth();
  const provision = useProvisionPortalRecords();
  const [reason, setReason] = useState("");
  const [adultsOnly, setAdultsOnly] = useState(true);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<ProvisionResult | null>(null);
  const [submitted, setSubmitted] = useState<ReconRow[]>([]);

  const eligible = useMemo(
    () => missing.filter((r) => eligibility(r, adultsOnly).ok),
    [missing, adultsOnly],
  );
  const ineligible = useMemo(
    () => missing.filter((r) => !eligibility(r, adultsOnly).ok),
    [missing, adultsOnly],
  );
  const minors = useMemo(
    () => missing.filter((r) => eligibility(r, false).ok && !eligibility(r, true).ok),
    [missing],
  );

  const selected = useMemo(
    () => eligible.filter((r) => selectedKeys.has(r.key)),
    [eligible, selectedKeys],
  );
  const overCap = selected.length > MAX_BATCH;

  const outcomes: Outcome[] = useMemo(() => {
    if (!result) return [];
    const createdBy = new Map(result.created.map((c) => [c.hintId, c]));
    const unresolvedBy = new Map(result.unresolved.map((u) => [u.hintId, u]));
    const skippedBy = new Map((result.skipped ?? []).map((s) => [s.hintId, s]));
    return submitted.map((r) => {
      const hintId = r.hintId as string;
      const created = createdBy.get(hintId);
      if (created) {
        return {
          key: r.key,
          name: r.name,
          hintId,
          status: "created" as const,
          detail: created.elationPatientId ? `Elation ${created.elationPatientId}` : "created",
        };
      }
      const unresolved = unresolvedBy.get(hintId);
      if (unresolved) {
        return {
          key: r.key,
          name: r.name,
          hintId,
          status: "unresolved" as const,
          detail: unresolved.reason ?? "no confident Elation match",
        };
      }
      const skipped = skippedBy.get(hintId);
      return {
        key: r.key,
        name: r.name,
        hintId,
        status: "skipped" as const,
        detail: skipped?.reason ?? "already had a portal record",
      };
    });
  }, [result, submitted]);

  function toggle(key: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectFirst(n: number) {
    setSelectedKeys(new Set(eligible.slice(0, n).map((r) => r.key)));
  }

  function downloadCsv() {
    const blob = new Blob([toCsv(missing, adultsOnly)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `members-missing-portal-record-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function submit() {
    if (!isAdmin) return;
    if (reason.trim().length < 3) {
      toast({
        title: "Reason required",
        description: "Note why these records are being created — it is written to the audit log.",
        variant: "destructive",
      });
      return;
    }
    const batch = selected;
    const members: ProvisionMember[] = batch.map((r) => ({
      hintId: r.hintId as string,
      firstName: r.firstName,
      lastName: r.lastName,
      email: r.email,
      dob: r.dob as string,
      phone: r.phone,
    }));

    provision
      .mutateAsync({ members, reason: reason.trim() })
      .then((res) => {
        setSubmitted(batch);
        setResult(res);
        toast({
          title: `${res.created.length} portal record${res.created.length === 1 ? "" : "s"} created`,
          description:
            res.unresolved.length > 0
              ? `${res.unresolved.length} could not be matched to an Elation chart and were skipped.`
              : "No invitations were sent.",
        });
      })
      .catch((e: unknown) => {
        toast({
          title: "Nothing was created",
          description: e instanceof Error ? e.message : String(e),
          variant: "destructive",
        });
      });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setResult(null);
          setSubmitted([]);
          setReason("");
          setSelectedKeys(new Set());
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-serif">Provision missing portal records</DialogTitle>
          <DialogDescription>
            Creates a portal roster record for the members you select. No invitation is sent and
            nothing is written to Elation or Hint — inviting stays a separate, deliberate action.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3 text-sm">
            <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span>
                <span className="font-mono text-lg text-success">{result.created.length}</span>{" "}
                created
              </span>
              <span>
                <span className="font-mono text-lg text-destructive">
                  {outcomes.filter((o) => o.status === "unresolved").length}
                </span>{" "}
                unresolved
              </span>
              <span>
                <span className="font-mono text-lg text-muted-foreground">
                  {outcomes.filter((o) => o.status === "skipped").length}
                </span>{" "}
                skipped
              </span>
            </p>
            <div className="max-h-72 overflow-y-auto rounded-md border">
              <table className="w-full text-xs">
                <tbody>
                  {outcomes.map((o) => (
                    <tr key={o.key} className="border-b last:border-0">
                      <td className="p-2 font-medium">{o.name}</td>
                      <td className="p-2 font-mono text-[10px] text-muted-foreground">
                        {o.hintId}
                      </td>
                      <td className="p-2">
                        <span
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize",
                            o.status === "created"
                              ? "border-success/30 bg-success/15 text-success"
                              : o.status === "unresolved"
                                ? "border-destructive/30 bg-destructive/10 text-destructive"
                                : "border-border bg-muted text-muted-foreground",
                          )}
                        >
                          {o.status}
                        </span>
                      </td>
                      <td className="p-2 text-right text-muted-foreground">{o.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              Review these before running another batch. Unresolved members stay in the list and
              can be re-selected once their Elation chart is sorted out.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>
                <span className="font-mono text-lg">{selected.length}</span> of {eligible.length}{" "}
                eligible members selected
              </span>
              <div className="ml-auto flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => selectFirst(VALIDATION_BATCH)}>
                  First {VALIDATION_BATCH}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedKeys(new Set(eligible.map((r) => r.key)))}
                >
                  Select all
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedKeys(new Set())}
                  disabled={selected.length === 0}
                >
                  Clear
                </Button>
                <Button variant="outline" size="sm" onClick={downloadCsv}>
                  <Download className="mr-1 h-3.5 w-3.5" /> Export list
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/40 p-3">
              <Switch
                id="adults-only"
                checked={adultsOnly}
                onCheckedChange={(v) => {
                  setAdultsOnly(v);
                  setSelectedKeys(new Set());
                }}
                disabled={provision.isPending}
              />
              <label htmlFor="adults-only" className="text-sm font-medium">
                Adults only ({ADULT_AGE}+)
              </label>
              <span className="text-xs text-muted-foreground">
                Age is computed from date of birth as of today — Hint member type is not used.
                {minors.length > 0 &&
                  ` ${minors.length} minor${minors.length === 1 ? "" : "s"} held for Release 2b.`}
              </span>
            </div>


            {selected.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Nothing is selected. Start with a {VALIDATION_BATCH}-member validation batch,
                review the per-member outcome, then provision the rest in batches.
              </p>
            )}

            {overCap && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>
                  A single run is capped at {MAX_BATCH} members so a mistake stays reviewable.
                  Deselect {selected.length - MAX_BATCH} and run the rest afterwards.
                </span>
              </div>
            )}

            {ineligible.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {ineligible.length} member{ineligible.length === 1 ? " is" : "s are"} not
                eligible (missing date of birth, name or Hint id
                {adultsOnly ? ", or under 18" : ""}) and cannot be selected.
              </p>
            )}

            <div className="max-h-72 overflow-y-auto rounded-md border">
              <table className="w-full text-xs">
                <tbody>
                  {missing.map((r) => {
                    const e = eligibility(r, adultsOnly);
                    const on = e.ok && selectedKeys.has(r.key);
                    const age = ageFromDob(r.dob);
                    return (
                      <tr key={r.key} className="border-b last:border-0">
                        <td className="w-8 p-2">
                          <Checkbox
                            checked={on}
                            disabled={!e.ok || !isAdmin || provision.isPending}
                            onCheckedChange={() => toggle(r.key)}
                          />
                        </td>
                        <td className={cn("p-2 font-medium", !e.ok && "text-muted-foreground")}>
                          {r.name}
                        </td>
                        <td className="p-2 text-muted-foreground">{r.email ?? "—"}</td>
                        <td className="p-2 font-mono text-muted-foreground">{r.dob ?? "—"}</td>
                        <td className="p-2 font-mono text-muted-foreground">
                          {age === null ? "—" : `${age}y`}
                        </td>
                        <td className="p-2 text-right text-[10px] uppercase tracking-wide text-muted-foreground">
                          {e.ok ? (r.memberType ?? "") : e.why}
                        </td>

                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="space-y-2">
              <label className="text-xs uppercase tracking-wide text-muted-foreground">
                Reason for change (audited)
              </label>
              <Textarea
                rows={2}
                value={reason}
                onChange={(ev) => setReason(ev.target.value)}
                placeholder="e.g. 5-member validation batch before bulk provisioning"
                disabled={!isAdmin || provision.isPending}
              />
              {!isAdmin && (
                <p className="text-xs text-muted-foreground">
                  View only — an administrator must create portal records.
                </p>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          {result ? (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setResult(null);
                  setSubmitted([]);
                  setSelectedKeys(new Set());
                }}
              >
                Provision another batch
              </Button>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={submit}
                disabled={
                  !isAdmin || provision.isPending || selected.length === 0 || overCap
                }
              >
                {provision.isPending ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <UserPlus className="mr-1 h-3.5 w-3.5" />
                )}
                Provision selected ({selected.length})
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
