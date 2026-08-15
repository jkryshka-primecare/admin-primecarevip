import { Fragment, useMemo, useState } from "react";
import { AlertCircle, Database, Loader2, RefreshCw } from "lucide-react";
import { useFirestoreList, type FirestoreCollection } from "@/hooks/useFirestore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

function cell(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "object") return Array.isArray(v) ? `${v.length} item(s)` : "{…}";
  return String(v);
}

/**
 * Generic read-only browser for member-app collections.
 * The bridge exposes no write path, so nothing here can alter live data.
 */
export default function MemberAppExplorer() {
  const [active, setActive] = useState<FirestoreCollection>("patients");
  const [expanded, setExpanded] = useState<string | null>(null);

  const { docs, loading, error, refetch } = useFirestoreList(active, { limit: 100 });

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

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="h-4 w-4" />
            {COLLECTIONS.find((c) => c.id === active)?.label}
            {!loading && !error && (
              <Badge variant="secondary" className="font-mono text-[10px]">
                {docs.length}
              </Badge>
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
          ) : docs.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              This collection has no documents in the live member apps yet.
            </p>
          ) : (
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
                  {docs.map((d) => (
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
