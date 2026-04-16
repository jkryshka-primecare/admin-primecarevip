import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type HintResource = "patients" | "memberships" | "invoices" | "plans" | "practice";

interface HintResponse {
  source: string;
  upstream: string;
  scope: string;
  status: number;
  elapsedMs: number;
  generated: string;
  data: unknown;
}

const RESOURCES: { id: HintResource; label: string }[] = [
  { id: "patients", label: "Patients" },
  { id: "memberships", label: "Memberships" },
  { id: "invoices", label: "Invoices" },
  { id: "plans", label: "Plans" },
  { id: "practice", label: "Practice" },
];

const HintSandbox = () => {
  const [resource, setResource] = useState<HintResource>("patients");
  const [response, setResponse] = useState<HintResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (which: HintResource) => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke<HintResponse>(
        "hint-sandbox",
        {
          body: {
            resource: which,
            scope: "practice",
            method: "GET",
            query: which === "practice" ? undefined : { page: 1, per_page: 25 },
          },
        },
      );
      if (invokeError) throw invokeError;
      if (!data) throw new Error("Empty response from Hint sandbox");
      setResponse(data);
      if (data.status >= 400) {
        toast.error(`Hint API returned ${data.status}`);
      } else {
        toast.success(`Hint ${which} fetched in ${data.elapsedMs}ms`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(resource);
  }, [resource, load]);

  const records = extractRecords(response?.data);

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
            provider.staging.hint.com/api/provider/v1
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

        <div className="flex items-center gap-2">
          {RESOURCES.map((r) => (
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
            onClick={() => load(resource)}
            disabled={loading}
            className="px-3 py-1.5 rounded text-[10px] font-bold tracking-widest uppercase border border-border text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5 disabled:opacity-50"
          >
            <RefreshCw className={"size-3 " + (loading ? "animate-spin" : "")} />
            Refresh
          </button>
        </div>
      </div>

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
        <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-secondary/30">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {resource} · first {records?.length ?? 0} records
          </span>
          {loading && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
        </div>

        {records && records.length > 0 ? (
          <RecordsTable records={records} />
        ) : (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {loading ? "Fetching from Hint..." : "No records to display."}
          </div>
        )}
      </div>

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

const RecordsTable = ({ records }: { records: Record<string, unknown>[] }) => {
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
          {records.slice(0, 25).map((row, i) => (
            <tr
              key={i}
              className="border-b border-border/50 hover:bg-secondary/20"
            >
              {columns.map((c) => (
                <td key={c} className="px-4 py-2 text-foreground font-mono">
                  {formatCell(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

function extractRecords(data: unknown): Record<string, unknown>[] | null {
  if (!data) return null;
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (typeof data === "object") {
    const obj = data as Record<string, unknown>;
    // Hint sometimes wraps with { patients: [...] } etc.
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
