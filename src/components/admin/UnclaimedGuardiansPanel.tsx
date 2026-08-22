import { useState } from "react";
import { motion } from "framer-motion";
import { Users, RefreshCw, AlertTriangle, Eye, EyeOff, Mail, PauseCircle } from "lucide-react";
import { useUnclaimedGuardians, type UnclaimedGuardianRow } from "@/hooks/usePortalAdmin";
import { useToast } from "@/hooks/use-toast";

/**
 * Release 2b phase 1 — guardian links that cannot yet authorize a read.
 *
 * Two blockers, two very different staff actions:
 *   GUARDIAN_HAS_NO_PORTAL_ACCOUNT — the parent is on the child's chart but has
 *     never claimed their own portal account. Send them the normal self-invite.
 *   EMAIL_ONLY_PHASE_2 — no chart link at all; not authorizable in phase 1.
 *     Parked deliberately, no action available.
 *
 * Guardian names, emails and child ids are PHI. The report is fetched only on
 * demand through the role-gated `portal-admin` bridge, which audits the call;
 * the row detail stays hidden until a second, explicit reveal.
 */
export default function UnclaimedGuardiansPanel() {
  const run = useUnclaimedGuardians();
  const { toast } = useToast();
  const [revealed, setRevealed] = useState(false);

  const report = run.data ?? null;
  const rows = report?.rows ?? [];
  const needInvite = rows.filter((r) => r.blocker === "GUARDIAN_HAS_NO_PORTAL_ACCOUNT");
  const parked = rows.filter((r) => r.blocker !== "GUARDIAN_HAS_NO_PORTAL_ACCOUNT");

  const load = async () => {
    try {
      await run.mutateAsync({});
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Could not build the report",
        description: e instanceof Error ? e.message : String(e),
      });
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-border bg-card p-6 shadow-soft"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2.5">
            <Users className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="font-serif text-lg text-card-foreground">Guardian links needing action</h2>
            <p className="text-sm text-muted-foreground">
              Active guardian links on minors that cannot authorize a read yet. Read-only and
              audited — no invite is sent from here.
            </p>
          </div>
        </div>
        <button
          onClick={load}
          disabled={run.isPending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${run.isPending ? "animate-spin" : ""}`} />
          {run.isPending ? "Building…" : report ? "Refresh (audited)" : "Run report (audited)"}
        </button>
      </div>

      {run.error && (
        <p className="mt-4 flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" />
          {run.error instanceof Error ? run.error.message : String(run.error)}
        </p>
      )}

      {!report && !run.isPending && !run.error && (
        <p className="mt-4 text-xs text-muted-foreground">
          Nothing loaded. Running the report reads guardian PHI and is written to the audit log.
        </p>
      )}

      {report && (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-4">
            <Stat label="Minors" value={(report.summary?.minors ?? 0).toLocaleString()} />
            <Stat label="Active links" value={(report.summary?.activeLinks ?? 0).toLocaleString()} />
            <Stat
              label="Ready (claimed)"
              value={(report.summary?.claimed ?? 0).toLocaleString()}
              tone="good"
            />
            <Stat
              label="Blocked"
              value={(report.summary?.unclaimed ?? rows.length).toLocaleString()}
              tone={rows.length ? "warn" : "good"}
            />
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <p className="flex items-center gap-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
              <Mail className="h-3.5 w-3.5" />
              {needInvite.length.toLocaleString()} parents need the normal self-invite — actionable
              now.
            </p>
            <p className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              <PauseCircle className="h-3.5 w-3.5" />
              {parked.length.toLocaleString()} email-only links parked for phase 2 — no action
              available.
            </p>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {report.generatedAt ? new Date(report.generatedAt).toLocaleString() : ""}
            </p>
            <button
              onClick={() => setRevealed((v) => !v)}
              disabled={!rows.length}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
            >
              {revealed ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              {revealed ? "Hide guardian detail" : "Show guardian detail (PHI)"}
            </button>
          </div>

          {revealed && rows.length > 0 && (
            <div className="mt-3 overflow-hidden rounded-xl border border-border">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/60 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Child</th>
                    <th className="px-3 py-2 font-medium">Guardian</th>
                    <th className="px-3 py-2 font-medium">Email</th>
                    <th className="px-3 py-2 font-medium">Chart link</th>
                    <th className="px-3 py-2 font-medium">Next step</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 200).map((r, i) => (
                    <Row key={`${r.childElationId}:${r.guardianElationId ?? r.guardianEmail ?? i}`} row={r} />
                  ))}
                </tbody>
              </table>
              {rows.length > 200 && (
                <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
                  Showing 200 of {rows.length}.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}

function Row({ row }: { row: UnclaimedGuardianRow }) {
  const invitable = row.blocker === "GUARDIAN_HAS_NO_PORTAL_ACCOUNT";
  return (
    <tr className="border-t border-border">
      <td className="px-3 py-2 font-mono">{row.childElationId}</td>
      <td className="px-3 py-2">{row.guardianName || "—"}</td>
      <td className="px-3 py-2 text-muted-foreground">{row.guardianEmail || "—"}</td>
      <td className="px-3 py-2 font-mono text-muted-foreground">
        {row.guardianElationId || "none"}
      </td>
      <td className={`px-3 py-2 ${invitable ? "text-warning" : "text-muted-foreground"}`}>
        {invitable ? "Send self-invite to the parent" : "Parked — phase 2"}
      </td>
    </tr>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "warn";
}) {
  const toneClass =
    tone === "good" ? "text-success" : tone === "warn" ? "text-warning" : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-background px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 font-mono text-lg ${toneClass}`}>{value}</p>
    </div>
  );
}
