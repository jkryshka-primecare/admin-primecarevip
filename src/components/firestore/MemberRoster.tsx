import { useMemo, useState } from "react";
import { AlertCircle, Loader2, RefreshCw, Search, UserPlus, Users } from "lucide-react";
import {
  useMemberReconciliation,
  BUCKET_LABELS,
  type ReconBucket,
} from "@/hooks/useMemberReconciliation";
import { useAuth } from "@/hooks/useAuth";
import ProvisionMissingDialog from "@/components/firestore/ProvisionMissingDialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type Filter = "all" | ReconBucket;

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "member_active", label: "Portal active" },
  { id: "member_invited", label: "Invited" },
  { id: "member_no_portal", label: "No portal record" },
  { id: "portal_no_membership", label: "No active membership" },
];

const BUCKET_TONE: Record<ReconBucket, string> = {
  member_active: "bg-success/15 text-success border-success/30",
  member_invited: "bg-accent/15 text-accent border-accent/30",
  member_no_portal: "bg-destructive/10 text-destructive border-destructive/30",
  portal_no_membership: "bg-muted text-muted-foreground border-border",
};

/**
 * Membership roster reconciled against the member-app portal.
 * Hint is the source of truth for who is a member; Firestore only knows who
 * has a portal record. Read-only — nothing here writes to either system.
 */
export default function MemberRoster() {
  const { rows, counts, totals, missingMembers, loading, fetching, error, refetch } =
    useMemberReconciliation();
  const { isAdmin } = useAuth();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [provisionOpen, setProvisionOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== "all" && r.bucket !== filter) return false;
      if (!q) return true;
      return [r.name, r.email, r.phone, r.hintId, r.elationId, r.dob].some(
        (v) => v && String(v).toLowerCase().includes(q),
      );
    });
  }, [rows, filter, search]);

  const countFor = (f: Filter) => (f === "all" ? rows.length : counts[f]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-serif text-lg text-foreground">Membership roster</h3>
          <p className="text-xs text-muted-foreground">
            Hint memberships reconciled against member-app portal records · read-only
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && missingMembers.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setProvisionOpen(true)}>
              <UserPlus className="mr-1 h-3.5 w-3.5" />
              Provision {missingMembers.length} missing record
              {missingMembers.length === 1 ? "" : "s"}
            </Button>
          )}
          <Button variant="outline" size="icon" onClick={() => refetch()} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      <ProvisionMissingDialog
        open={provisionOpen}
        onOpenChange={setProvisionOpen}
        missing={missingMembers}
      />

      {!loading && !error && (
        <Card className="bg-muted/30">
          <CardContent className="flex flex-wrap items-baseline gap-x-6 gap-y-2 py-4">
            <div>
              <p className="font-mono text-2xl text-foreground">
                {totals.activeMembers.toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground">Active members in Hint</p>
            </div>
            <div>
              <p className="font-mono text-2xl text-foreground">
                {totals.withPortal.toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground">With a portal record</p>
            </div>
            <div>
              <p className="font-mono text-2xl text-destructive">
                {counts.member_no_portal.toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground">Members missing from the portal</p>
            </div>
            <div className="ml-auto text-right text-xs text-muted-foreground">
              <p>{totals.hintPatients.toLocaleString()} Hint patient charts</p>
              <p>{totals.portalRecords.toLocaleString()} portal records</p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1 bg-muted/50 border border-border rounded-full p-1 w-fit">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-medium transition-colors",
                filter === f.id
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
              <span className="ml-1.5 font-mono text-[10px] opacity-70">
                {countFor(f.id).toLocaleString()}
              </span>
            </button>
          ))}
        </div>
        <div className="relative min-w-[220px] flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, phone, Hint or Elation ID…"
            className="h-9 pl-8 text-xs"
          />
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" />
            Members
            {!loading && !error && (
              <Badge variant="secondary" className="font-mono text-[10px]">
                {filtered.length.toLocaleString()}
                {filtered.length !== rows.length && ` / ${rows.length.toLocaleString()}`}
              </Badge>
            )}
            {fetching && !loading && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : loading ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <p className="text-xs">Paging the full roster from Hint and the member app…</p>
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No members match the current filter or search.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>DOB</TableHead>
                    <TableHead>Member type</TableHead>
                    <TableHead>Membership</TableHead>
                    <TableHead>Portal</TableHead>
                    <TableHead>Found in</TableHead>
                    {isAdmin && <TableHead className="text-right">Action</TableHead>}

                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow key={r.key}>
                      <TableCell className="text-xs whitespace-nowrap font-medium">
                        {r.name}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {r.email ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs font-mono whitespace-nowrap">
                        {r.dob ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap capitalize">
                        {r.memberType ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap capitalize">
                        {r.membershipStatus === "none" ? "—" : r.membershipStatus}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        <span
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                            BUCKET_TONE[r.bucket],
                          )}
                        >
                          {BUCKET_LABELS[r.bucket]}
                        </span>
                      </TableCell>
                      <TableCell className="text-[10px] font-mono whitespace-nowrap text-muted-foreground">
                        {[r.hintId ? "Hint" : null, r.elationId ? "Portal" : null]
                          .filter(Boolean)
                          .join(" + ") || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
