import type { HintScope } from "./types";

interface Props {
  scope: HintScope;
  onChange: (scope: HintScope) => void;
}

const SCOPES: HintScope[] = ["practice", "partner"];

export const HintScopeToggle = ({ scope, onChange }: Props) => (
  <div className="flex items-center gap-1 p-0.5 rounded border border-border bg-secondary/30">
    {SCOPES.map((s) => (
      <button
        key={s}
        onClick={() => onChange(s)}
        className={
          "px-2.5 py-1 rounded text-[10px] font-bold tracking-widest uppercase transition-colors " +
          (scope === s
            ? "bg-accent/15 text-accent"
            : "text-muted-foreground hover:text-foreground")
        }
      >
        {s}
      </button>
    ))}
  </div>
);
