import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, AlertCircle, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Status = "checking" | "connected" | "awaiting" | "error";
type Env = "live" | "sandbox";

type Probe = {
  status: Status;
  httpStatus?: number;
  message?: string;
  elapsedMs?: number;
};

const ElationStatusCard = () => {
  const [env, setEnv] = useState<Env>("sandbox");
  const [probe, setProbe] = useState<Probe>({ status: "checking" });

  useEffect(() => {
    let cancelled = false;
    setProbe({ status: "checking" });
    const start = performance.now();
    const fnName = env === "live" ? "elation-live" : "elation-sandbox";

    supabase.functions
      .invoke(fnName, {
        body: { resource: "patients", scope: "rest", method: "GET" },
      })
      .then(({ data, error }) => {
        if (cancelled) return;
        const elapsedMs = Math.round(performance.now() - start);

        const body = (data ?? null) as
          | { configured?: boolean; status?: number; error?: string }
          | null;

        if (!error && body && body.configured !== false) {
          setProbe({ status: "connected", httpStatus: 200, elapsedMs });
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
  }, [env]);

  const cfg = STATUS_CONFIG[probe.status];
  const envLabel = env === "live" ? "Elation Live · Read-Only" : "Elation Sandbox · Read-Only";

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
            {envLabel}
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

      {/* Env toggle — small segmented control */}
      <div className="flex items-center rounded border border-border overflow-hidden shrink-0">
        <button
          type="button"
          onClick={() => setEnv("sandbox")}
          className={`px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors ${
            env === "sandbox"
              ? "bg-primary text-primary-foreground"
              : "bg-background text-muted-foreground hover:bg-secondary"
          }`}
          aria-pressed={env === "sandbox"}
        >
          Sandbox
        </button>
        <button
          type="button"
          onClick={() => setEnv("live")}
          className={`px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors ${
            env === "live"
              ? "bg-primary text-primary-foreground"
              : "bg-background text-muted-foreground hover:bg-secondary"
          }`}
          aria-pressed={env === "live"}
        >
          Live
        </button>
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
    description: () => "Pinging Elation edge function…",
  },
  connected: {
    label: "Connected",
    Icon: CheckCircle2,
    iconClass: "text-success",
    bgClass: "bg-success/5",
    borderClass: "border-success/30",
    badgeClass: "bg-success/15 text-success border-success/30",
    description: () =>
      "Elation OAuth credentials are configured. The proxy is reaching Elation.",
  },
  awaiting: {
    label: "Awaiting Credentials",
    Icon: Clock,
    iconClass: "text-accent",
    bgClass: "bg-accent/5",
    borderClass: "border-accent/30",
    badgeClass: "bg-accent/15 text-accent border-accent/30",
    description: (msg) =>
      msg ?? "Add the Elation OAuth credentials as Cloud secrets to enable this environment.",
  },
  error: {
    label: "Error",
    Icon: AlertCircle,
    iconClass: "text-destructive",
    bgClass: "bg-destructive/5",
    borderClass: "border-destructive/30",
    badgeClass: "bg-destructive/15 text-destructive border-destructive/30",
    description: (msg) => msg ?? "Elation status probe failed unexpectedly.",
  },
};

export default ElationStatusCard;
