import { useEffect, useMemo, useState } from "react";
import { Baby, Check, Download, Search, UserPlus, X } from "lucide-react";

import type { ReconRow } from "@/hooks/useMemberReconciliation";
import {
  buildDependentMatches,
  CONFIDENCE_LABEL,
  eligibleGuardianPool,
  linksToCsv,
  toConfirmedLink,
  type ConfirmedLink,
  type DependentMatch,
  type GuardianCandidate,
  type MatchConfidence,
} from "@/lib/portal/dependents";
import { downloadCsv } from "@/lib/portal/exceptions";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "pcvip.dependents.decisions.v2";
const stamp = () => new Date().toISOString().slice(0, 10);

const TONE: Record<MatchConfidence, string> = {
  high: "bg-success/15 text-success border-success/30",
  medium: "bg-accent/15 text-accent border-accent/30",
  ambiguous: "bg-destructive/10 text-destructive border-destructive/30",
  none: "bg-muted text-muted-foreground border-border",
};

type Decision = { guardianKeys: string[]; confirmed: boolean };

/**
 * Release 2b guardian matching — review surface.
 *
 * Read-only against Hint and Firestore: it proposes a guardian for every minor
 * on the roster and records the staff decision locally. Confirmed links export
 * as CSV for the portal control plane; nothing is written to a member's record
 * from this panel.
 */
export default function DependentMatches({ rows }: { rows: ReconRow[] }) {
  const matches = useMemo(() => buildDependentMatches(rows), [rows]);
  const [filter, setFilter] = useState<"all" | MatchConfidence | "confirmed">("all");
  const [decisions, setDecisions] = useState<Record<string, Decision>>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(decisions));
    } catch {
      /* storage unavailable — keep in-memory only */
    }
  }, [decisions]);

  const counts = useMemo(() => {
    const c = { high: 0, medium: 0, ambiguous: 0, none: 0, confirmed: 0 };
    for (const m of matches) {
      c[m.confidence] += 1;
      if (decisions[m.key]?.confirmed) c.confirmed += 1;
    }
    return c;
  }, [matches, decisions]);

  /** A minor can have several guardians — both parents usually want access. */
  const chosenFor = (m: DependentMatch): GuardianCandidate[] => {
    const picked = decisions[m.key]?.guardianKeys;
    if (picked) return m.candidates.filter((c) => picked.includes(c.row.key));
    return m.suggested;
  };

  const confirmedLinks: ConfirmedLink[] = useMemo(
    () =>
      matches.flatMap((m) => {
        if (!decisions[m.key]?.confirmed) return [];
        return chosenFor(m).map((candidate) => toConfirmedLink(m, candidate));
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [matches, decisions],
  );

  const visible = matches.filter((m) => {
    if (filter === "all") return true;
    if (filter === "confirmed") return Boolean(decisions[m.key]?.confirmed);
    return m.confidence === filter;
  });

  const toggleGuardian = (m: DependentMatch, guardianKey: string) =>
    setDecisions((d) => {
      const current = d[m.key]?.guardianKeys ?? m.suggested.map((c) => c.row.key);
      const guardianKeys = current.includes(guardianKey)
        ? current.filter((k) => k !== guardianKey)
        : [...current, guardianKey];
      return { ...d, [m.key]: { guardianKeys, confirmed: false } };
    });

  const toggleConfirm = (m: DependentMatch) =>
    setDecisions((d) => {
      const current = d[m.key];
      const guardianKeys = current?.guardianKeys ?? m.suggested.map((c) => c.row.key);
      if (!guardianKeys.length) return d;
      return { ...d, [m.key]: { guardianKeys, confirmed: !current?.confirmed } };
    });

  const FILTERS: { id: typeof filter; label: string; n: number }[] = [
    { id: "all", label: "All minors", n: matches.length },
    { id: "high", label: CONFIDENCE_LABEL.high, n: counts.high },
    { id: "medium", label: CONFIDENCE_LABEL.medium, n: counts.medium },
    { id: "ambiguous", label: CONFIDENCE_LABEL.ambiguous, n: counts.ambiguous },
    { id: "none", label: CONFIDENCE_LABEL.none, n: counts.none },
    { id: "confirmed", label: "Confirmed", n: counts.confirmed },
  ];

  if (!matches.length) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Baby className="h-4 w-4 text-accent" />
              Dependent guardian matching
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Minors get no login of their own — one or more guardians proxy in. Proposals only;
              a link becomes real once staff confirm it and the control plane applies it.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={!confirmedLinks.length}
            onClick={() =>
              downloadCsv(`guardian-links-${stamp()}.csv`, linksToCsv(confirmedLinks))
            }
          >
            <Download className="mr-1 h-3.5 w-3.5" />
            Export {confirmedLinks.length} confirmed
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1 w-fit rounded-full border border-border bg-muted/50 p-1">
          {FILTERS.map((f) => (
            <button
              key={String(f.id)}
              onClick={() => setFilter(f.id)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                filter === f.id
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
              <span className="ml-1.5 font-mono text-[10px] opacity-70">{f.n}</span>
            </button>
          ))}
        </div>

        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Minor</TableHead>
                <TableHead className="w-16">Age</TableHead>
                <TableHead>Proposed guardians</TableHead>
                <TableHead>Evidence</TableHead>
                <TableHead className="w-32 text-right">Decision</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((m) => {
                const chosen = chosenFor(m);
                const chosenKeys = chosen.map((c) => c.row.key);
                const confirmed = Boolean(decisions[m.key]?.confirmed);
                return (
                  <TableRow key={m.key} className={cn(confirmed && "bg-success/5")}>
                    <TableCell>
                      <p className="text-sm text-foreground">{m.minor.name}</p>
                      <p className="font-mono text-[11px] text-muted-foreground">
                        {m.minor.dob ?? "no dob"}
                        {m.minor.elationId ? ` · ${m.minor.elationId}` : ""}
                      </p>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{m.age ?? "—"}</TableCell>
                    <TableCell>
                      {m.candidates.length ? (
                        <div className="space-y-1.5">
                          {m.candidates.map((c) => (
                            <label
                              key={c.row.key}
                              className="flex items-start gap-2 text-xs text-foreground"
                            >
                              <Checkbox
                                checked={chosenKeys.includes(c.row.key)}
                                onCheckedChange={() => toggleGuardian(m, c.row.key)}
                                className="mt-0.5"
                              />
                              <span>
                                {c.row.name}
                                {c.age !== null ? ` · ${c.age}` : ""}
                                <span className="block text-[11px] text-muted-foreground">
                                  {c.rationale}
                                </span>
                              </span>
                            </label>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {m.blocker ?? "No candidate"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn("text-[10px]", TONE[m.confidence])}>
                        {CONFIDENCE_LABEL[m.confidence]}
                      </Badge>
                      {chosen.length > 0 && (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {chosen.length} guardian{chosen.length === 1 ? "" : "s"} selected
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant={confirmed ? "secondary" : "outline"}
                        size="sm"
                        disabled={!chosen.length}
                        onClick={() => toggleConfirm(m)}
                      >
                        {confirmed ? (
                          <>
                            <X className="mr-1 h-3.5 w-3.5" />
                            Undo
                          </>
                        ) : (
                          <>
                            <Check className="mr-1 h-3.5 w-3.5" />
                            Confirm
                          </>
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
