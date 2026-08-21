import { useEffect, useMemo, useState } from "react";
import { Baby, Check, Download, Mail, Search, UserPlus, X } from "lucide-react";

import type { ReconRow } from "@/hooks/useMemberReconciliation";
import {
  buildDependentMatches,
  CONFIDENCE_LABEL,
  eligibleGuardianPool,
  isValidEmail,
  linksToCsv,
  toConfirmedLink,
  toExternalLink,
  type ConfirmedLink,
  type DependentMatch,
  type ExternalGuardian,
  type GuardianCandidate,
  type MatchConfidence,
} from "@/lib/portal/dependents";
import { downloadCsv } from "@/lib/portal/exceptions";
import { resolveElationIds } from "@/lib/portal/elationResolve";

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
const ELATION_IDS_KEY = "pcvip.dependents.elationIds.v1";
const stamp = () => new Date().toISOString().slice(0, 10);

const TONE: Record<MatchConfidence, string> = {
  high: "bg-success/15 text-success border-success/30",
  medium: "bg-accent/15 text-accent border-accent/30",
  ambiguous: "bg-destructive/10 text-destructive border-destructive/30",
  none: "bg-muted text-muted-foreground border-border",
};

type Decision = {
  guardianKeys: string[];
  confirmed: boolean;
  manualKeys?: string[];
  /** Guardians who aren't patients — invited by email address only. */
  externals?: ExternalGuardian[];
};

