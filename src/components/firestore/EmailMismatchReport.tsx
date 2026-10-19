import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Loader2, MailWarning, RefreshCw } from "lucide-react";
import type { ReconRow } from "@/hooks/useMemberReconciliation";
import { applyEmailFromChart, checkEmailAgainstChart } from "@/hooks/usePortalAdmin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

type Mismatch = { elationId: string; name: string; portal: string | null; chart: string | null };

const CONCURRENCY = 3;

/**
 * Look-only report: every unclaimed or active portal member whose portal email
 * differs from their Elation chart. Matched by patient ID; never by email.
 * Runs on demand because each member costs one chart read.
 */
export default function EmailMismatchReport({ rows }: { rows: ReconRow[] }) {
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [failed, setFailed] = useState(0);
  const [mismatches, setMismatches] = useState<Mismatch[] | null>(null);
  const [fixing, setFixing] = useState<string | null>(null);

  const targets = rows.filter(
    (r) => r.elationId && (r.bucket === "member_active" || r.bucket === "member_invited"),
  );

  const run = async () => {
    setRunning(true);
    setDone(0);
    setFailed(0);
    setTotal(targets.length);
    const found: Mismatch[] = [];
    let i = 0;
    const worker = async () => {
      while (i < targets.length) {
        const r = targets[i++];
        try {
          const c = await checkEmailAgainstChart(r.elationId as string);
          if (c.changed) {
            found.push({ elationId: r.elationId as string, name: r.name, portal: c.rosterEmail, chart: c.chartEmail });
            setMismatches([...found]);
          }
        } catch {
          setFailed((f) => f + 1);
        }
        setDone((d) => d + 1);
      }
    };
    setMismatches([]);
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    setRunning(false);
  };

  const fix = async (m: Mismatch) => {
    if (!window.confirm(`Update ${m.name}'s portal email?\n\n${m.portal ?? "(none)"} → ${m.chart}\n\nThis does not send an invite.`)) return;
    setFixing(m.elationId);
    try {
      await applyEmailFromChart(m.elationId, "Portal email did not match chart (mismatch report)");
      setMismatches((prev) => (prev ?? []).filter((x) => x.elationId !== m.elationId));
      qc.invalidateQueries({ queryKey: ["portal-admin"] });
      toast({ title: `Email updated for ${m.name}` });
    } catch (e) {
      toast({ title: "Could not update email", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setFixing(null);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex flex-wrap items-center gap-2">
          <MailWarning className="h-4 w-4" />
          Portal emails that don't match the chart
          <Button size="sm" variant="outline" className="ml-auto" onClick={run} disabled={running || targets.length === 0}>
            {running ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
            {running ? `Checking ${done}/${total}` : `Check ${targets.length} members`}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {mismatches === null ? (
          <p className="text-xs text-muted-foreground">
            Compares each member's portal email with their Elation chart. Looking changes nothing.
          </p>
        ) : mismatches.length === 0 && !running ? (
          <p className="text-xs text-muted-foreground">All checked emails match the chart.</p>
        ) : (
          mismatches.map((m) => (
            <div key={m.elationId} className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-xs">
              <span className="font-medium">{m.name}</span>
              <span className="text-destructive line-through">{m.portal ?? "(none)"}</span>
              <span>→ {m.chart ?? "(none)"}</span>
              <Button size="sm" variant="outline" className="ml-auto h-7" disabled={fixing === m.elationId} onClick={() => fix(m)}>
                {fixing === m.elationId && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                Refresh from chart
              </Button>
            </div>
          ))
        )}
        {failed > 0 && (
          <p className="flex items-center gap-1 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5" /> {failed} member{failed === 1 ? "" : "s"} couldn't be checked (e.g. login not found or no chart email).
          </p>
        )}
      </CardContent>
    </Card>
  );
}
