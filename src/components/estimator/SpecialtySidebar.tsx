import { useState, useMemo } from "react";
import {
  Stethoscope, Scan, HeartPulse, Bone, ScanLine, FlaskConical,
  Search, X, Scissors, Baby, Brain, Wind, Droplets, Ear, Ribbon,
  Siren, Eye, Dumbbell, BrainCircuit, Syringe, Droplet, Activity,
  Zap, UserRound, Pill,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useSpecialties } from "@/hooks/useEstimatorDb";

const iconMap: Record<string, LucideIcon> = {
  Stethoscope, Scan, HeartPulse, Bone, ScanLine, FlaskConical,
  Scissors, Baby, Brain, Wind, Droplets, Ear, Ribbon, Siren,
  Eye, Dumbbell, BrainCircuit, Syringe, Droplet, Activity, Zap, UserRound, Pill,
};

interface SpecialtySidebarProps {
  activeSpecialty: string;
  onSelect: (id: string) => void;
}

export function SpecialtySidebar({ activeSpecialty, onSelect }: SpecialtySidebarProps) {
  const [filter, setFilter] = useState("");
  const { data: specialties = [], isLoading } = useSpecialties();

  const filtered = useMemo(() => {
    if (!filter.trim()) return specialties;
    const q = filter.toLowerCase();
    return specialties.filter((s) => s.name.toLowerCase().includes(q));
  }, [filter, specialties]);

  return (
    <aside className="w-56 shrink-0 border-r border-border bg-card rounded-lg flex flex-col self-start sticky top-4 max-h-[calc(100vh-6rem)]">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="font-serif text-sm text-foreground">Specialties</h2>
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono mt-0.5">
          Cash-pay directory
        </p>
      </div>

      <div className="px-3 pt-3 pb-1">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter…"
            className="w-full pl-7 pr-7 py-1.5 text-xs bg-muted border border-border rounded-md
              placeholder:text-muted-foreground
              focus:outline-none focus:border-primary focus:ring-[2px] focus:ring-ring/30
              transition-all duration-150"
          />
          {filter && (
            <button
              onClick={() => setFilter("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      <nav className="flex-1 py-2 overflow-y-auto">
        <button
          onClick={() => onSelect("all")}
          className={`w-[calc(100%-0.5rem)] flex items-center gap-2.5 px-3 py-2 mx-1 rounded-md text-sm transition-colors duration-150
            ${activeSpecialty === "all"
              ? "bg-primary/10 text-primary font-medium"
              : "text-foreground hover:bg-muted"
            }`}
        >
          <Search className="h-4 w-4 shrink-0" />
          <span className="truncate">All Specialties</span>
        </button>

        <div className="px-3 py-1.5 mt-1">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider font-mono">
            Categories
          </span>
        </div>
        {isLoading && (
          <p className="px-3 py-4 text-xs text-muted-foreground text-center">Loading…</p>
        )}
        {!isLoading && filtered.length === 0 && (
          <p className="px-3 py-4 text-xs text-muted-foreground text-center">
            No specialties match "{filter}"
          </p>
        )}
        {filtered.map((spec) => {
          const Icon = iconMap[spec.icon] || Stethoscope;
          const isActive = activeSpecialty === spec.id;
          return (
            <button
              key={spec.id}
              onClick={() => onSelect(spec.id)}
              className={`w-[calc(100%-0.5rem)] flex items-center gap-2.5 px-3 py-2 mx-1 rounded-md text-sm transition-colors duration-150
                ${isActive
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-foreground hover:bg-muted"
                }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{spec.name}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
