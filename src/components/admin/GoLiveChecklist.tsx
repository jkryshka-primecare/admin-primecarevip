import { useEffect, useState } from "react";
import { Check, Loader2, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { evaluateGate, useArtifactCoverage } from "@/hooks/useArtifactCoverage";

/**
 * Release 2b Part B — go-live readiness for `GUARDIAN_READS_ENABLED`.
 *
 * This screen DISPLAYS readiness. It cannot flip a flag, and there is
 * deliberately no control here that could make a guardian read live: the flag,
 * the legacy-fallback env var and the Elation allowlist stay GCP actions.
 *
 * Two classes of line:
 *  - machine-checked, read from the latest artifact coverage report;
 *  - operator-attested, which you tick after doing the step in GCP/GitHub.
 *    Attestations are local to this browser and are evidence of intent, not
 *    proof — they are marked as such.
 */

const STORE_KEY = "pcv.golive.attestations.v1";

type Item = {
  id: string;
  label: string;
  detail: string;
  owner: "operator" | "app";
};

/** Steps only you can do — they live in GCP, GitHub or the Firebase repo. */
const OPERATOR_ITEMS: Item[] = [
  {
    id: "deploy",
    label: "Functions deployed (2b bundle)",
    detail:
      "portal-dependents + portal-artifact-integrity merged and deployed, all new exports in index.js.",
    owner: "operator",
  },
  {
    id: "index",
    label: "Composite index merged into the complete firestore.indexes.json",
    detail: "{ dependent.isMinor ASC, dependent.convertsAt ASC }. Never deploy a standalone file.",
    owner: "operator",
  },
  {
    id: "invoker-lock",
    label: "Invoker lock ran — allUsers stripped from every admin function",
    detail:
      "lock-admin-invokers.yml includes backfillElationReports as well as the 2b admin functions.",
    owner: "operator",
  },
  {
    id: "allowlist",
    label: "ELATION_READ_ALLOWLIST set for the minor cohort",
    detail: "Bounds what the ingest can fetch, independent of the id list you paste.",
    owner: "operator",
  },
  {
    id: "sweep-deployed",
    label: "dependentBirthdaySweep deployed AND run at least once",
    detail:
      "Hard precondition. Until the sweep has actually executed, an already-18 child still looks like a minor.",
    owner: "operator",
  },
  {
    id: "sweep-converted",
    label: "Every already-18 dependent converted to adult",
    detail:
      "The sweep's conversion backlog must be empty. If a now-adult is still guardian-proxied when reads go live, a guardian reads an adult's record with no consent gate.",
    owner: "operator",
  },
  {
    id: "sweep-alert",
    label: "Cloud Logging alert armed on the sweep's invite-failed line",
    detail:
      "Interim cover while the reconciler is pending: a silently-orphaned now-adult must page someone for a manual re-invite.",
    owner: "operator",
  },
  {
    id: "artifact-bucket-unset",
    label: "ARTIFACT_BUCKET is UNSET in prod and staging",
    detail:
      "NO-GO if set. The runner hardcodes prive-care-vip.firebasestorage.app while the read path resolves artifactBucketName(); any override makes writes and reads land in different buckets and every read is a permanent \"preparing\". Remove this line once the fast-follow has the runner import artifactBucketName().",
    owner: "operator",
  },
  {
    id: "fallback-off",
    label: "ARTIFACT_LEGACY_UID_FALLBACK turned OFF for the gate audit",
    detail: "The gate below refuses to pass on a report that was produced with the fallback on.",
    owner: "operator",
  },
  {
    id: "redteam",
    label: "Red-team suite green on the deployed build",
    detail: "Guardian resolver, artifact identity and suppression cases.",
    owner: "operator",
  },
  {
    id: "e2e",
    label: "Real-guardian end-to-end read verified in staging",
    detail: "One live guardian, one real minor, one artifact.",
    owner: "operator",
  },
];

function Row({
  pass,
  label,
  detail,
  right,
}: {
  pass: boolean;
  label: string;
  detail: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 border-t border-border px-4 py-3">
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
          pass ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"
        }`}
      >
        {pass ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-foreground">{label}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{detail}</p>
      </div>
      {right}
    </div>
  );
}

export default function GoLiveChecklist() {
  const { report, loading, error } = useArtifactCoverage(true);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) setTicked(JSON.parse(raw) as Record<string, boolean>);
    } catch {
      /* ignore */
    }
  }, []);

  function toggle(id: string) {
    setTicked((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const verdict = report ? evaluateGate(report) : null;
  const sweepReady = ticked["sweep-deployed"] === true && ticked["sweep-converted"] === true;
  const operatorReady = OPERATOR_ITEMS.every((i) => ticked[i.id]);
  const allGreen = Boolean(verdict?.pass) && operatorReady;

  return (
    <div className="space-y-4">
      <div
        className={`rounded-xl border border-border p-4 shadow-soft ${
          allGreen ? "bg-success/10" : "bg-card"
        }`}
      >
        <div className="flex items-center gap-2">
          {allGreen ? (
            <ShieldCheck className="h-4 w-4 text-success" />
          ) : (
            <ShieldAlert className="h-4 w-4 text-warning" />
          )}
          <h2 className="font-serif text-lg text-foreground">
            Guardian reads — {allGreen ? "ready to flip" : "NO-GO"}
          </h2>
        </div>
        <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
          Flipping <span className="font-mono">GUARDIAN_READS_ENABLED</span> is a deliberate GCP
          action and is intentionally not possible from this app. This screen only tells you
          whether the preconditions hold.
        </p>
        {!sweepReady && (
          <p className="mt-2 rounded-md bg-destructive/10 p-2 text-[11px] text-destructive">
            Birthday sweep precondition unmet. Until the sweep has deployed, run and converted every
            already-18 dependent, a guardian would be able to read a now-adult&apos;s record with no
            consent gate the moment reads go live.
          </p>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-soft">
        <div className="px-4 py-3">
          <h3 className="text-sm font-medium text-foreground">Machine-checked — coverage gate</h3>
          <p className="text-[11px] text-muted-foreground">
            Read live from the latest artifact coverage report.
          </p>
        </div>
        {loading && (
          <div className="flex items-center gap-2 border-t border-border px-4 py-4 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading the latest report…
          </div>
        )}
        {error && (
          <p className="border-t border-border px-4 py-4 text-xs text-destructive">{error}</p>
        )}
        {!loading && !report && !error && (
          <p className="border-t border-border px-4 py-4 text-xs text-muted-foreground">
            No coverage report yet — run the audit from the Artifact Coverage tab.
          </p>
        )}
        {verdict && (
          <>
            {!verdict.validGateRun && (
              <p className="border-t border-border bg-destructive/10 px-4 py-3 text-[11px] text-destructive">
                The latest report was produced with the legacy uid fallback ON (or predates the
                flag). It cannot be used as a gate run — re-run with the fallback disabled.
              </p>
            )}
            {verdict.lines.map((l) => (
              <Row key={l.key} pass={l.pass} label={l.label} detail={l.detail} />
            ))}
            {verdict.checks.map((c) => (
              <Row key={c.key} pass={c.pass} label={c.label} detail={c.detail} />
            ))}
          </>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-soft">
        <div className="px-4 py-3">
          <h3 className="text-sm font-medium text-foreground">Yours — GCP, GitHub, Firebase repo</h3>
          <p className="text-[11px] text-muted-foreground">
            Operator-attested. Ticking a box records your intent in this browser; it is not proof
            the step ran.
          </p>
        </div>
        {OPERATOR_ITEMS.map((i) => (
          <Row
            key={i.id}
            pass={ticked[i.id] === true}
            label={i.label}
            detail={i.detail}
            right={
              <button
                onClick={() => toggle(i.id)}
                className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {ticked[i.id] ? "Undo" : "Mark done"}
              </button>
            }
          />
        ))}
      </div>
    </div>
  );
}
