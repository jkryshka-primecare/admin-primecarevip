import { useState, useMemo } from "react";
import { Search, Filter, ArrowUpDown } from "lucide-react";
import { motion } from "framer-motion";
import { medications } from "./mockData";
import { Input } from "@/components/ui/input";

export default function Inventory() {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<"name" | "quantityOnHand" | "expirationDate">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [formFilter, setFormFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    let list = medications.filter(
      (m) =>
        m.name.toLowerCase().includes(search.toLowerCase()) ||
        m.genericName.toLowerCase().includes(search.toLowerCase()) ||
        m.ndc.includes(search),
    );
    if (formFilter !== "all") list = list.filter((m) => m.form === formFilter);
    list = [...list].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (typeof aVal === "string" && typeof bVal === "string")
        return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      return sortDir === "asc" ? Number(aVal) - Number(bVal) : Number(bVal) - Number(aVal);
    });
    return list;
  }, [search, sortKey, sortDir, formFilter]);

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const forms = ["all", ...Array.from(new Set(medications.map((m) => m.form)))];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, generic, or NDC..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <select
            value={formFilter}
            onChange={(e) => setFormFilter(e.target.value)}
            className="rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground"
          >
            {forms.map((f) => (
              <option key={f} value={f}>
                {f === "all" ? "All Forms" : f.charAt(0).toUpperCase() + f.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="rounded-2xl border border-border bg-card overflow-hidden shadow-soft"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {[
                  { key: "name" as const, label: "Medication" },
                  { key: "name" as const, label: "NDC" },
                  { key: "name" as const, label: "Dosage" },
                  { key: "quantityOnHand" as const, label: "Qty" },
                  { key: "expirationDate" as const, label: "Expires" },
                  { key: "name" as const, label: "Location" },
                  { key: "name" as const, label: "Status" },
                ].map(({ key, label }, i) => (
                  <th
                    key={i}
                    className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground cursor-pointer hover:text-foreground"
                    onClick={() => toggleSort(key)}
                  >
                    <span className="flex items-center gap-1">
                      {label}
                      {sortKey === key && <ArrowUpDown className="h-3 w-3" />}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((med) => {
                const isLow = med.quantityOnHand <= med.reorderLevel;
                const expDate = new Date(med.expirationDate);
                const threeMonths = new Date();
                threeMonths.setMonth(threeMonths.getMonth() + 3);
                const isExpiring = expDate <= threeMonths;

                return (
                  <tr key={med.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{med.name}</p>
                      <p className="text-xs text-muted-foreground">{med.genericName}</p>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {med.ndc}
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      {med.dosage} · {med.form}
                    </td>
                    <td
                      className={`px-4 py-3 font-mono font-semibold ${
                        isLow ? "text-warning" : "text-foreground"
                      }`}
                    >
                      {med.quantityOnHand}
                    </td>
                    <td
                      className={`px-4 py-3 font-mono ${
                        isExpiring ? "text-destructive font-medium" : "text-foreground"
                      }`}
                    >
                      {med.expirationDate}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {med.location}
                    </td>
                    <td className="px-4 py-3">
                      {isLow ? (
                        <span className="inline-flex rounded-full bg-warning/10 px-2.5 py-0.5 text-xs font-medium text-warning">
                          Low Stock
                        </span>
                      ) : isExpiring ? (
                        <span className="inline-flex rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-medium text-destructive">
                          Expiring
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-success/10 px-2.5 py-0.5 text-xs font-medium text-success">
                          In Stock
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </motion.div>
    </div>
  );
}