/** Attach a guardian who has no chart: parent email on the child's record. */
function EmailGuardianAttach({
  defaultEmail,
  onAdd,
}: {
  defaultEmail: string | null;
  onAdd: (guardian: ExternalGuardian) => void;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [name, setName] = useState("");
  const valid = isValidEmail(email);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setEmail(defaultEmail ?? "");
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 text-[11px]">
          <Mail className="mr-1 h-3 w-3" />
          Attach by email
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-2 p-3">
        <p className="text-[11px] text-muted-foreground">
          Use when the parent isn't a patient. The portal invites this address and proxies it
          into the child's record.
        </p>
        <Input
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="parent@example.com"
          className="h-8 text-xs"
        />
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Guardian name (optional)"
          className="h-8 text-xs"
        />
        <Button
          size="sm"
          className="w-full"
          disabled={!valid}
          onClick={() => {
            onAdd({ email: email.trim(), name: name.trim() || undefined });
            setOpen(false);
            setName("");
          }}
        >
          Attach guardian
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/** Searchable patient picker for minors the heuristics couldn't match. */
function GuardianSearch({
  pool,
  exclude,
  onPick,
}: {
  pool: GuardianCandidate[];
  exclude: string[];
  onPick: (candidate: GuardianCandidate) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = pool.filter((c) => !exclude.includes(c.row.key));
    if (!needle) return base.slice(0, 25);
    return base
      .filter((c) =>
        [c.row.name, c.row.email, c.row.elationId, c.row.dob].some(
          (v) => v && String(v).toLowerCase().includes(needle),
        ),
      )
      .slice(0, 25);
  }, [pool, exclude, q]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 text-[11px]">
          <UserPlus className="mr-1 h-3 w-3" />
          Attach a patient
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search patients by name, email, DOB…"
            className="h-8 pl-8 text-xs"
          />
        </div>
        <div className="mt-2 max-h-64 space-y-0.5 overflow-y-auto">
          {results.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">No matching adult patient.</p>
          ) : (
            results.map((c) => (
              <button
                key={c.row.key}
                onClick={() => {
                  onPick(c);
                  setOpen(false);
                  setQ("");
                }}
                className="w-full rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
              >
                <span className="block text-foreground">
                  {c.row.name}
                  {c.age !== null ? ` · ${c.age}` : ""}
                </span>
                <span className="block font-mono text-[10px] text-muted-foreground">
                  {c.row.dob ?? "no dob"}
                  {c.row.email ? ` · ${c.row.email}` : ""}
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Release 2b guardian matching — review surface.
 *
 * Read-only against Hint and Firestore: it proposes a guardian for every minor
 * on the roster and records the staff decision locally. Confirmed links export
 * as CSV for the portal control plane; nothing is written to a member's record
 * from this panel.
 */
export default function DependentMatches({ rows }: { rows: ReconRow[] }) {
  const rawMatches = useMemo(() => buildDependentMatches(rows), [rows]);
  const [filter, setFilter] = useState<"all" | MatchConfidence | "confirmed">("all");
  const [decisions, setDecisions] = useState<Record<string, Decision>>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    } catch {
      return {};
    }
  });

  /** Elation ids looked up from Elation for minors Firestore doesn't know yet. */
  const [elationIds, setElationIds] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem(ELATION_IDS_KEY) ?? "{}");
    } catch {
      return {};
    }
  });
  const [resolveNotes, setResolveNotes] = useState<Record<string, string>>({});
  const [resolving, setResolving] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(decisions));
    } catch {
      /* storage unavailable — keep in-memory only */
    }
  }, [decisions]);

  useEffect(() => {
    try {
      localStorage.setItem(ELATION_IDS_KEY, JSON.stringify(elationIds));
    } catch {
      /* storage unavailable — keep in-memory only */
    }
  }, [elationIds]);

  /** Minors carry the resolved Elation id so the export and UI both see it. */
  const matches = useMemo(
    () =>
      rawMatches.map((m) =>
        !m.minor.elationId && elationIds[m.key]
          ? { ...m, minor: { ...m.minor, elationId: elationIds[m.key] } }
          : m,
      ),
    [rawMatches, elationIds],
  );

  const unresolved = useMemo(
    () => matches.filter((m) => !m.minor.elationId && m.minor.dob),
    [matches],
  );

  const runResolve = async () => {
    if (!unresolved.length || resolving) return;
    setResolving({ done: 0, total: unresolved.length });
    const outcomes = await resolveElationIds(
      unresolved.map((m) => ({
        key: m.key,
        firstName: m.minor.firstName,
        lastName: m.minor.lastName,
        dob: m.minor.dob,
      })),
      (done, total) => setResolving({ done, total }),
    );
    const ids: Record<string, string> = {};
    const notes: Record<string, string> = {};
    for (const [key, o] of Object.entries(outcomes)) {
      if (o.status === "resolved") ids[key] = o.elationId;
      else notes[key] = o.reason;
    }
    setElationIds((prev) => ({ ...prev, ...ids }));
    setResolveNotes((prev) => ({ ...prev, ...notes }));
    setResolving(null);
  };


  const counts = useMemo(() => {
    const c = { high: 0, medium: 0, ambiguous: 0, none: 0, confirmed: 0 };
    for (const m of matches) {
      if (decisions[m.key]?.confirmed) {
        c.confirmed += 1;
        continue; // a confirmed minor no longer needs a decision
      }
      c[m.confidence] += 1;
    }
    return c;
  }, [matches, decisions]);


  /** Every adult who can be attached by hand from the patient search box. */
  const pool = useMemo(() => eligibleGuardianPool(rows), [rows]);
  const poolByKey = useMemo(
    () => new Map(pool.map((c) => [c.row.key, c])),
    [pool],
  );

  /** Proposed candidates plus any patient staff attached manually. */
  const candidatesFor = (m: DependentMatch): GuardianCandidate[] => {
    const manual = (decisions[m.key]?.manualKeys ?? [])
      .filter((k) => !m.candidates.some((c) => c.row.key === k))
      .map((k) => poolByKey.get(k))
      .filter((c): c is GuardianCandidate => Boolean(c));
    return [...m.candidates, ...manual];
  };

  /** A minor can have several guardians — both parents usually want access. */
  const chosenFor = (m: DependentMatch): GuardianCandidate[] => {
    const picked = decisions[m.key]?.guardianKeys;
    if (picked) return candidatesFor(m).filter((c) => picked.includes(c.row.key));
    return m.suggested;
  };

  const attachGuardian = (m: DependentMatch, candidate: GuardianCandidate) =>
    setDecisions((d) => {
      const current = d[m.key];
      const manualKeys = Array.from(
        new Set([...(current?.manualKeys ?? []), candidate.row.key]),
      );
      const guardianKeys = Array.from(
        new Set([
          ...(current?.guardianKeys ?? m.suggested.map((c) => c.row.key)),
          candidate.row.key,
        ]),
      );
      return {
        ...d,
        [m.key]: { guardianKeys, manualKeys, externals: current?.externals, confirmed: false },
      };
    });

  /** Non-patient guardians attached to this minor by email. */
  const externalsFor = (m: DependentMatch): ExternalGuardian[] =>
    decisions[m.key]?.externals ?? [];

  const addExternal = (m: DependentMatch, guardian: ExternalGuardian) =>
    setDecisions((d) => {
      const current = d[m.key];
      const email = guardian.email.toLowerCase();
      const externals = [
        ...(current?.externals ?? []).filter((g) => g.email.toLowerCase() !== email),
        guardian,
      ];
      return {
        ...d,
        [m.key]: {
          guardianKeys: current?.guardianKeys ?? m.suggested.map((c) => c.row.key),
          manualKeys: current?.manualKeys,
          externals,
          confirmed: false,
        },
      };
    });

  const removeExternal = (m: DependentMatch, email: string) =>
    setDecisions((d) => {
      const current = d[m.key];
      return {
        ...d,
        [m.key]: {
          guardianKeys: current?.guardianKeys ?? m.suggested.map((c) => c.row.key),
          manualKeys: current?.manualKeys,
          externals: (current?.externals ?? []).filter(
            (g) => g.email.toLowerCase() !== email.toLowerCase(),
          ),
          confirmed: false,
        },
      };
    });

  const confirmedLinks: ConfirmedLink[] = useMemo(
    () =>
      matches.flatMap((m) => {
        if (!decisions[m.key]?.confirmed) return [];
        return [
          ...chosenFor(m).map((candidate) => toConfirmedLink(m, candidate)),
          ...externalsFor(m).map((g) => toExternalLink(m, g)),
        ];
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [matches, decisions],
  );

  const visible = matches.filter((m) => {
    if (filter === "all") return true;
    if (filter === "confirmed") return Boolean(decisions[m.key]?.confirmed);
    if (decisions[m.key]?.confirmed) return false;
    return m.confidence === filter;
  });


  const toggleGuardian = (m: DependentMatch, guardianKey: string) =>
    setDecisions((d) => {
      const prev = d[m.key];
      const current = prev?.guardianKeys ?? m.suggested.map((c) => c.row.key);
      const guardianKeys = current.includes(guardianKey)
        ? current.filter((k) => k !== guardianKey)
        : [...current, guardianKey];
      return {
        ...d,
        [m.key]: {
          guardianKeys,
          manualKeys: prev?.manualKeys,
          externals: prev?.externals,
          confirmed: false,
        },
      };
    });

  const toggleConfirm = (m: DependentMatch) =>
    setDecisions((d) => {
      const current = d[m.key];
      const guardianKeys = current?.guardianKeys ?? m.suggested.map((c) => c.row.key);
      const externals = current?.externals ?? [];
      if (!guardianKeys.length && !externals.length) return d;
      return {
        ...d,
        [m.key]: {
          guardianKeys,
          manualKeys: current?.manualKeys,
          externals,
          confirmed: !current?.confirmed,
        },
      };
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
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!unresolved.length || Boolean(resolving)}
              onClick={runResolve}
              title="Looks up each minor's chart in Elation by first name + last name + DOB"
            >
              <IdCard className="mr-1 h-3.5 w-3.5" />
              {resolving
                ? `Resolving ${resolving.done}/${resolving.total}…`
                : `Resolve ${unresolved.length} Elation IDs`}
            </Button>
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
                const all = candidatesFor(m);
                const chosen = chosenFor(m);
                const chosenKeys = chosen.map((c) => c.row.key);
                const confirmed = Boolean(decisions[m.key]?.confirmed);
                const externals = externalsFor(m);
                const totalGuardians = chosen.length + externals.length;
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
                      {all.length ? (
                        <div className="space-y-1.5">
                          {all.map((c) => (
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

                      {externals.length > 0 && (
                        <div className="mt-1.5 space-y-1">
                          {externals.map((g) => (
                            <div
                              key={g.email}
                              className="flex items-start gap-2 text-xs text-foreground"
                            >
                              <Mail className="mt-0.5 h-3 w-3 shrink-0 text-accent" />
                              <span className="min-w-0">
                                {g.name || g.email}
                                <span className="block truncate text-[11px] text-muted-foreground">
                                  Non-patient guardian · invited at {g.email}
                                </span>
                              </span>
                              <button
                                onClick={() => removeExternal(m, g.email)}
                                className="text-muted-foreground hover:text-destructive"
                                aria-label={`Remove ${g.email}`}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <GuardianSearch
                          pool={pool}
                          exclude={[m.minor.key, ...all.map((c) => c.row.key)]}
                          onPick={(candidate) => attachGuardian(m, candidate)}
                        />
                        <EmailGuardianAttach
                          defaultEmail={m.minor.email}
                          onAdd={(guardian) => addExternal(m, guardian)}
                        />
                      </div>
                    </TableCell>
                    <TableCell>
                      {confirmed ? (
                        <Badge
                          variant="outline"
                          className="text-[10px] border-success/40 bg-success/10 text-success"
                        >
                          Confirmed
                        </Badge>
                      ) : (
                        <Badge variant="outline" className={cn("text-[10px]", TONE[m.confidence])}>
                          {CONFIDENCE_LABEL[m.confidence]}
                        </Badge>
                      )}

                      {totalGuardians > 0 && (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {totalGuardians} guardian{totalGuardians === 1 ? "" : "s"} selected
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant={confirmed ? "secondary" : "outline"}
                        size="sm"
                        disabled={!totalGuardians}
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
