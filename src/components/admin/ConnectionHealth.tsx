import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";

type Probe = {
  key: string;
  label: string;
  fn: "elation-live" | "hint-live";
  body: Record<string, unknown>;
  hint: string;
};

const PROBES: Probe[] = [
  {
    key: "elation-rest",
    label: "Elation REST (production)",
    fn: "elation-live",
    body: { resource: "practices", scope: "rest", query: { limit: 1 } },
    hint: "OAuth2 client credentials · app.elationemr.com/api/2.0",
  },
  {
    key: "elation-fhir",
    label: "Elation FHIR (production)",
    fn: "elation-live",
    body: { resource: "Patient", scope: "fhir", query: { _count: 1 } },
    hint: "fhir.elationemr.com — optional, REST covers all dashboards",
  },
  {
    key: "hint-practice",
    label: "Hint — practice scope",
    fn: "hint-live",
    body: { resource: "patients", scope: "practice", query: { limit: 1 } },
    hint: "HINT_PRACTICE_API_KEY · api.hint.com/api/provider",
  },
  {
    key: "hint-partner",
    label: "Hint — partner scope",
    fn: "hint-live",
    body: { resource: "practices", scope: "partner", query: { limit: 1 } },
    hint: "HINT_PARTNER_API_KEY · optional, not used by dashboards",
  },
];

type Result = {
  status?: number;
  ok: boolean;
  elapsedMs?: number;
  message?: string;
  checkedAt: string;
};

export default function ConnectionHealth() {
  const [results, setResults] = useState<Record<string, Result>>({});
  const [running, setRunning] = useState<Record<string, boolean>>({});

  const runProbe = useCallback(async (probe: Probe) => {
    setRunning((r) => ({ ...r, [probe.key]: true }));
    try {
      const { data, error } = await supabase.functions.invoke(probe.fn, { body: probe.body });
      if (error) throw error;
      const payload = data as {
        ok?: boolean;
        status?: number;
        elapsedMs?: number;
        error?: string;
        data?: unknown;
      };
      setResults((r) => ({
        ...r,
        [probe.key]: {
          ok: Boolean(payload?.ok),
          status: payload?.status,
          elapsedMs: payload?.elapsedMs,
          message:
            payload?.error ??
            (typeof payload?.data === "object" && payload?.data !== null
              ? (payload.data as { message?: string }).message
              : undefined),
          checkedAt: new Date().toISOString(),
        },
      }));
    } catch (e) {
      setResults((r) => ({
        ...r,
        [probe.key]: {
          ok: false,
          message: e instanceof Error ? e.message : "Request failed",
          checkedAt: new Date().toISOString(),
        },
      }));
    } finally {
      setRunning((r) => ({ ...r, [probe.key]: false }));
    }
  }, []);

  const runAll = useCallback(() => {
    PROBES.forEach((p) => runProbe(p));
  }, [runProbe]);

  useEffect(() => {
    runAll();
  }, [runAll]);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-serif text-lg text-foreground">Connection health</h2>
          <p className="text-xs text-muted-foreground">
            Live probes against the production integrations. No PHI is stored by this check.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={runAll}>
          <RefreshCw className="mr-2 h-3.5 w-3.5" /> Test all
        </Button>
      </div>

      <div className="space-y-2">
        {PROBES.map((probe) => {
          const res = results[probe.key];
          const busy = running[probe.key];
          return (
            <div
              key={probe.key}
              className="flex items-start justify-between gap-4 rounded-xl border border-border bg-card px-5 py-4 shadow-soft"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : res?.ok ? (
                    <CheckCircle2 className="h-4 w-4 text-success" />
                  ) : res ? (
                    <XCircle className="h-4 w-4 text-destructive" />
                  ) : (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                  <p className="text-sm font-medium text-card-foreground">{probe.label}</p>
                  {res?.status !== undefined && (
                    <span className="font-mono text-xs text-muted-foreground">
                      HTTP {res.status}
                      {res.elapsedMs !== undefined ? ` · ${res.elapsedMs}ms` : ""}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{probe.hint}</p>
                {res && !res.ok && res.message && (
                  <p className="mt-1 text-xs text-destructive">{res.message}</p>
                )}
                {res && (
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                    Checked {new Date(res.checkedAt).toLocaleTimeString()}
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => runProbe(probe)}
                className="shrink-0"
              >
                Test now
              </Button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
