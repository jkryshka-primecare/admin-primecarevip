import { useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Download, Loader2, RotateCcw, ShieldAlert } from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { useFirestoreList, type FirestoreDoc } from "@/hooks/useFirestore";
import { useBulkClaimReset, type BulkResetOutcome } from "@/hooks/usePortalAdmin";
import { isFixtureDoc } from "@/lib/portal/fixtures";
import { toast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type StaleRow = {
  elationId: string;
  name: string;
  email: string | null;
  status: string | null;
};

function text(value: unknown): string | null {
  const v = String(value ?? "").trim();
  return v.length ? v : null;
}

/**
 * A claim is stale when the invite link was consumed (a portal login exists)
 * but the member never actually got in: no claim timestamp and no verified
 * sign-in. Same test the single-member triage card uses — kept in one shape so
 * the list and the card can never disagree.
 */
function isStaleClaim(doc: FirestoreDoc): boolean {
  return Boolean(doc.firebaseUid) && !doc.claimedAt && !doc.webAccessVerifiedAt;
}

export default function StaleClaimScreening() {
  const { isAdmin } = useAuth();
  const { docs, loading, error } = useFirestoreList("patients", { fetchAll: true });
  const bulkReset = useBulkClaimReset();

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<BulkResetOutcome[] | null>(null);

  const stale = useMemo<StaleRow[]>(() => {
    return docs
      .filter((doc) => doc.id && !isFixtureDoc(doc) && isStaleClaim(doc))
      .map((doc) => ({
        elationId: String(doc.id),
        name:
          [text(doc.firstName), text(doc.lastName)].filter(Boolean).join(" ") ||
          text(doc.name) ||
          "—",
        email: text(doc.email),
        status: text(doc.status),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [docs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return stale;
    return stale.filter((row) =>
      [row.name, row.email, row.elationId].some((v) => String(v ?? "").toLowerCase().includes(q)),
    );
  }, [stale, search]);

  const withEmail = filtered.filter((row) => row.email);
  const missingEmail = stale.filter((row) => !row.email).length;
  const allSelected = withEmail.length > 0 && withEmail.every((row) => selected.has(row.elationId));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((prev) => {
      if (allSelected) {
        const next = new Set(prev);
        withEmail.forEach((row) => next.delete(row.elationId));
        return next;
      }
      return new Set([...prev, ...withEmail.map((row) => row.elationId)]);
    });

  const targets = stale.filter((row) => selected.has(row.elationId));

  const exportCsv = () => {
    const header = "name,email,elation_id,portal_status";
    const body = stale
      .map((row) =>
        [row.name, row.email ?? "", row.elationId, row.status ?? ""]
          .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
          .join(","),
      )
      .join("\n");
    const url = URL.createObjectURL(new Blob([`${header}\n${body}`], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `stale-portal-claims-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const runBulk = async () => {
    if (!isAdmin) {
      toast({
        title: "Administrator access required",
        description: "Only admins can reset portal claims.",
        variant: "destructive",
      });
      return;
    }
    if (reason.trim().length < 3) {
      toast({
        title: "Reason required",
        description: "Enter a short note; every reset is written to the audit log.",
        variant: "destructive",
      });
      return;
    }
    const ok = window.confirm(
      `Reset ${targets.length} portal ${targets.length === 1 ? "claim" : "claims"}? Each member's half-created login is deleted and a fresh activation link is emailed to them.`,
    );
    if (!ok) return;

    setResults(null);
    setProgress({ done: 0, total: targets.length });
    try {
      const outcomes = await bulkReset.mutateAsync({
        reason,
        targets: targets.map((row) => ({ elationPatientId: row.elationId, name: row.name })),
        onProgress: (done, total) => setProgress({ done, total }),
      });
      setResults(outcomes);
      setSelected(new Set());
      setReason("");
      const failed = outcomes.filter((o) => !o.ok).length;
      toast({
        title: failed
          ? `${outcomes.length - failed} reset, ${failed} failed`
          : `${outcomes.length} ${outcomes.length === 1 ? "claim" : "claims"} reset — new invites sent`,
        variant: failed ? "destructive" : undefined,
      });
    } catch (cause) {
      toast({
        title: "Bulk reset stopped",
        description: cause instanceof Error ? cause.message : String(cause),
        variant: "destructive",
      });
    } finally {
      setProgress(null);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <RotateCcw className="h-4 w-4" />
          Stale claims — members stuck outside the portal
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Their invite link was used, but they never completed a sign-in, so the account is half-created and they
          cannot get in. Resetting removes that shell account and emails a fresh activation link.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Screening the portal roster…
          </div>
        ) : error ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : stale.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-success">
            <CheckCircle2 className="h-4 w-4" /> No stale claims — everyone who claimed an invite has signed in.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="text-[11px]">
                {stale.length} {stale.length === 1 ? "member" : "members"} need a reset
              </Badge>
              {missingEmail > 0 && (
                <Badge variant="outline" className="text-[11px]">
                  {missingEmail} without an email on file
                </Badge>
              )}
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Filter this list…"
                className="h-8 max-w-[240px] text-xs"
                aria-label="Filter stale claims"
              />
              <Button size="sm" variant="outline" className="h-8" onClick={exportCsv}>
                <Download className="mr-1 h-3.5 w-3.5" />
                Export list
              </Button>
            </div>

            <div className="max-h-[420px] overflow-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={toggleAll}
                        disabled={!isAdmin || withEmail.length === 0 || bulkReset.isPending}
                        aria-label="Select all shown"
                      />
                    </TableHead>
                    <TableHead>Member</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Elation ID</TableHead>
                    <TableHead>Portal status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((row) => (
                    <TableRow key={row.elationId}>
                      <TableCell>
                        <Checkbox
                          checked={selected.has(row.elationId)}
                          onCheckedChange={() => toggle(row.elationId)}
                          disabled={!isAdmin || !row.email || bulkReset.isPending}
                          aria-label={`Select ${row.name}`}
                        />
                      </TableCell>
                      <TableCell className="text-xs font-medium">{row.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.email ?? (
                          <span className="inline-flex items-center gap-1 text-destructive">
                            <ShieldAlert className="h-3 w-3" /> no email on file
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-[11px] text-muted-foreground">{row.elationId}</TableCell>
                      <TableCell className="text-xs capitalize text-muted-foreground">{row.status ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Reason for this bulk reset (audited)"
              rows={2}
              disabled={!isAdmin || bulkReset.isPending}
              className="text-xs"
            />

            <div className="flex flex-wrap items-center gap-3">
              <Button
                size="sm"
                variant="destructive"
                disabled={!isAdmin || targets.length === 0 || bulkReset.isPending}
                onClick={runBulk}
              >
                {bulkReset.isPending ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="mr-1 h-3.5 w-3.5" />
                )}
                Reset {targets.length || ""} selected & send new invites
              </Button>
              {progress && (
                <span className="text-xs text-muted-foreground">
                  {progress.done} of {progress.total} processed…
                </span>
              )}
            </div>

            {results && (
              <div className="space-y-1 rounded-md border border-border p-2.5 text-xs">
                <p className="font-medium text-foreground">
                  {results.filter((r) => r.ok).length} reset · {results.filter((r) => !r.ok).length} failed
                </p>
                {results
                  .filter((r) => !r.ok)
                  .map((r) => (
                    <p key={r.elationPatientId} className="text-destructive">
                      {r.name}: {r.error}
                    </p>
                  ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
