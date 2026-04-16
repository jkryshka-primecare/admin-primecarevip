import { Fragment, useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type HintScope = "practice" | "partner";
type HintResource =
  | "patients"
  | "memberships"
  | "invoices"
  | "plans"
  | "practice"
  | "practices"
  | "partner";

interface HintResponse {
  source: string;
  upstream: string;
  scope: string;
  status: number;
  elapsedMs: number;
  generated: string;
  data: unknown;
}

// Resources available per scope. The Practice (provider) API exposes the
// day-to-day clinic resources; the Partner API in Hint's staging sandbox
// only exposes a list of integrated practices and the partner record itself.
const RESOURCES_BY_SCOPE: Record<HintScope, { id: HintResource; label: string }[]> = {
  practice: [
    { id: "patients", label: "Patients" },
    { id: "memberships", label: "Memberships" },
    { id: "invoices", label: "Invoices" },
    { id: "plans", label: "Plans" },
    { id: "practice", label: "Practice" },
  ],
  partner: [
    { id: "practices", label: "Practices" },
    { id: "partner", label: "Partner" },
  ],
};

const SCOPE_BASE_PATH: Record<HintScope, string> = {
  practice: "api.staging.hint.com/api/provider",
  partner: "api.staging.hint.com/api/partner",
};

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
const PAGINATED_RESOURCES = new Set<HintResource>([
  "patients",
  "memberships",
  "invoices",
  "plans",
  "practices",
]);
// Hint's API supports a `q` text-search param on these list endpoints.
const SEARCHABLE_RESOURCES = new Set<HintResource>(["patients", "memberships"]);

const HintSandbox = () => {
  const [scope, setScope] = useState<HintScope>("practice");
  const [resource, setResource] = useState<HintResource>("patients");
  const [response, setResponse] = useState<HintResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pagination state (Hint uses limit + offset; default 10, max 100)
  const [limit, setLimit] = useState(10);
  const [offset, setOffset] = useState(0);

  // Search state (Hint's `q` param, debounced before firing)
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  // Detail drawer state
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<HintResponse | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback(
    async (
      which: HintResource,
      whichScope: HintScope,
      nextLimit: number,
      nextOffset: number,
      nextSearch: string,
    ) => {
      setLoading(true);
      setError(null);
      try {
        const query: Record<string, string | number> = {};
        if (PAGINATED_RESOURCES.has(which)) {
          query.limit = nextLimit;
          query.offset = nextOffset;
        }
        if (SEARCHABLE_RESOURCES.has(which) && nextSearch.trim()) {
          query.q = nextSearch.trim();
        }
        const { data, error: invokeError } = await supabase.functions.invoke<HintResponse>(
          "hint-sandbox",
          {
            body: {
              resource: which,
              scope: whichScope,
              method: "GET",
              query: Object.keys(query).length > 0 ? query : undefined,
            },
          },
        );
        if (invokeError) throw invokeError;
        if (!data) throw new Error("Empty response from Hint sandbox");
        setResponse(data);
        if (data.status >= 400) {
          toast.error(`Hint API returned ${data.status}`);
        } else {
          toast.success(`Hint ${whichScope}/${which} fetched in ${data.elapsedMs}ms`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        setError(msg);
        toast.error(msg);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const loadDetail = useCallback(
    async (which: HintResource, whichScope: HintScope, id: string) => {
      setDetailOpen(true);
      setDetailId(id);
      setDetail(null);
      setDetailLoading(true);
      try {
        const { data, error: invokeError } = await supabase.functions.invoke<HintResponse>(
          "hint-sandbox",
          { body: { resource: which, id, scope: whichScope, method: "GET" } },
        );
        if (invokeError) throw invokeError;
        if (!data) throw new Error("Empty response from Hint sandbox");
        setDetail(data);
        if (data.status >= 400) toast.error(`Hint ${which}/${id} returned ${data.status}`);
        else toast.success(`${which}/${id} fetched in ${data.elapsedMs}ms`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        toast.error(msg);
      } finally {
        setDetailLoading(false);
      }
    },
    [],
  );

  // When scope changes, snap to that scope's first available resource.
  useEffect(() => {
    const available = RESOURCES_BY_SCOPE[scope];
    if (!available.some((r) => r.id === resource)) {
      setResource(available[0].id);
    }
  }, [scope, resource]);

  // Reset offset & search whenever the resource changes.
  useEffect(() => {
    setOffset(0);
    setSearchInput("");
    setSearch("");
  }, [resource]);

  // Debounce search input → committed search value (350ms).
  useEffect(() => {
    const handle = setTimeout(() => {
      setSearch(searchInput);
      setOffset(0);
    }, 350);
    return () => clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    load(resource, scope, limit, offset, search);
  }, [resource, scope, limit, offset, search, load]);

  const records = extractRecords(response?.data, resource);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-light tracking-tight text-foreground">
              Hint Health · Staging Sandbox
            </h2>
            <span className="px-2.5 py-0.5 rounded bg-cyan-clinical/10 text-cyan-clinical border border-cyan-clinical/20 text-[10px] font-bold tracking-widest uppercase">
              Live API
            </span>
          </div>
          <p className="text-xs text-muted-foreground font-mono">
            {SCOPE_BASE_PATH[scope]}
            {response && (
              <>
                <span className="mx-2 text-border">·</span>
                <span>{response.elapsedMs}ms</span>
                <span className="mx-2 text-border">·</span>
                <span>HTTP {response.status}</span>
                <span className="mx-2 text-border">·</span>
                <span>{new Date(response.generated).toLocaleTimeString()}</span>
              </>
            )}
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          {/* Scope toggle: Practice (provider) vs Partner */}
          <div className="flex items-center gap-1 p-0.5 rounded border border-border bg-secondary/30">
            {(["practice", "partner"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className={
                  "px-2.5 py-1 rounded text-[10px] font-bold tracking-widest uppercase transition-colors " +
                  (scope === s
                    ? "bg-sapphire/15 text-sapphire"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                {s}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            {RESOURCES_BY_SCOPE[scope].map((r) => (
              <button
                key={r.id}
                onClick={() => setResource(r.id)}
                className={
                  "px-3 py-1.5 rounded text-[10px] font-bold tracking-widest uppercase border transition-colors " +
                  (resource === r.id
                    ? "bg-sapphire/10 text-sapphire border-sapphire/30"
                    : "text-muted-foreground border-border hover:text-foreground")
                }
              >
                {r.label}
              </button>
            ))}
            <button
              onClick={() => load(resource, scope, limit, offset, search)}
              disabled={loading}
              className="px-3 py-1.5 rounded text-[10px] font-bold tracking-widest uppercase border border-border text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCw className={"size-3 " + (loading ? "animate-spin" : "")} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Search (only for resources Hint supports `q` on) */}
      {SEARCHABLE_RESOURCES.has(resource) && (
        <div className="flex items-center gap-3">
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Search
          </label>
          <div className="relative flex-1 max-w-md">
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={`Search ${resource} by name, email, ID…`}
              className="w-full bg-background border border-border rounded px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-sapphire/50 focus:ring-1 focus:ring-sapphire/30"
            />
            {searchInput && (
              <button
                onClick={() => setSearchInput("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs px-1"
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>
          {search && (
            <span className="text-[10px] font-mono text-muted-foreground">
              q=<span className="text-sapphire">{search}</span>
            </span>
          )}
        </div>
      )}

      {/* Status / error */}
      {error && (
        <div className="p-4 rounded border border-hcc-alert/30 bg-hcc-alert/5 text-hcc-alert text-sm">
          {error}
        </div>
      )}

      {/* Records summary */}
      <div className="grid grid-cols-3 gap-4">
        <SummaryCard
          label="Records returned"
          value={records ? records.length.toString() : "—"}
        />
        <SummaryCard label="Resource" value={resource} mono />
        <SummaryCard
          label="Latency"
          value={response ? `${response.elapsedMs} ms` : "—"}
        />
      </div>

      {/* Records table */}
      <div className="border border-border rounded overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-4 flex-wrap bg-secondary/30">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {resource}
            {PAGINATED_RESOURCES.has(resource) && (
              <>
                {" · showing "}
                {records?.length ?? 0}
                {" · offset "}
                {offset}
                {"–"}
                {offset + (records?.length ?? 0)}
              </>
            )}
          </span>

          <div className="flex items-center gap-2">
            {loading && <Loader2 className="size-3 animate-spin text-muted-foreground" />}

            {PAGINATED_RESOURCES.has(resource) && (
              <>
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Page size
                </label>
                <select
                  value={limit}
                  onChange={(e) => {
                    setLimit(Number(e.target.value));
                    setOffset(0);
                  }}
                  disabled={loading}
                  className="bg-background border border-border rounded px-2 py-1 text-xs font-mono text-foreground disabled:opacity-50"
                >
                  {PAGE_SIZE_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>

                <button
                  onClick={() => setOffset(Math.max(0, offset - limit))}
                  disabled={loading || offset === 0}
                  className="px-3 py-1.5 rounded text-[10px] font-bold tracking-widest uppercase border border-border text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  ← Prev
                </button>
                <button
                  onClick={() => setOffset(offset + limit)}
                  disabled={
                    loading || !records || records.length < limit
                  }
                  className="px-3 py-1.5 rounded text-[10px] font-bold tracking-widest uppercase border border-border text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Next →
                </button>
              </>
            )}
          </div>
        </div>

        {records && records.length > 0 ? (
          <RecordsTable
            records={records}
            onRowClick={(row) => {
              const id = typeof row.id === "string" ? row.id : null;
              if (!id) {
                toast.error("Row has no id field");
                return;
              }
              loadDetail(resource, scope, id);
            }}
          />
        ) : (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {loading ? "Fetching from Hint..." : "No records to display."}
          </div>
        )}
      </div>

      {/* Detail drawer */}
      {detailOpen && (
        <div
          className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-start justify-end"
          onClick={() => setDetailOpen(false)}
        >
          <div
            className="h-full w-full max-w-2xl bg-card border-l border-border overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-border flex items-center justify-between sticky top-0 bg-card z-10">
              <div className="space-y-1">
                <div className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">
                  {resource} detail
                </div>
                <div className="text-sm font-mono text-foreground">{detailId}</div>
                {detail && (
                  <div className="text-[10px] font-mono text-muted-foreground">
                    {detail.upstream.replace("https://", "")} · {detail.elapsedMs}ms · HTTP{" "}
                    {detail.status}
                  </div>
                )}
              </div>
              <button
                onClick={() => setDetailOpen(false)}
                className="px-3 py-1.5 rounded text-[10px] font-bold tracking-widest uppercase border border-border text-muted-foreground hover:text-foreground"
              >
                Close
              </button>
            </div>
            <div className="p-6">
              {detailLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Fetching {resource}/{detailId}…
                </div>
              ) : detail ? (
                <DetailView data={detail.data} />
              ) : (
                <div className="text-sm text-muted-foreground">No data.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Raw JSON */}
      <details className="border border-border rounded">
        <summary className="px-4 py-3 cursor-pointer text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground">
          Raw JSON response
        </summary>
        <pre className="p-4 text-[11px] font-mono text-muted-foreground overflow-auto max-h-96 bg-secondary/20">
          {response ? JSON.stringify(response.data, null, 2) : "—"}
        </pre>
      </details>
    </div>
  );
};

const SummaryCard = ({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) => (
  <div className="p-4 border border-border rounded bg-slate-glass">
    <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
      {label}
    </div>
    <div
      className={
        "mt-1 text-foreground " +
        (mono ? "font-mono text-sm" : "text-xl font-light tracking-tight")
      }
    >
      {value}
    </div>
  </div>
);

const RecordsTable = ({
  records,
  onRowClick,
}: {
  records: Record<string, unknown>[];
  onRowClick?: (row: Record<string, unknown>) => void;
}) => {
  const columns = pickColumns(records);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-secondary/20 border-b border-border">
          <tr>
            {columns.map((c) => (
              <th
                key={c}
                className="text-left px-4 py-2 font-bold tracking-widest uppercase text-[10px] text-muted-foreground"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.slice(0, 25).map((row, i) => {
            const clickable = !!onRowClick && typeof row.id === "string";
            return (
              <tr
                key={i}
                onClick={clickable ? () => onRowClick!(row) : undefined}
                className={
                  "border-b border-border/50 transition-colors " +
                  (clickable ? "cursor-pointer hover:bg-sapphire/10" : "hover:bg-secondary/20")
                }
              >
                {columns.map((c) => (
                  <td key={c} className="px-4 py-2 text-foreground font-mono">
                    {formatCell(row[c])}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const DetailView = ({ data }: { data: unknown }) => {
  if (!data || typeof data !== "object") {
    return (
      <pre className="text-[11px] font-mono text-muted-foreground whitespace-pre-wrap">
        {String(data ?? "—")}
      </pre>
    );
  }
  const entries = Object.entries(data as Record<string, unknown>).filter(
    ([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0),
  );
  return (
    <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2 text-xs">
      {entries.map(([k, v]) => (
        <Fragment key={k}>
          <dt className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground pt-0.5">
            {k}
          </dt>
          <dd className="font-mono text-foreground break-all">
            {typeof v === "object" ? (
              <pre className="text-[11px] text-muted-foreground whitespace-pre-wrap">
                {JSON.stringify(v, null, 2)}
              </pre>
            ) : (
              String(v)
            )}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
};

function extractRecords(
  data: unknown,
  resource?: HintResource,
): Record<string, unknown>[] | null {
  if (!data) return null;
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (typeof data === "object") {
    const obj = data as Record<string, unknown>;
    // Practice is a single resource — render as one row, not its phones[] array.
    if (resource === "practice") return [obj];
    // Hint sometimes wraps list responses with { patients: [...] } etc.
    for (const v of Object.values(obj)) {
      if (Array.isArray(v)) return v as Record<string, unknown>[];
    }
    return [obj];
  }
  return null;
}

function pickColumns(records: Record<string, unknown>[]): string[] {
  if (records.length === 0) return [];
  const first = records[0];
  const preferred = [
    "id",
    "first_name",
    "last_name",
    "email",
    "name",
    "status",
    "amount",
    "amount_cents",
    "created_at",
    "start_date",
    "end_date",
  ];
  const present = preferred.filter((p) => p in first);
  if (present.length >= 3) return present.slice(0, 6);
  return Object.keys(first).slice(0, 6);
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v).slice(0, 60);
  return String(v);
}

export default HintSandbox;
