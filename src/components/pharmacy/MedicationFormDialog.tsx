import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CATEGORIES,
  DOSAGE_FORMS,
  UNIT_TYPES,
  Medication,
  UnitType,
} from "@/lib/medications";
import { lookupNDC, NDCLookupResult } from "@/lib/ndc-lookup";

const STRENGTH_UNIT_REGEX = /(mg\/ml|mg|ml|mcg|g|gram|each|units|%|iu|meq)$/i;

export interface MedicationFormValues {
  name: string;
  genericName: string;
  category: string;
  dosageForm: string;
  unitType: UnitType;
  strengthValue: string;
  strengthUnit: string;
  quantity: string;
  reorderLevel: string;
  costPerUnit: string;
  dispensePricePerUnit: string;
  dateInventoried: string;
  expiryDate: string;
  ndcNumber: string;
  lotNumber: string;
  supplier: string;
  manufacturer: string;
}

const todayStr = () => new Date().toISOString().split("T")[0];

function splitStrength(strength: string | undefined): { value: string; unit: string } {
  if (!strength) return { value: "", unit: "mg" };
  const unitMatch = strength.match(STRENGTH_UNIT_REGEX);
  const unit = unitMatch?.[0] ?? "";
  const value = strength.replace(STRENGTH_UNIT_REGEX, "").trim();
  return { value, unit: unit || "mg" };
}

export function buildInitialFormValues(
  editingMed: Medication | null,
  prefill: Partial<MedicationFormValues> & { strength?: string },
): MedicationFormValues {
  const base = editingMed
    ? splitStrength(editingMed.strength)
    : splitStrength(prefill.strength ?? "");
  return {
    name: editingMed?.name ?? prefill.name ?? "",
    genericName: editingMed?.genericName ?? prefill.genericName ?? "",
    category: editingMed?.category ?? prefill.category ?? CATEGORIES[0],
    dosageForm: editingMed?.dosageForm ?? prefill.dosageForm ?? DOSAGE_FORMS[0],
    unitType: (editingMed?.unitType ?? prefill.unitType ?? UNIT_TYPES[0]) as UnitType,
    strengthValue: prefill.strengthValue ?? base.value,
    strengthUnit: prefill.strengthUnit ?? base.unit,
    quantity: editingMed?.quantity != null ? String(editingMed.quantity) : (prefill.quantity ?? "0"),
    reorderLevel: editingMed?.reorderLevel != null ? String(editingMed.reorderLevel) : "10",
    costPerUnit: editingMed?.costPerUnit != null ? String(editingMed.costPerUnit) : "0",
    dispensePricePerUnit:
      editingMed?.dispensePricePerUnit != null ? String(editingMed.dispensePricePerUnit) : "0",
    dateInventoried: editingMed?.dateInventoried ?? todayStr(),
    expiryDate: editingMed?.expiryDate ?? prefill.expiryDate ?? "",
    ndcNumber: editingMed?.ndcNumber ?? prefill.ndcNumber ?? "",
    lotNumber: editingMed?.lotNumber ?? prefill.lotNumber ?? "",
    supplier: editingMed?.supplier ?? prefill.supplier ?? "",
    manufacturer: editingMed?.manufacturer ?? prefill.manufacturer ?? "",
  };
}

interface MedicationFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingMed: Medication | null;
  initialValues: MedicationFormValues;
  ndcLoading?: boolean;
  /** Patches to merge into the form after it has opened (e.g. async FDA lookup). */
  patch?: Partial<MedicationFormValues> | null;
  onPatchApplied?: () => void;
  onSubmit: (values: MedicationFormValues) => Promise<void> | void;
  /** Existing inventory used to detect duplicate NDCs when adding a new med. */
  existingMedications?: Medication[];
  /** Called when the user picks "View existing" on a duplicate NDC match. */
  onExistingMatch?: (med: Medication) => void;
}

type NdcSearchStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "found"; result: NDCLookupResult }
  | { kind: "notfound" }
  | { kind: "duplicate"; existing: Medication }
  | { kind: "error"; message: string };

