import { Search, MapPin, Building2, X, Check, ChevronsUpDown, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  resultCount: number;
  location: string;
  onLocationChange: (value: string) => void;
  providerSearch: string;
  onProviderSearchChange: (value: string) => void;
  nhsnCategory: string;
  onNhsnCategoryChange: (value: string) => void;
  nhsnCategories: string[];
}

export function SearchBar({
  value,
  onChange,
  resultCount,
  location,
  onLocationChange,
  providerSearch,
  onProviderSearchChange,
  nhsnCategory,
  onNhsnCategoryChange,
  nhsnCategories,
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [localValue, setLocalValue] = useState(value);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const [providerOpen, setProviderOpen] = useState(false);
  const [nhsnOpen, setNhsnOpen] = useState(false);

  const { data: providers = [] } = useQuery({
    queryKey: ["estimator", "all-providers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("providers")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleChange = (newValue: string) => {
    setLocalValue(newValue);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onChange(newValue);
    }, 300);
  };

  useEffect(() => {
    return () => clearTimeout(debounceRef.current);
  }, []);

  const trimmedLen = localValue.trim().length;
  const hasProvider = providerSearch.trim().length > 0;

  return (
    <div className="flex flex-wrap gap-2">
      {/* Service / ICD-10 search */}
      <div className="relative flex-1 min-w-[280px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          value={localValue}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="Search by CPT code, service name, or ICD-10…"
          className="w-full pl-10 pr-24 py-2.5 text-sm bg-card border border-border rounded-lg
            placeholder:text-muted-foreground font-sans
            focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-ring/20
            transition-all duration-200"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground tabular-nums font-mono">
          {trimmedLen === 0 && !hasProvider
            ? "⌘K"
            : hasProvider
              ? `${resultCount} result${resultCount !== 1 ? "s" : ""}`
              : trimmedLen < 3
                ? `${3 - trimmedLen} more…`
                : `${resultCount} result${resultCount !== 1 ? "s" : ""}`}
        </span>
      </div>

      {/* Provider combobox */}
      <Popover open={providerOpen} onOpenChange={setProviderOpen}>
        <PopoverTrigger asChild>
          <button
            role="combobox"
            aria-expanded={providerOpen}
            className={cn(
              "relative flex items-center w-64 pl-10 pr-8 py-2.5 text-sm bg-card border border-border rounded-lg",
              "text-left transition-all duration-200",
              "focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-ring/20",
              !providerSearch && "text-muted-foreground"
            )}
          >
            <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <span className="truncate flex-1">
              {providerSearch || "Filter by provider…"}
            </span>
            {providerSearch ? (
              <span
                role="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onProviderSearchChange("");
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </span>
            ) : (
              <ChevronsUpDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-0" align="start">
          <Command>
            <CommandInput placeholder="Search providers…" />
            <CommandList>
              <CommandEmpty>No providers found.</CommandEmpty>
              <CommandGroup>
                {providers.map((p) => (
                  <CommandItem
                    key={p.id}
                    value={p.name}
                    onSelect={(val) => {
                      onProviderSearchChange(val === providerSearch ? "" : val);
                      setProviderOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        providerSearch === p.name ? "opacity-100" : "opacity-0"
                      )}
                    />
                    {p.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Location filter */}
      <div className="relative w-52">
        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          value={location}
          onChange={(e) => onLocationChange(e.target.value)}
          placeholder="City, ZIP, or state…"
          className="w-full pl-10 pr-8 py-2.5 text-sm bg-card border border-border rounded-lg
            placeholder:text-muted-foreground
            focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-ring/20
            transition-all duration-200"
        />
        {location && (
          <button
            onClick={() => onLocationChange("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
