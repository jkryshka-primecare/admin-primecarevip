import { RefreshCw } from "lucide-react";
import { RESOURCES_BY_SCOPE, type HintResource, type HintScope } from "./types";

interface Props {
  scope: HintScope;
  resource: HintResource;
  loading: boolean;
  onResourceChange: (resource: HintResource) => void;
  onRefresh: () => void;
}

export const HintResourceTabs = ({
  scope,
  resource,
  loading,
  onResourceChange,
  onRefresh,
}: Props) => (
  <div className="flex items-center gap-2 flex-wrap justify-end">
    {RESOURCES_BY_SCOPE[scope].map((r) => (
      <button
        key={r.id}
        onClick={() => onResourceChange(r.id)}
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
      onClick={onRefresh}
      disabled={loading}
      className="px-3 py-1.5 rounded text-[10px] font-bold tracking-widest uppercase border border-border text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5 disabled:opacity-50"
    >
      <RefreshCw className={"size-3 " + (loading ? "animate-spin" : "")} />
      Refresh
    </button>
  </div>
);
