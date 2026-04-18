import type { HintResource } from "./types";

interface Props {
  resource: HintResource;
  inputValue: string;
  committedValue: string;
  onInputChange: (value: string) => void;
}

export const HintSearchBar = ({
  resource,
  inputValue,
  committedValue,
  onInputChange,
}: Props) => (
  <div className="flex items-center gap-3">
    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
      Search
    </label>
    <div className="relative flex-1 max-w-md">
      <input
        type="search"
        value={inputValue}
        onChange={(e) => onInputChange(e.target.value)}
        placeholder={`Search ${resource} by name, email, ID…`}
        className="w-full bg-background border border-border rounded px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/30"
      />
      {inputValue && (
        <button
          onClick={() => onInputChange("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs px-1"
          aria-label="Clear search"
        >
          ✕
        </button>
      )}
    </div>
    {committedValue && (
      <span className="text-[10px] font-mono text-muted-foreground">
        q=<span className="text-accent">{committedValue}</span>
      </span>
    )}
  </div>
);
