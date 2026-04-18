import { Fragment } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import type { HintResource, HintResponse } from "./types";

interface Props {
  open: boolean;
  resource: HintResource;
  detailId: string | null;
  detail: HintResponse | null;
  loading: boolean;
  onClose: () => void;
}

export const HintDetailDrawer = ({
  open,
  resource,
  detailId,
  detail,
  loading,
  onClose,
}: Props) => {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-start justify-end"
      onClick={onClose}
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
          <div className="flex items-center gap-2">
            {(() => {
              const link =
                detail && typeof detail.data === "object" && detail.data !== null
                  ? (detail.data as Record<string, unknown>).provider_web_link
                  : null;
              if (typeof link !== "string" || !link) return null;
              return (
                <a
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-bold tracking-widest uppercase border border-accent/30 bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
                >
                  <ExternalLink className="size-3" />
                  View in Hint
                </a>
              );
            })()}
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded text-[10px] font-bold tracking-widest uppercase border border-border text-muted-foreground hover:text-foreground"
            >
              Close
            </button>
          </div>
        </div>
        <div className="p-6">
          {loading ? (
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
    ([, v]) =>
      v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0),
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
