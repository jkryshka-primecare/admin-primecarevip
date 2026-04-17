import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, AlertCircle, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Status = "checking" | "connected" | "awaiting" | "error";

type Probe = {
  status: Status;
  httpStatus?: number;
  message?: string;
  elapsedMs?: number;
};

const ElationStatusCard = () => {
  const [probe, setProbe] = useState<Probe>({ status: "checking" });

  useEffect(() => {
    let cancelled = false;
    const start = performance.now();
    // Use a tiny ping payload — the function will short-circuit at the
    // credentials check (503) without ever hitting Elation upstream.
    supabase.functions
      .invoke("elation-sandbox", {
        body: { resource: "patients", scope: "rest", method: "GET" },
      })
      .then(({ data, error }) => {
        if (cancelled) return;
        const elapsedMs = Math.round(performance.now() - start);

        // The Supabase JS client puts non-2xx responses on `error` (a
        // FunctionsHttpError) but the original JSON body is still in `data`.
        // Treat 503 + `configured: false` as the "awaiting credentials"
        // state, anything 2xx as connected, everything else as an error.
        const body = (data ?? null) as
          | { configured?: boolean; status?: number; error?: string }
          | null;

        if (!error && body && body.configured !== false) {
          setProbe({
            status: "connected",
            httpStatus: 200,
            elapsedMs,
          });
          return;
        }

        if (body && body.configured === false) {
          setProbe({
            status: "awaiting",
            httpStatus: 503,
            message: body.error,
            elapsedMs,
          });
          return;
        }

        setProbe({
          status: "error",
          message: error?.message ?? body?.error ?? "Unknown error",
          elapsedMs,
        });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const cfg = STATUS_CONFIG[probe.status];

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded border ${cfg.borderClass} ${cfg.bgClass}`}
    >
      <cfg.Icon
        className={`size-4 shrink-0 ${cfg.iconClass} ${
          probe.status === "checking" ? "animate-spin" : ""
        }`}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Elation Sandbox
          </span>
          <span
            className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border ${cfg.badgeClass}`}
          >
            {cfg.label}
          </span>
          {probe.httpStatus !== undefined && (
            <span className="text-[10px] font-mono text-muted-foreground">
              HTTP {probe.httpStatus}
            </span>
          )}
          {probe.elapsedMs !== undefined && (
            <span className="text-[10px] font-mono text-muted-foreground">
              · {probe.elapsedMs}ms
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">
          {cfg.description(probe.message)}
        </p>
      </div>
    </div>
  );
};

const STATUS_CONFIG: Record<
  Status,
  {
    label: string;
    Icon: typeof CheckCircle2;
    iconClass: string;
    bgClass: string;
    borderClass: string;
    badgeClass: string;
    description: (msg?: string) => string;
  }
> = {
  checking: {
    label: "Checking",
    Icon: Loader2,
    iconClass: "text-muted-foreground",
    bgClass: "bg-secondary/30",
    borderClass: "border-border",
    badgeClass: "bg-secondary text-muted-foreground border-border",
    description: () => "Pinging elation-sandbox edge function…",
  },
  connected: {
    label: "Connected",
    Icon: CheckCircle2,
    iconClass: "text-cyan-clinical",
    bgClass: "bg-cyan-clinical/5",
    borderClass: "border-cyan-clinical/30",
    badgeClass:
      "bg-cyan-clinical/15 text-cyan-clinical border-cyan-clinical/30",
    description: () =>
      "Elation OAuth credentials are configured. The proxy is reaching Elation's sandbox.",
  },
  awaiting: {
    label: "Awaiting Credentials",
    Icon: Clock,
    iconClass: "text-yellow-400",
    bgClass: "bg-yellow-500/5",
    borderClass: "border-yellow-500/30",
    badgeClass: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
    description: () =>
      "Edge function deployed. Add ELATION_SANDBOX_CLIENT_ID and ELATION_SANDBOX_CLIENT_SECRET secrets once Elation provisions sandbox access.",
  },
  error: {
    label: "Error",
    Icon: AlertCircle,
    iconClass: "text-hcc-alert",
    bgClass: "bg-hcc-alert/5",
    borderClass: "border-hcc-alert/30",
    badgeClass: "bg-hcc-alert/15 text-hcc-alert border-hcc-alert/30",
    description: (msg) => msg ?? "Elation status probe failed unexpectedly.",
  },
};

export default ElationStatusCard;
