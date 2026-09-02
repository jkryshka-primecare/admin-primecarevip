import { useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Mail, MailX, RefreshCw, Search, ShieldAlert, ShieldCheck } from "lucide-react";

import type { ReconRow } from "@/hooks/useMemberReconciliation";
import { useAuth } from "@/hooks/useAuth";
import { usePortalAccess, usePortalMutations } from "@/hooks/usePortalAdmin";
import { toast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

function formatState(value: string | null | undefined): string {
  if (!value) return "—";
  return value.replace(/_/g, " ");
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US");
}

/** Always render a date of birth as MM/DD/YYYY, whatever shape it arrives in. */
function formatDob(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = String(value).trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[2]}/${iso[3]}/${iso[1]}`;
  const us = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (us) return `${us[1].padStart(2, "0")}/${us[2].padStart(2, "0")}/${us[3]}`;
  return raw;
}

/** Digits-only DOB key so 10/29/1983, 1983-10-29 and 10-29-83 all compare equal. */
function dobKey(value: string | null | undefined): string {
  const formatted = formatDob(value);
  if (!formatted) return "";
  const digits = formatted.replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(0, 8) : digits;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length];
}

/** Allow one typo for short words, two for longer ones. */
function closeEnough(token: string, word: string): boolean {
  if (!token || !word) return false;
  if (word.includes(token) || token.includes(word)) return true;
  if (token.length < 4) return false;
  const budget = token.length > 7 ? 2 : 1;
  return levenshtein(token, word) <= budget;
}

export default function PortalAccessTriage({ rows }: { rows: ReconRow[] }) {
  const { isAdmin } = useAuth();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const needleDob = dobKey(needle);
    const tokens = needle.split(/[\s,]+/).filter(Boolean);

    const scored = rows
      .map((row) => {
        const fields = [row.name, row.email, row.phone, row.hintId, row.elationId]
          .filter(Boolean)
          .map((value) => String(value).toLowerCase());
        const rowDob = dobKey(row.dob);
        const haystack = fields.join(" ");
        let score = 0;

        // Exact-ish whole-string hits rank highest.
        if (haystack.includes(needle)) score += 100;
        if (needleDob.length === 8 && rowDob && rowDob === needleDob) score += 100;

        // Every token must land somewhere: exact substring, or a close (typo-tolerant) word.
        const words = haystack.split(/[^a-z0-9@.]+/).filter(Boolean);
        const allTokens = tokens.every((token) => {
          const tokenDob = dobKey(token);
          if (tokenDob.length === 8 && rowDob === tokenDob) {
            score += 40;
            return true;
          }
          if (haystack.includes(token)) {
            score += 20;
            return true;
          }
          if (words.some((word) => closeEnough(token, word))) {
            score += 8;
            return true;
          }
          return false;
        });

        return allTokens && score > 0 ? { row, score } : null;
      })
      .filter((entry): entry is { row: ReconRow; score: number } => entry !== null);

    return scored
      .sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name))
      .slice(0, 12)
      .map((entry) => entry.row);
  }, [rows, query]);


  const runSearch = () => {
    setSelectedId(null);
    setReason("");
    setQuery(search);
  };


  const selected = rows.find((row) => row.key === selectedId) ?? null;
  const { snapshot, loading, error, refetch } = usePortalAccess(selected?.elationId ?? null);
  const { issueInvite, revokeInvite, setAccess } = usePortalMutations(selected?.elationId ?? null);
  const busy = issueInvite.isPending || revokeInvite.isPending || setAccess.isPending;
  const suspended = snapshot?.access?.status === "suspended";
  const pendingInvite = snapshot?.inviteStatus === "pending";
  const needsInvite = snapshot?.inviteStatus === "none" || snapshot?.inviteStatus === "revoked";


  const clearSelection = () => {
    setSelectedId(null);
    setReason("");
  };

  const guard = () => {
    if (!isAdmin) {
      toast({
        title: "Administrator access required",
        description: "Only admins can change a member's portal access.",
        variant: "destructive",
      });
      return false;
    }
    if (reason.trim().length < 3) {
      toast({
        title: "Reason required",
        description: "Enter a short note; portal changes are written to the audit log.",
        variant: "destructive",
      });
      return false;
    }
    return true;
  };

  const run = (promise: Promise<unknown>, title: string) => {
    promise
      .then(() => {
        toast({ title });
        setReason("");
      })
      .catch((cause: unknown) => {
        toast({
          title: "Change not applied",
          description: cause instanceof Error ? cause.message : String(cause),
          variant: "destructive",
        });
      });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4" />
          Portal access triage
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Find a member by name, email, phone, or ID, then review the live portal state before helping them regain access.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <form
          className="flex max-w-2xl flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            runSearch();
          }}
        >
          <div className="relative min-w-[240px] flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search a member to triage…"
              className="h-9 pl-8 text-xs"
              aria-label="Search portal access"
            />
          </div>
          <Button type="submit" size="sm" className="h-9" disabled={!search.trim()}>
            <Search className="mr-1 h-3.5 w-3.5" />
            Search
          </Button>
          {(query || search) && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-9"
              onClick={() => {
                setSearch("");
                setQuery("");
                setSelectedId(null);
                setReason("");
              }}
            >
              Clear
            </Button>
          )}
        </form>

        {matches.length > 0 && !selected && (
          <div className="divide-y rounded-md border border-border">
            {matches.map((row) => (
              <Button
                key={row.key}
                type="button"
                variant="ghost"
                className="h-auto w-full justify-start rounded-none px-3 py-2 text-left first:rounded-t-md last:rounded-b-md"
                onClick={() => setSelectedId(row.key)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{row.name}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {[row.email, row.dob, row.elationId].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <Badge variant="secondary" className="ml-2 shrink-0 text-[10px]">
                  {row.elationId ? formatState(row.portalStatus) : "no portal record"}
                </Badge>
              </Button>
            ))}
          </div>
        )}

        {query.trim() && matches.length === 0 && !selected && (
          <p className="text-xs text-muted-foreground">
            No member in the reconciled roster matches “{query.trim()}”. Try an email, date of birth, or Elation ID — if
            nothing matches, this person has no portal record yet.
          </p>
        )}


        {selected && (
          <div className="space-y-3 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-foreground">{selected.name}</p>
                <p className="text-xs text-muted-foreground">
                  {[selected.email, selected.dob, selected.elationId].filter(Boolean).join(" · ")}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" onClick={() => refetch()} disabled={loading} title="Refresh portal state">
                  <RefreshCw className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
                </Button>
                <Button variant="outline" size="sm" onClick={clearSelection}>Choose another</Button>
              </div>
            </div>

            {!selected.elationId && (
              <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-2.5 text-xs text-muted-foreground">
                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  This member has no portal record yet, so there is nothing to invite or restore. Provision them from the
                  “Ready to provision” exception list below first.
                </span>
              </div>
            )}

            {selected.elationId && error && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {!selected.elationId ? null : loading ? (
              <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Checking the live portal state…
              </div>
            ) : snapshot ? (
              <>
                <div className="grid gap-3 text-xs sm:grid-cols-4">
                  <div>
                    <p className="uppercase tracking-wide text-muted-foreground">Account</p>
                    <Badge variant={snapshot.claimed ? "default" : "secondary"}>
                      {snapshot.claimed ? "Claimed" : "Not claimed"}
                    </Badge>
                  </div>
                  <div>
                    <p className="uppercase tracking-wide text-muted-foreground">Invite</p>
                    <p className="font-medium capitalize text-foreground">{formatState(snapshot.inviteStatus)}</p>
                  </div>
                  <div>
                    <p className="uppercase tracking-wide text-muted-foreground">Portal access</p>
                    <Badge variant={suspended ? "destructive" : "default"}>
                      {suspended ? "Suspended" : "Active"}
                    </Badge>
                  </div>
                  <div>
                    <p className="uppercase tracking-wide text-muted-foreground">Invite sent</p>
                    <p className="font-mono text-foreground">{formatDate(snapshot.inviteSentAt)}</p>
                  </div>
                </div>

                {(needsInvite || suspended) && (
                  <>
                    <Textarea
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="Reason for this access change (audited)"
                      rows={2}
                      disabled={!isAdmin || busy}
                      className="text-xs"
                    />
                    <div className="flex flex-wrap gap-2">
                      {(needsInvite || pendingInvite) && (
                        <Button
                          size="sm"
                          disabled={!isAdmin || busy}
                          onClick={() => guard() && run(
                            issueInvite.mutateAsync({ reason, reissue: pendingInvite }),
                            pendingInvite || snapshot.inviteStatus === "revoked" ? "Invite re-sent" : "Invite sent",
                          )}
                        >
                          {issueInvite.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Mail className="mr-1 h-3.5 w-3.5" />}
                          {pendingInvite ? "Resend invite" : snapshot.inviteStatus === "revoked" ? "Send replacement invite" : "Send invite"}
                        </Button>
                      )}
                      {pendingInvite && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!isAdmin || busy}
                          onClick={() => guard() && run(
                            revokeInvite.mutateAsync({ reason }),
                            "Invite revoked",
                          )}
                        >
                          {revokeInvite.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <MailX className="mr-1 h-3.5 w-3.5" />}
                          Revoke invite
                        </Button>
                      )}
                      {suspended && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!isAdmin || busy}
                          onClick={() => guard() && run(
                            setAccess.mutateAsync({ reason, patch: { status: "active" } }),
                            "Portal access restored",
                          )}
                        >
                          {setAccess.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1 h-3.5 w-3.5" />}
                          Restore portal access
                        </Button>
                      )}
                    </div>
                  </>
                )}

                {!needsInvite && !pendingInvite && !suspended && (
                  <div className="flex items-center gap-2 text-xs text-success">
                    <CheckCircle2 className="h-4 w-4" /> This account is claimed and currently active.
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <ShieldAlert className="h-4 w-4" /> No live portal snapshot is available.
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
