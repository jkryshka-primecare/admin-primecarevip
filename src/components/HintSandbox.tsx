import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { HintScopeToggle } from "./hint-sandbox/HintScopeToggle";
import { HintResourceTabs } from "./hint-sandbox/HintResourceTabs";
import { HintSearchBar } from "./hint-sandbox/HintSearchBar";
import { HintRecordsTable } from "./hint-sandbox/HintRecordsTable";
import { HintDetailDrawer } from "./hint-sandbox/HintDetailDrawer";
import {
  PAGINATED_RESOURCES,
  RESOURCES_BY_SCOPE,
  SCOPE_BASE_PATH,
  SEARCHABLE_RESOURCES,
  extractRecords,
  type HintResource,
  type HintResponse,
  type HintScope,
} from "./hint-sandbox/types";

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

  // Monotonic request counter — only the latest in-flight load may mutate
  // state. This prevents a stale 404 (e.g. from the snap-to-resource effect
  // firing partner/patients before partner/practices) from overwriting the
  // newer successful response.
  const requestIdRef = useRef(0);

  const load = useCallback(
    async (
      which: HintResource,
      whichScope: HintScope,
      nextLimit: number,
      nextOffset: number,
      nextSearch: string,
    ) => {
      const requestId = ++requestIdRef.current;
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
        // Drop stale responses — a newer load has superseded this one.
        if (requestId !== requestIdRef.current) return;
        if (invokeError) throw invokeError;
        if (!data) throw new Error("Empty response from Hint sandbox");
        setResponse(data);
        if (data.status >= 400) {
          toast.error(`Hint API returned ${data.status}`);
        } else {
          toast.success(`Hint ${whichScope}/${which} fetched in ${data.elapsedMs}ms`);
        }
      } catch (e) {
        if (requestId !== requestIdRef.current) return;
        const msg = e instanceof Error ? e.message : "Unknown error";
        setError(msg);
        toast.error(msg);
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
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
        // Share the patient-detail cache with MedicationStats so reopening
        // the same patient is instant across views.
        const useCache = which === "patients" && whichScope === "practice";
        const fetcher = async (): Promise<HintResponse> => {
          const { data, error: invokeError } = await supabase.functions.invoke<HintResponse>(
            "hint-sandbox",
            { body: { resource: which, id, scope: whichScope, method: "GET" } },
          );
          if (invokeError) throw invokeError;
          if (!data) throw new Error("Empty response from Hint sandbox");
          return data;
        };
        const data = useCache
          ? await queryClient.fetchQuery<HintResponse>({
              queryKey: ["hint", "patients", "detail", id],
              queryFn: fetcher,
              staleTime: 5 * 60 * 1000,
            })
          : await fetcher();
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
    [queryClient],
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
  const total = response?.pagination?.total ?? null;

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
          <HintScopeToggle scope={scope} onChange={setScope} />
          <HintResourceTabs
            scope={scope}
            resource={resource}
            loading={loading}
            onResourceChange={setResource}
            onRefresh={() => load(resource, scope, limit, offset, search)}
          />
        </div>
      </div>

      {/* Search (only for resources Hint supports `q` on) */}
      {SEARCHABLE_RESOURCES.has(resource) && (
        <HintSearchBar
          resource={resource}
          inputValue={searchInput}
          committedValue={search}
          onInputChange={setSearchInput}
        />
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
          value={
            records
              ? total !== null
                ? `${records.length} of ${total}`
                : records.length.toString()
              : "—"
          }
        />
        <SummaryCard label="Resource" value={resource} mono />
        <SummaryCard
          label="Latency"
          value={response ? `${response.elapsedMs} ms` : "—"}
        />
      </div>

      {/* Records table */}
      <HintRecordsTable
        resource={resource}
        records={records}
        loading={loading}
        total={total}
        limit={limit}
        offset={offset}
        onLimitChange={(n) => {
          setLimit(n);
          setOffset(0);
        }}
        onOffsetChange={setOffset}
        onRowClick={(row) => {
          const id = typeof row.id === "string" ? row.id : null;
          if (!id) {
            toast.error("Row has no id field");
            return;
          }
          loadDetail(resource, scope, id);
        }}
      />

      {/* Detail drawer */}
      <HintDetailDrawer
        open={detailOpen}
        resource={resource}
        detailId={detailId}
        detail={detail}
        loading={detailLoading}
        onClose={() => setDetailOpen(false)}
      />

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

export default HintSandbox;
