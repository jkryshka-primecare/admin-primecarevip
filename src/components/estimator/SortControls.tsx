import { ArrowUpDown, MapPin, DollarSign, Blend } from "lucide-react";

export type SortMode = "distance" | "price" | "combined";

const sortOptions: { value: SortMode; label: string; icon: React.ReactNode }[] = [
  { value: "distance", label: "Distance", icon: <MapPin className="h-3 w-3" /> },
  { value: "price", label: "Price", icon: <DollarSign className="h-3 w-3" /> },
  { value: "combined", label: "Distance + Price", icon: <Blend className="h-3 w-3" /> },
];

interface SortControlsProps {
  value: SortMode;
  onChange: (mode: SortMode) => void;
}

export function SortControls({ value, onChange }: SortControlsProps) {
  return (
    <div className="flex items-center gap-1.5">
      <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
      {sortOptions.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
            value === opt.value
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
          }`}
        >
          {opt.icon}
          {opt.label}
        </button>
      ))}
    </div>
  );
}
