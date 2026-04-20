import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, Download, Loader2, RefreshCw, ShieldAlert, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type AuditRow = {
  id: string;
  created_at: string;
  user_id: string | null;
  user_email: string | null;
  source: string;
  resource: string | null;
  scope: string | null;
  resource_id: string | null;
  http_status: number | null;
  row_count: number | null;
  ip: string | null;
  user_agent: string | null;
};

const PAGE_SIZE = 200;
const ALL = "__all__";

function statusTone(status: number | null) {
  if (status === null) return "bg-muted text-muted-foreground border-border";
  if (status >= 200 && status < 300) return "bg-success/10 text-success border-success/30";
  if (status >= 400 && status < 500) return "bg-destructive/10 text-destructive border-destructive/30";
  if (status >= 500) return "bg-destructive/15 text-destructive border-destructive/40";
  return "bg-muted text-muted-foreground border-border";
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Admin-only PHI Audit Log viewer. Reads phi_access_log (RLS already
 * restricts SELECT to admins), supports filters and CSV export for
 * HIPAA review. Filters are applied server-side so the export reflects
 * exactly what's on screen, even when results exceed the page size.
 */
export default function PhiAuditLog() {
  const { roles } = useAuth();
  const isAdmin = roles.includes("admin");

  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [totalCount, setTotalCount] = useState<number | null>(null);

  const [emailFilter, setEmailFilter] = useState("");
  const [source, setSource] = useState<string>(ALL);
  const [from, setFrom] = useState<Date | undefined>();
  const [to, setTo] = useState<Date | undefined>();

  const [knownSources, setKnownSources] = useState<string[]>([]);
  const [knownEmails, setKnownEmails] = useState<string[]>([]);

  function applyFilters<T>(q: T): T {
    // q is a PostgrestFilterBuilder; chain filters dynamically.
    let query = q as unknown as {
      ilike: (c: string, v: string) => typeof query;
      eq: (c: string, v: string) => typeof query;
      gte: (c: string, v: string) => typeof query;
      lte: (c: string, v: string) => typeof query;
    };
    if (emailFilter.trim()) {
      query = query.ilike("user_email", `%${emailFilter.trim()}%`);
    }
    if (source !== ALL) {
      query = query.eq("source", source);
    }
    if (from) {
      query = query.gte("created_at", from.toISOString());
    }
    if (to) {
      // include the entire selected day
      const endOfDay = new Date(to);
      endOfDay.setHours(23, 59, 59, 999);
      query = query.lte("created_at", endOfDay.toISOString());
    }
    return query as unknown as T;
  }

  async function load() {
    setLoading(true);
    const base = supabase
      .from("phi_access_log")
      .select(
        "id, created_at, user_id, user_email, source, resource, scope, resource_id, http_status, row_count, ip, user_agent",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);
    const { data, error, count } = await applyFilters(base);
    if (error) {
      toast.error("Could not load audit log", { description: error.message });
      setLoading(false);
      return;
    }
    setRows((data as AuditRow[]) ?? []);
    setTotalCount(count ?? null);
    setLoading(false);
  }

  // Pre-load distinct sources + recent emails to populate filter dropdowns.
  async function loadFacets() {
    const { data } = await supabase
      .from("phi_access_log")
      .select("source, user_email, created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    const sources = new Set<string>();
    const emails = new Set<string>();
    (data ?? []).forEach((r) => {
      if (r.source) sources.add(r.source);
      if (r.user_email) emails.add(r.user_email);
    });
    setKnownSources([...sources].sort());
    setKnownEmails([...emails].sort());
  }

  useEffect(() => {
    if (isAdmin) {
      loadFacets();
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  function clearFilters() {
    setEmailFilter("");
    setSource(ALL);
    setFrom(undefined);
    setTo(undefined);
  }

  async function exportCsv() {
    setExporting(true);
    try {
      // Pull up to 5000 matching rows for export (avoid runaway downloads).
      const base = supabase
        .from("phi_access_log")
        .select(
          "created_at, user_email, user_id, source, resource, scope, resource_id, http_status, row_count, ip, user_agent",
        )
        .order("created_at", { ascending: false })
        .limit(5000);
      const { data, error } = await applyFilters(base);
      if (error) throw error;
      const headers = [
        "timestamp",
        "user_email",
        "user_id",
        "source",
        "resource",
        "scope",
        "resource_id",
        "http_status",
        "row_count",
        "ip",
        "user_agent",
      ];
      const lines = [headers.join(",")];
      for (const r of (data as AuditRow[]) ?? []) {
        lines.push(
          [
            r.created_at,
            r.user_email,
            r.user_id,
            r.source,
            r.resource,
            r.scope,
            r.resource_id,
            r.http_status,
            r.row_count,
            r.ip,
            r.user_agent,
          ]
            .map(csvEscape)
            .join(","),
        );
      }
      const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = format(new Date(), "yyyyMMdd-HHmmss");
      a.href = url;
      a.download = `phi-audit-log-${stamp}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${(data ?? []).length} rows`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error("Export failed", { description: msg });
    } finally {
      setExporting(false);
    }
  }

  const showingCount = rows.length;
  const truncated = totalCount !== null && totalCount > showingCount;

  const summary = useMemo(() => {
    const errors = rows.filter((r) => (r.http_status ?? 0) >= 400).length;
    const sources = new Set(rows.map((r) => r.source)).size;
    return { errors, sources };
  }, [rows]);

  if (!isAdmin) {
    return (
      <div className="bg-card border border-border rounded-2xl p-10 text-center">
        <ShieldAlert className="size-8 text-destructive mx-auto mb-3" />
        <h2 className="font-serif text-xl text-foreground">Admins only</h2>
        <p className="text-sm text-muted-foreground mt-2">
          The PHI audit log contains sensitive access metadata and is restricted to administrators.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filter bar */}
      <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              User email
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input
                value={emailFilter}
                onChange={(e) => setEmailFilter(e.target.value)}
                placeholder="contains…"
                list="audit-emails"
                className="pl-9 w-64"
              />
              <datalist id="audit-emails">
                {knownEmails.map((e) => (
                  <option key={e} value={e} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Source
            </label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger className="w-52">
                <SelectValue placeholder="All sources" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All sources</SelectItem>
                {knownSources.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              From
            </label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-44 justify-start text-left font-normal",
                    !from && "text-muted-foreground",
                  )}
                >
                  <CalendarIcon className="size-3.5 mr-2" />
                  {from ? format(from, "PP") : "Any time"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={from}
                  onSelect={setFrom}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              To
            </label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-44 justify-start text-left font-normal",
                    !to && "text-muted-foreground",
                  )}
                >
                  <CalendarIcon className="size-3.5 mr-2" />
                  {to ? format(to, "PP") : "Now"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={to}
                  onSelect={setTo}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <Button variant="outline" size="sm" onClick={clearFilters}>
              Clear
            </Button>
            <Button size="sm" onClick={load} disabled={loading}>
              {loading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              Apply
            </Button>
            <Button
              size="sm"
              variant="default"
              onClick={exportCsv}
              disabled={exporting || rows.length === 0}
            >
              {exporting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Download className="size-3.5" />
              )}
              Export CSV
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground font-mono">
          <span>
            Showing <strong className="text-foreground">{showingCount}</strong>
            {totalCount !== null && (
              <>
                {" "}of <strong className="text-foreground">{totalCount}</strong>
              </>
            )}{" "}
            matching events
          </span>
          <span>
            Errors: <strong className={summary.errors > 0 ? "text-destructive" : "text-foreground"}>
              {summary.errors}
            </strong>
          </span>
          <span>
            Distinct sources: <strong className="text-foreground">{summary.sources}</strong>
          </span>
          {truncated && (
            <span className="text-destructive">
              Page capped at {PAGE_SIZE} — narrow filters or export CSV (up to 5,000) for full review.
            </span>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin mr-2" />
            Loading audit log…
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-20 text-sm text-muted-foreground">
            No audit events match these filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">When</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Resource</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                  <TableHead className="text-right">Rows</TableHead>
                  <TableHead>IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs">
                      {format(new Date(r.created_at), "yyyy-MM-dd HH:mm:ss")}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.user_email ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {r.source}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      <span className="text-foreground">{r.resource ?? "—"}</span>
                      {r.resource_id && (
                        <span className="ml-1 text-muted-foreground font-mono">
                          /{r.resource_id}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground uppercase tracking-wider">
                      {r.scope ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge
                        variant="outline"
                        className={cn("font-mono text-[10px]", statusTone(r.http_status))}
                      >
                        {r.http_status ?? "—"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {r.row_count ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {r.ip ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