export function MedicationFormDialog({
  open,
  onOpenChange,
  editingMed,
  initialValues,
  ndcLoading,
  patch,
  onPatchApplied,
  onSubmit,
  existingMedications = [],
  onExistingMatch,
}: MedicationFormDialogProps) {
  const [values, setValues] = useState<MedicationFormValues>(initialValues);
  const [ndcStatus, setNdcStatus] = useState<NdcSearchStatus>({ kind: "idle" });
  // Track which NDC string the current status applies to, so we know when the
  // user has edited the NDC field and a fresh search is required.
  const searchedNdcRef = useRef<string>("");

  const isNew = !editingMed;
  const trimmedNdc = values.ndcNumber.trim();
  const ndcDirty =
    isNew &&
    trimmedNdc.length > 0 &&
    trimmedNdc !== searchedNdcRef.current;
  // For NEW medications, require an NDC search before saving.
  const mustSearchBeforeSave =
    isNew && (trimmedNdc.length === 0 || ndcDirty);

  // Reset form whenever the dialog opens with a new initial value set
  useEffect(() => {
    if (open) {
      setValues(initialValues);
      setNdcStatus({ kind: "idle" });
      searchedNdcRef.current = editingMed?.ndcNumber?.trim() ?? "";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialValues]);

  // Apply async patches (only fill empty fields so we don't clobber user input)
  useEffect(() => {
    if (!patch) return;
    setValues((prev) => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(patch) as [keyof MedicationFormValues, string][]) {
        if (v == null || v === "") continue;
        if (!next[k] || next[k] === "" || next[k] === "0") {
          (next as any)[k] = v;
        }
      }
      return next;
    });
    onPatchApplied?.();
  }, [patch, onPatchApplied]);

  const set = <K extends keyof MedicationFormValues>(key: K, val: MedicationFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: val }));

  // Run NDC search: check existing inventory + openFDA, prefill empty fields.
  const runNdcSearch = async () => {
    const ndc = values.ndcNumber.trim();
    if (!ndc) return;
    searchedNdcRef.current = ndc;

    // 1) Duplicate check against existing inventory (only for new meds)
    if (isNew) {
      const cleaned = ndc.replace(/-/g, "");
      const existing = existingMedications.find((m) => {
        const mNdc = m.ndcNumber?.trim();
        if (!mNdc) return false;
        return mNdc === ndc || mNdc.replace(/-/g, "") === cleaned;
      });
      if (existing) {
        setNdcStatus({ kind: "duplicate", existing });
        return;
      }
    }

    // 2) openFDA lookup
    setNdcStatus({ kind: "loading" });
    try {
      const result = await lookupNDC(ndc);
      if (!result) {
        setNdcStatus({ kind: "notfound" });
        return;
      }
      setNdcStatus({ kind: "found", result });
      // Prefill empty fields only — never clobber user input
      setValues((prev) => {
        const next = { ...prev };
        if (!next.name) next.name = result.brandName || result.genericName || "";
        if (!next.genericName) next.genericName = result.genericName || "";
        if (!next.manufacturer) next.manufacturer = result.manufacturer || "";
        if (result.category && (!next.category || next.category === CATEGORIES[0])) {
          next.category = result.category;
        }
        if (result.dosageForm && (!next.dosageForm || next.dosageForm === DOSAGE_FORMS[0])) {
          next.dosageForm = result.dosageForm;
        }
        if (!next.strengthValue && result.strength) {
          const split = splitStrength(result.strength);
          next.strengthValue = split.value;
          next.strengthUnit = split.unit;
        }
        return next;
      });
    } catch (err) {
      setNdcStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "FDA lookup failed",
      });
    }
  };

  const handleNdcKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void runNdcSearch();
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (mustSearchBeforeSave) {
      // Auto-run the search instead of silently failing
      await runNdcSearch();
      return;
    }
    await onSubmit(values);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>
            {editingMed ? "Edit Medication" : "Add Medication"}
            {ndcLoading && (
              <span className="inline-flex items-center gap-1.5 ml-2 text-sm font-normal text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Looking up NDC…
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* NDC search — required entry point for new medications */}
          <div className="space-y-1.5 rounded-md border bg-muted/30 p-3">
            <Label htmlFor="ndcNumber" className="flex items-center gap-1.5">
              NDC Number
              <span className="text-destructive">*</span>
              {isNew && (
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  (required — search before saving)
                </span>
              )}
            </Label>
            <div className="flex gap-2">
              <Input
                id="ndcNumber"
                value={values.ndcNumber}
                onChange={(e) => set("ndcNumber", e.target.value)}
                onKeyDown={handleNdcKeyDown}
                placeholder="e.g. 50580-449-10"
                className="font-mono"
                required
              />
              <Button
                type="button"
                onClick={() => void runNdcSearch()}
                disabled={!trimmedNdc || ndcStatus.kind === "loading"}
                variant={ndcDirty ? "default" : "outline"}
              >
                {ndcStatus.kind === "loading" ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Search className="h-4 w-4 mr-2" />
                )}
                Search
              </Button>
            </div>

            {/* Status messages */}
            {ndcStatus.kind === "duplicate" && (
              <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="font-medium">Already in inventory</p>
                  <p className="text-xs">
                    {ndcStatus.existing.name} — {ndcStatus.existing.strength} (Qty:{" "}
                    {ndcStatus.existing.quantity})
                  </p>
                </div>
                {onExistingMatch && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      onExistingMatch(ndcStatus.existing);
                      onOpenChange(false);
                    }}
                  >
                    View
                  </Button>
                )}
              </div>
            )}
            {ndcStatus.kind === "found" && (
              <div className="flex items-start gap-2 rounded-md bg-accent/10 p-2 text-sm text-accent-foreground">
                <Check className="h-4 w-4 mt-0.5 shrink-0 text-accent" />
                <div>
                  <p className="font-medium">FDA match: {ndcStatus.result.brandName || ndcStatus.result.genericName}</p>
                  <p className="text-xs text-muted-foreground">
                    {ndcStatus.result.strength} {ndcStatus.result.dosageForm}
                    {ndcStatus.result.manufacturer && ` · ${ndcStatus.result.manufacturer}`}
                  </p>
                </div>
              </div>
            )}
            {ndcStatus.kind === "notfound" && (
              <p className="text-xs text-muted-foreground">
                Not found in FDA database — fill the fields manually.
              </p>
            )}
            {ndcStatus.kind === "error" && (
              <p className="text-xs text-destructive">{ndcStatus.message}</p>
            )}
            {isNew && ndcDirty && ndcStatus.kind !== "loading" && (
              <p className="text-xs text-muted-foreground">
                NDC changed — click Search (or press Enter) before saving.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={values.name} onChange={(e) => set("name", e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="genericName">Generic Name</Label>
              <Input
                id="genericName"
                value={values.genericName}
                onChange={(e) => set("genericName", e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="category">Category</Label>
              <select
                id="category"
                value={values.category}
                onChange={(e) => set("category", e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                required
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dosageForm">Dosage Form</Label>
              <select
                id="dosageForm"
                value={values.dosageForm}
                onChange={(e) => set("dosageForm", e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                required
              >
                {DOSAGE_FORMS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="unitType">Unit Type</Label>
              <select
                id="unitType"
                value={values.unitType}
                onChange={(e) => set("unitType", e.target.value as UnitType)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                required
              >
                {UNIT_TYPES.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label htmlFor="strengthValue">Strength</Label>
              <div className="flex gap-2">
                <Input
                  id="strengthValue"
                  type="text"
                  placeholder="e.g. 500"
                  value={values.strengthValue}
                  onChange={(e) => set("strengthValue", e.target.value)}
                  className="flex-1"
                  required
                />
                <input
                  list="strengthUnits"
                  id="strengthUnit"
                  placeholder="mg"
                  value={values.strengthUnit}
                  onChange={(e) => set("strengthUnit", e.target.value)}
                  className="flex h-10 w-28 rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
                <datalist id="strengthUnits">
                  <option value="mg" />
                  <option value="ml" />
                  <option value="mg/ml" />
                  <option value="mcg" />
                  <option value="g" />
                  <option value="gram" />
                  <option value="each" />
                  <option value="units" />
                  <option value="%" />
                  <option value="IU" />
                  <option value="mEq" />
                </datalist>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quantity">Quantity</Label>
              <Input
                id="quantity"
                type="number"
                min={0}
                value={values.quantity}
                onChange={(e) => set("quantity", e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reorderLevel">Reorder Level</Label>
              <Input
                id="reorderLevel"
                type="number"
                min={0}
                value={values.reorderLevel}
                onChange={(e) => set("reorderLevel", e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="costPerUnit">Cost Per Unit ($)</Label>
              <Input
                id="costPerUnit"
                type="number"
                step="0.0001"
                min={0}
                value={values.costPerUnit}
                onChange={(e) => set("costPerUnit", e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dispensePricePerUnit">Dispense Price ($)</Label>
              <Input
                id="dispensePricePerUnit"
                type="number"
                step="0.01"
                min={0}
                value={values.dispensePricePerUnit}
                onChange={(e) => set("dispensePricePerUnit", e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dateInventoried">Date Inventoried</Label>
              <Input
                id="dateInventoried"
                type="date"
                value={values.dateInventoried}
                onChange={(e) => set("dateInventoried", e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="expiryDate">Expiry Date</Label>
              <Input
                id="expiryDate"
                type="date"
                value={values.expiryDate}
                onChange={(e) => set("expiryDate", e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label htmlFor="lotNumber">Lot Number</Label>
              <Input
                id="lotNumber"
                value={values.lotNumber}
                onChange={(e) => set("lotNumber", e.target.value)}
                placeholder="From GS1 scan or manual"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="supplier">Supplier</Label>
              <Input
                id="supplier"
                value={values.supplier}
                onChange={(e) => set("supplier", e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="manufacturer">Manufacturer</Label>
              <Input
                id="manufacturer"
                value={values.manufacturer}
                onChange={(e) => set("manufacturer", e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={mustSearchBeforeSave}>
              {editingMed ? "Update" : "Add"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
