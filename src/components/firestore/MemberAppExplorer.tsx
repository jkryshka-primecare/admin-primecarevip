import { Fragment, useMemo, useState } from "react";
import { AlertCircle, Database, Loader2, RefreshCw, Search } from "lucide-react";
import { useFirestoreList, type FirestoreCollection } from "@/hooks/useFirestore";
import MemberRoster from "@/components/firestore/MemberRoster";
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

const COLLECTIONS: { id: FirestoreCollection; label: string }[] = [
  { id: "patients", label: "Members" },
  { id: "appointment_requests", label: "Appointment requests" },
  { id: "pharmacy_orders", label: "Pharmacy orders" },
  { id: "chat_conversations", label: "Conversations" },
  { id: "directory", label: "Directory" },
  { id: "locations", label: "Locations" },
  { id: "family", label: "Family" },
  { id: "onboard_fees", label: "Onboarding fees" },
];

// Columns worth surfacing, in preference order. Anything else is hidden to
// keep rows readable; the raw document is still one click away.
const PREFERRED = [
  "id",
  "firstName",
  "lastName",
  "name",
  "email",
  "phone",
  "status",
  "type",
  "requestedAt",
  "scheduledFor",
  "createdAt",
];

type StatusFilter = "all" | "active" | "invited" | "other";

function cell(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "object") return Array.isArray(v) ? `${v.length} item(s)` : "{…}";
  return String(v);
}

function bucketOf(doc: Record<string, unknown>): Exclude<StatusFilter, "all"> {
  const s = String(doc.status ?? "").toLowerCase();
  if (s === "active") return "active";
  if (s === "invited") return "invited";
  return "other";
}

/**
 * Generic read-only browser for member-app collections.
 * The bridge exposes no write path, so nothing here can alter live data.
 */
export default function MemberAppExplorer() {
  const [active, setActive] = useState<FirestoreCollection>("patients");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");

  const { docs, loading, fetching, error, refetch } = useFirestoreList(active, {
    fetchAll: true,
  });

  const hasStatus = useMemo(() => docs.some((d) => "status" in d), [docs]);

  const counts = useMemo(() => {
    const c = { all: docs.length, active: 0, invited: 0, other: 0 };
    for (const d of docs) c[bucketOf(d as Record<string, unknown>)] += 1;
    return c;
  }, [docs]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return docs.filter((d) => {
      const rec = d as Record<string, unknown>;
      if (hasStatus && status !== "all" && bucketOf(rec) !== status) return false;
      if (!q) return true;
      return Object.values(rec).some(
        (v) => (typeof v === "string" || typeof v === "number") &&
          String(v).toLowerCase().includes(q),
      );
    });
  }, [docs, status, search, hasStatus]);

  const columns = useMemo(() => {
    const present = new Set<string>();
    for (const d of docs) {
      for (const k of Object.keys(d)) if (!k.startsWith("_")) present.add(k);
    }
    const ordered = PREFERRED.filter((k) => present.has(k));
    const rest = [...present].filter((k) => !PREFERRED.includes(k)).sort();
    return [...ordered, ...rest].slice(0, 7);
  }, [docs]);


  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-serif text-xl text-foreground">Member app data</h2>
          <p className="text-xs text-muted-foreground">
            Live from the member apps · read-only, no writes possible
          </p>
        </div>
        <Button variant="outline" size="icon" onClick={() => refetch()} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <div className="flex flex-wrap gap-1 bg-card border border-border rounded-full p-1 shadow-soft w-fit">
        {COLLECTIONS.map((c) => (
          <button
            key={c.id}
            onClick={() => {
              setActive(c.id);
              setExpanded(null);
              setStatus("all");
              setSearch("");
            }}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
              active === c.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {hasStatus && (
          <div className="flex flex-wrap gap-1 bg-muted/50 border border-border rounded-full p-1 w-fit">
            {([
              { id: "all", label: "All" },
              { id: "active", label: "Active" },
              { id: "invited", label: "Invited" },
              { id: "other", label: "Other" },
            ] as const).map((f) => (
              <button
                key={f.id}
                onClick={() => setStatus(f.id)}
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-medium transition-colors",
                  status === f.id
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label}
                <span className="ml-1.5 font-mono text-[10px] opacity-70">{counts[f.id]}</span>
              </button>
            ))}
          </div>
        )}
        <div className="relative min-w-[220px] flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, phone or ID…"
            className="h-9 pl-8 text-xs"
          />
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="h-4 w-4" />
            {COLLECTIONS.find((c) => c.id === active)?.label}
            {!loading && !error && (
              <Badge variant="secondary" className="font-mono text-[10px]">
                {rows.length.toLocaleString()}
                {rows.length !== docs.length && ` / ${docs.length.toLocaleString()}`}
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
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {docs.length === 0
                ? "This collection has no documents in the live member apps yet."
                : "No records match the current filter or search."}
            </p>
          ) : (
            <>
              <p className="pb-2 text-xs text-muted-foreground">
                Showing {rows.length.toLocaleString()} of {docs.length.toLocaleString()}
              </p>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {columns.map((c) => (
                        <TableHead key={c} className="whitespace-nowrap">
                          {c}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((d) => (
                      <Fragment key={String(d.id)}>
                        <TableRow
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() =>
                            setExpanded(expanded === String(d.id) ? null : String(d.id))
                          }
                        >
                          {columns.map((c) => (
                            <TableCell key={c} className="text-xs whitespace-nowrap">
                              {cell((d as Record<string, unknown>)[c])}
                            </TableCell>
                          ))}
                        </TableRow>
                        {expanded === String(d.id) && (
                          <TableRow>
                            <TableCell colSpan={columns.length} className="bg-muted/40">
                              <pre className="max-h-72 overflow-auto text-[11px] font-mono whitespace-pre-wrap">
                                {JSON.stringify(d, null, 2)}
                              </pre>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}

        </CardContent>
      </Card>
      </>
      )}
    </div>
  );
}
