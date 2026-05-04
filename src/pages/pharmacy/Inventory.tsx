import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Search, Plus, Pencil, Trash2, QrCode, ArrowUpDown, ArrowRightLeft, ScanLine, Merge, Scissors, Usb, Bug, ChevronDown } from "lucide-react";
import { SplitInventoryDialog } from "@/components/pharmacy/SplitInventoryDialog";
import { MedicationCodes } from "@/components/pharmacy/MedicationCodes";
import {
  MedicationFormDialog,
  buildInitialFormValues,
  MedicationFormValues,
} from "@/components/pharmacy/MedicationFormDialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { fetchMedications, addMedication, updateMedication, deleteMedication, selectMergeable, mergeMedications, MEDICATIONS_QUERY_KEY, CATEGORIES, Medication, UnitType } from "@/lib/medications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createExternalScannerListener } from "@/lib/pharmacy/scanner";
import { parseGS1, isGS1Barcode, GS1ParsedData } from "@/lib/pharmacy/gs1-parser";
import { formatPrice } from "@/lib/pharmacy/format";
import { lookupNDC, NDCLookupResult } from "@/lib/pharmacy/ndc-lookup";
import { toast } from "sonner";

// Real NDCs verified to return data from openFDA — handy for one-click testing the lookup pipeline.
const SAMPLE_NDCS: { label: string; ndc: string }[] = [
  { label: "Tylenol 500mg", ndc: "50580-449-10" },
  { label: "Lisinopril 5mg", ndc: "68001-333-00" },
  { label: "Metformin 750mg", ndc: "42291-498-01" },
  { label: "Amoxicillin 250mg/5mL", ndc: "65862-707-01" },
  { label: "Atorvastatin 80mg", ndc: "50090-6506-0" },
  { label: "Ibuprofen 800mg", ndc: "80425-0243-4" },
  { label: "Omeprazole 20mg", ndc: "49035-915-01" },
  { label: "Cetirizine 1mg/mL", ndc: "51672-2106-1" },
  { label: "Albuterol Sulfate", ndc: "51662-1499-1" },
  { label: "Azithromycin 250mg", ndc: "72789-081-04" },
];

export default function Inventory() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMed, setEditingMed] = useState<Medication | null>(null);
  const [prefillData, setPrefillData] = useState<Record<string, string>>({});
  const [, forceUpdate] = useState(0);
  const [codesMed, setCodesMed] = useState<Medication | null>(null);
  const [viewMed, setViewMed] = useState<Medication | null>(null);
  const [sortByDate, setSortByDate] = useState<"asc" | "desc">("asc");
  const [mergeSource, setMergeSource] = useState<Medication | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<string>("");
  const [mergeQty, setMergeQty] = useState<number>(0);
  const [splitSource, setSplitSource] = useState<Medication | null>(null);
  const [scannerActive, setScannerActive] = useState(true);
  const [ndcLoading, setNdcLoading] = useState(false);
  const [pendingPatch, setPendingPatch] = useState<Partial<MedicationFormValues> | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  type ScanDebugEntry = {
    id: string;
    raw: string;
    gs1: GS1ParsedData | null;
    fda: NDCLookupResult | null | undefined; // undefined = pending, null = not found
    fdaError?: string;
    matchedExisting?: { id: string; name: string };
    timestamp: string;
  };
  const SCAN_HISTORY_LIMIT = 5;
  const [scanHistory, setScanHistory] = useState<ScanDebugEntry[]>([]);
  // Helper: update a specific entry in history by id (for async FDA result)
  const updateScanEntry = (id: string, patch: Partial<ScanDebugEntry>) =>
    setScanHistory((entries) =>
      entries.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    );
  const queryClient = useQueryClient();
  const { data: medications = [] } = useQuery({
    queryKey: MEDICATIONS_QUERY_KEY,
    queryFn: fetchMedications,
  });
  // Ref so async scanner callbacks always read the latest medications list
  const medicationsRef = useRef<Medication[]>(medications);
  useEffect(() => {
    medicationsRef.current = medications;
  }, [medications]);
  const invalidateMeds = () => queryClient.invalidateQueries({ queryKey: MEDICATIONS_QUERY_KEY });
  // Handle scanned barcode: parse GS1 DataMatrix or plain barcode
  const handleBarcodeScan = useCallback((barcode: string) => {
    const prefill: Partial<MedicationFormValues> & { strength?: string } = {};
    let ndcLookup = barcode;
    let gs1Parsed: GS1ParsedData | null = null;

    // Parse GS1 2D DataMatrix barcodes (GTIN, lot, expiry, serial)
    if (isGS1Barcode(barcode)) {
      gs1Parsed = parseGS1(barcode);
      if (gs1Parsed.ndc) {
        prefill.ndcNumber = gs1Parsed.ndc;
        ndcLookup = gs1Parsed.ndc;
      }
      if (gs1Parsed.lot) prefill.lotNumber = gs1Parsed.lot;
      if (gs1Parsed.expiry) prefill.expiryDate = gs1Parsed.expiry;
      if (gs1Parsed.quantity) prefill.quantity = String(gs1Parsed.quantity);
      toast.info(
        `GS1 parsed — NDC: ${gs1Parsed.ndc || "N/A"}, Lot: ${gs1Parsed.lot || "N/A"}, Exp: ${gs1Parsed.expiry || "N/A"}`
      );
    } else {
      prefill.ndcNumber = barcode;
    }

    // Push a new entry onto the rolling history (keep most recent SCAN_HISTORY_LIMIT)
    const entryId =
      (typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`);
    setScanHistory((entries) =>
      [
        {
          id: entryId,
          raw: barcode,
          gs1: gs1Parsed,
          fda: undefined,
          timestamp: new Date().toLocaleTimeString(),
        },
        ...entries,
      ].slice(0, SCAN_HISTORY_LIMIT),
    );

    // Check if medication already exists — read from ref for the latest list
    const cleanedLookup = ndcLookup.replace(/-/g, "").replace(/^0+/, "");
    const existing = medicationsRef.current.find((m) => {
      const cleanedNdc = m.ndcNumber.replace(/-/g, "").replace(/^0+/, "");
      return (
        cleanedNdc === cleanedLookup ||
        m.ndcNumber === ndcLookup ||
        cleanedNdc === ndcLookup.replace(/-/g, "")
      );
    });

    if (existing) {
      setViewMed(existing);
      updateScanEntry(entryId, { matchedExisting: { id: existing.id, name: existing.name } });
      toast.success(`Found: ${existing.name}`);
      return;
    }

    // New medication — open dialog with scanned prefill, then async-fill from openFDA
    setEditingMed(null);
    setPrefillData(prefill);
    setPendingPatch(null);
    setDialogOpen(true);
    toast.info(`NDC ${ndcLookup} not in inventory — looking up details…`);

    setNdcLoading(true);
    lookupNDC(ndcLookup)
      .then((result) => {
        setNdcLoading(false);
        updateScanEntry(entryId, { fda: result ?? null });
        if (!result) {
          toast.warning("NDC not found in FDA database — fill details manually");
          return;
        }
        const patch: Partial<MedicationFormValues> = {};
        if (result.brandName) patch.name = result.brandName;
        if (result.genericName) patch.genericName = result.genericName;
        if (result.manufacturer) patch.manufacturer = result.manufacturer;
        if (result.dosageForm) patch.dosageForm = result.dosageForm;
        if (result.category) patch.category = result.category;
        if (result.strength) {
          const m = result.strength.match(
            /^([\d.,/\s]+)\s*(mg\/ml|mg|ml|mcg|g|gram|each|units|%|iu|meq)?$/i,
          );
          if (m) {
            patch.strengthValue = m[1].trim();
            if (m[2]) patch.strengthUnit = m[2];
          }
        }
        setPendingPatch(patch);
        toast.success(`Auto-filled: ${result.brandName || result.genericName}`);
      })
      .catch((err) => {
        setNdcLoading(false);
        updateScanEntry(entryId, { fda: null, fdaError: String(err?.message ?? err) });
        toast.warning("FDA lookup failed — fill details manually");
      });
  }, []);


  // External USB/Bluetooth barcode reader listener
  useEffect(() => {
    if (!scannerActive) return;
    const cleanup = createExternalScannerListener(handleBarcodeScan);
    return cleanup;
  }, [scannerActive, handleBarcodeScan]);

  useEffect(() => {
    if (searchParams.get("addNew") === "true") {
      const data: Record<string, string> = {};
      for (const key of ["ndcNumber", "name", "genericName", "strength", "category", "dosageForm", "expiryDate", "supplier"]) {
        const val = searchParams.get(key);
        if (val) data[key] = val;
      }
      setPrefillData(data);
      setEditingMed(null);
      setDialogOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, []);

  const filtered = medications
    .filter((m) => {
      const matchSearch =
        m.name.toLowerCase().includes(search.toLowerCase()) ||
        m.genericName.toLowerCase().includes(search.toLowerCase());
      const matchCategory = categoryFilter === "all" || m.category === categoryFilter;
      return matchSearch && matchCategory;
    })
    .sort((a, b) => {
      const dateA = new Date(a.dateInventoried).getTime();
      const dateB = new Date(b.dateInventoried).getTime();
      return sortByDate === "asc" ? dateA - dateB : dateB - dateA;
    });

  const handleSave = async (values: MedicationFormValues) => {
    const strengthValue = values.strengthValue.trim();
    const strengthUnit = values.strengthUnit.trim();
    const strength = strengthUnit ? `${strengthValue}${strengthUnit}` : strengthValue;
    const data = {
      name: values.name,
      genericName: values.genericName,
      category: values.category,
      dosageForm: values.dosageForm,
      strength,
      quantity: Number(values.quantity),
      reorderLevel: Number(values.reorderLevel),
      costPerUnit: Number(values.costPerUnit),
      dispensePricePerUnit: Number(values.dispensePricePerUnit),
      unitType: values.unitType as UnitType,
      expiryDate: values.expiryDate,
      ndcNumber: values.ndcNumber,
      supplier: values.supplier,
      manufacturer: values.manufacturer || undefined,
      lotNumber: values.lotNumber || undefined,
      dateInventoried: values.dateInventoried,
    };

    try {
      if (editingMed) {
        await updateMedication(editingMed.id, data);
        toast.success("Medication updated");
      } else {
        await addMedication(data);
        toast.success("Medication added");
      }
      setDialogOpen(false);
      setEditingMed(null);
      setPendingPatch(null);
      invalidateMeds();
    } catch (err: any) {
      toast.error(err.message ?? "Failed to save medication");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteMedication(id);
      toast.success("Medication deleted");
      invalidateMeds();
    } catch (err: any) {
      toast.error(err.message ?? "Failed to delete medication");
    }
  };

  const openAdd = () => {
    setEditingMed(null);
    setPrefillData({});
    setPendingPatch(null);
    setDialogOpen(true);
  };

  const openEdit = (med: Medication) => {
    setEditingMed(med);
    setPrefillData({});
    setPendingPatch(null);
    setDialogOpen(true);
  };

  const initialFormValues = useMemo(
    () => buildInitialFormValues(editingMed, prefillData),
    [editingMed, prefillData],
  );

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Inventory</h2>
          <p className="text-muted-foreground text-sm mt-1">{medications.length} medications</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate("/scanner")}>
            <ScanLine className="h-4 w-4 mr-2" />
            Scan to Add
          </Button>
          <Button onClick={openAdd}>
            <Plus className="h-4 w-4 mr-2" />
            Add Medication
          </Button>
        </div>
      </div>

      {/* External scanner status */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Usb className="h-4 w-4" />
        <span>
          Barcode reader:{" "}
          <button
            onClick={() => setScannerActive((v) => !v)}
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            {scannerActive ? "Listening" : "Paused"}
          </button>
        </span>
        {scannerActive && (
          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-accent/10 text-accent font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
            Active
          </span>
        )}
        <span className="text-xs">— Scan a barcode to look up or add medication</span>
        <button
          type="button"
          onClick={() => setDebugOpen((v) => !v)}
          className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          aria-expanded={debugOpen}
          aria-controls="scan-debug-panel"
        >
          <Bug className="h-3.5 w-3.5" />
          Debug
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${debugOpen ? "rotate-180" : ""}`}
          />
        </button>
      </div>

      {debugOpen && (
        <div
          id="scan-debug-panel"
          className="rounded-md border border-dashed bg-muted/40 p-3 text-xs font-mono space-y-3"
        >
          <div className="flex items-center justify-between">
            <span className="font-semibold uppercase tracking-wide text-muted-foreground">
              Scan history (last {SCAN_HISTORY_LIMIT})
            </span>
            {scanHistory.length > 0 && (
              <button
                type="button"
                onClick={() => setScanHistory([])}
                className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
              >
                Clear
              </button>
            )}
          </div>

          {import.meta.env.DEV && (
            <div className="rounded-md border border-dashed bg-background/60 p-2 space-y-2">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const input = e.currentTarget.elements.namedItem("barcode") as HTMLInputElement | null;
                  const value = input?.value.trim();
                  if (!value) return;
                  handleBarcodeScan(value);
                  if (input) input.value = "";
                }}
                className="flex items-center gap-2"
              >
                <Label htmlFor="debug-barcode-input" className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">
                  Dev paste
                </Label>
                <Input
                  id="debug-barcode-input"
                  name="barcode"
                  placeholder="Paste or type a barcode (GS1 or NDC) and press Enter"
                  className="h-7 text-xs font-mono"
                  autoComplete="off"
                />
                <Button type="submit" size="sm" variant="secondary" className="h-7 text-xs">
                  Scan
                </Button>
              </form>
              <div className="flex items-center gap-2">
                <Label className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">
                  Sample NDC
                </Label>
                <Select
                  value=""
                  onValueChange={(value) => {
                    if (value) handleBarcodeScan(value);
                  }}
                >
                  <SelectTrigger className="h-7 text-xs flex-1">
                    <SelectValue placeholder="Pick a real NDC to test FDA lookup…" />
                  </SelectTrigger>
                  <SelectContent>
                    {SAMPLE_NDCS.map((s) => (
                      <SelectItem key={s.ndc} value={s.ndc} className="text-xs">
                        <span className="font-medium">{s.label}</span>
                        <span className="text-muted-foreground ml-2 font-mono">{s.ndc}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {scanHistory.length === 0 ? (
            <p className="text-muted-foreground italic">No scans yet — scan a barcode to inspect.</p>
          ) : (
            <ol className="space-y-3">
              {scanHistory.map((entry, idx) => (
                <li
                  key={entry.id}
                  className={`rounded-md border bg-background p-2 space-y-2 ${idx === 0 ? "ring-1 ring-primary/30" : ""}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      #{scanHistory.length - idx} · {entry.timestamp}
                      {idx === 0 && (
                        <span className="ml-2 text-primary font-semibold">latest</span>
                      )}
                    </span>
                  </div>

                  <div>
                    <span className="font-semibold uppercase tracking-wide text-muted-foreground">
                      Raw
                    </span>
                    <pre className="whitespace-pre-wrap break-all bg-muted/40 rounded px-2 py-1 border mt-1">
                      {entry.raw}
                    </pre>
                  </div>

                  <div>
                    <span className="font-semibold uppercase tracking-wide text-muted-foreground">
                      GS1 parsed
                    </span>
                    {entry.gs1 ? (
                      <pre className="whitespace-pre-wrap bg-muted/40 rounded px-2 py-1 border mt-1">
{`gtin:    ${entry.gs1.gtin ?? "—"}
ndc:     ${entry.gs1.ndc ?? "—"}
lot:     ${entry.gs1.lot ?? "—"}
expiry:  ${entry.gs1.expiry ?? "—"}
serial:  ${entry.gs1.serialNumber ?? "—"}
qty:     ${entry.gs1.quantity ?? "—"}`}
                      </pre>
                    ) : (
                      <p className="text-muted-foreground mt-1">
                        Not a GS1 barcode — used raw value as NDC.
                      </p>
                    )}
                  </div>

                  <div>
                    <span className="font-semibold uppercase tracking-wide text-muted-foreground">
                      openFDA lookup
                    </span>
                    {entry.fda === undefined ? (
                      <p className="text-muted-foreground mt-1">⏳ Pending…</p>
                    ) : entry.fda === null ? (
                      <p className="text-destructive mt-1">
                        {entry.fdaError ? `Error: ${entry.fdaError}` : "No match in FDA database."}
                      </p>
                    ) : (
                      <pre className="whitespace-pre-wrap bg-muted/40 rounded px-2 py-1 border mt-1">
{`brand:        ${entry.fda.brandName || "—"}
generic:      ${entry.fda.genericName || "—"}
strength:     ${entry.fda.strength || "—"}
dosageForm:   ${entry.fda.dosageForm || "—"}
manufacturer: ${entry.fda.manufacturer || "—"}
category:     ${entry.fda.category || "—"}`}
                      </pre>
                    )}
                  </div>

                  {entry.matchedExisting && (
                    <div className="rounded border border-accent/40 bg-accent/10 px-2 py-1 text-accent">
                      Matched existing inventory: {entry.matchedExisting.name}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 py-3 -my-3 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or generic name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            aria-label="Search medications"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-full sm:w-48" aria-label="Filter by category">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 whitespace-nowrap"
          onClick={() => setSortByDate((s) => (s === "asc" ? "desc" : "asc"))}
          aria-label={`Sort by date inventoried ${sortByDate === "asc" ? "oldest first" : "newest first"}`}
        >
          <ArrowUpDown className="h-4 w-4" />
          {sortByDate === "asc" ? "Oldest First" : "Newest First"}
        </Button>
      </div>

      <div className="rounded-lg border bg-card overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="hidden md:table-cell">Category</TableHead>
              <TableHead>Strength</TableHead>
              <TableHead className="hidden sm:table-cell">Unit Type</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right hidden sm:table-cell">Cost</TableHead>
              <TableHead className="text-right hidden sm:table-cell">Dispense $</TableHead>
              <TableHead className="hidden lg:table-cell">Inventoried</TableHead>
              <TableHead className="hidden lg:table-cell">Expiry</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((med) => (
              <TableRow key={med.id} className="animate-fade-in cursor-pointer hover:bg-muted/50" onClick={() => setViewMed(med)}>
                <TableCell>
                  <div>
                    <p className="font-medium text-sm">{med.name}</p>
                    <p className="text-xs text-muted-foreground">{med.dosageForm}</p>
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <Badge variant="secondary" className="text-xs">{med.category}</Badge>
                </TableCell>
                <TableCell className="text-sm">{med.strength}</TableCell>
                <TableCell className="text-sm text-muted-foreground hidden sm:table-cell">
                  {med.unitType}
                </TableCell>
                <TableCell className="text-right">
                  <Badge variant={med.quantity <= med.reorderLevel ? "destructive" : "outline"}>
                    {med.quantity}
                  </Badge>
                </TableCell>
                <TableCell className="text-right text-sm hidden sm:table-cell">
                  ${formatPrice(med.costPerUnit)}
                </TableCell>
                <TableCell className="text-right text-sm font-medium hidden sm:table-cell">
                  ${formatPrice(med.dispensePricePerUnit)}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground hidden lg:table-cell">
                  {med.dateInventoried}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground hidden lg:table-cell">
                  {med.expiryDate}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCodesMed(med)} aria-label="View QR/Barcode">
                            <QrCode className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>View QR/Barcode</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              aria-label="Merge inventory"
                              disabled={selectMergeable(medications, med).length === 0}
                              onClick={() => {
                                const candidates = selectMergeable(medications, med);
                                if (candidates.length === 0) return;
                                setMergeSource(med);
                                setMergeTargetId(candidates[0].id);
                              }}
                            >
                              <Merge className="h-3.5 w-3.5" />
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>Merge Inventory</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              aria-label="Split / Pre-pack"
                              disabled={med.quantity < 2}
                              onClick={() => setSplitSource(med)}
                            >
                              <Scissors className="h-3.5 w-3.5" />
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>Split / Pre-pack</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Edit medication" onClick={() => openEdit(med)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Edit Medication</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" aria-label="Delete medication" onClick={() => handleDelete(med.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Delete Medication</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                  No medications found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!codesMed} onOpenChange={(open) => !open && setCodesMed(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{codesMed?.name} — Codes</DialogTitle>
          </DialogHeader>
          {codesMed && <MedicationCodes medication={codesMed} size="md" />}
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewMed} onOpenChange={(open) => !open && setViewMed(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{viewMed?.name}</DialogTitle>
          </DialogHeader>
          {viewMed && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Generic Name</span>
                  <p className="font-medium">{viewMed.genericName}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Category</span>
                  <p className="font-medium">{viewMed.category}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Dosage Form</span>
                  <p className="font-medium">{viewMed.dosageForm}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Strength</span>
                  <p className="font-medium">{viewMed.strength}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Unit Type</span>
                  <p className="font-medium">{viewMed.unitType}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">NDC Number</span>
                  <p className="font-medium">{viewMed.ndcNumber}</p>
                </div>
                {viewMed.lotNumber && (
                  <div>
                    <span className="text-muted-foreground">Lot Number</span>
                    <p className="font-medium">{viewMed.lotNumber}</p>
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground">Quantity</span>
                  <Badge variant={viewMed.quantity <= viewMed.reorderLevel ? "destructive" : "outline"}>
                    {viewMed.quantity}
                  </Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">Reorder Level</span>
                  <p className="font-medium">{viewMed.reorderLevel}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Cost Per Unit</span>
                  <p className="font-medium">${formatPrice(viewMed.costPerUnit)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Dispense Price</span>
                  <p className="font-medium">${formatPrice(viewMed.dispensePricePerUnit)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Date Inventoried</span>
                  <p className="font-medium">{viewMed.dateInventoried}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Expiry Date</span>
                  <p className="font-medium">{viewMed.expiryDate}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Supplier</span>
                  <p className="font-medium">{viewMed.supplier}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Manufacturer</span>
                  <p className="font-medium">{viewMed.manufacturer || "—"}</p>
                </div>
              </div>
              <MedicationCodes medication={viewMed} size="md" />
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => { setViewMed(null); openEdit(viewMed); }}>
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit
                </Button>
                <Button onClick={() => { setViewMed(null); navigate("/dispense"); }}>
                  <ArrowRightLeft className="h-4 w-4 mr-2" />
                  Dispense
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <MedicationFormDialog
        open={dialogOpen}
        onOpenChange={(o) => {
          setDialogOpen(o);
          if (!o) {
            setEditingMed(null);
            setPendingPatch(null);
          }
        }}
        editingMed={editingMed}
        initialValues={initialFormValues}
        ndcLoading={ndcLoading}
        patch={pendingPatch}
        onPatchApplied={() => setPendingPatch(null)}
        onSubmit={handleSave}
        existingMedications={medications}
        onExistingMatch={(med) => setViewMed(med)}
      />

      {/* Merge Inventory Dialog */}
      <Dialog open={!!mergeSource} onOpenChange={(open) => !open && setMergeSource(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Merge Inventory</DialogTitle>
          </DialogHeader>
          {mergeSource && (() => {
            const targets = selectMergeable(medications, mergeSource);
            return (
              <div className="space-y-4">
                <div className="rounded-md border p-3 bg-muted/50 text-sm">
                  <p className="font-medium">Source: {mergeSource.name}</p>
                  <p className="text-muted-foreground">
                    {mergeSource.strength} · {mergeSource.dosageForm} · Qty: {mergeSource.quantity}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label>Transfer To</Label>
                  <select
                    value={mergeTargetId}
                    onChange={(e) => setMergeTargetId(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Select a target medication…</option>
                    {targets.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} — {t.unitType} — Qty: {t.quantity} (exp {t.expiryDate})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label>Quantity to Transfer</Label>
                  <Input
                    type="number"
                    min={1}
                    max={mergeSource.quantity}
                    value={mergeQty}
                    onChange={(e) => setMergeQty(Number(e.target.value))}
                  />
                  <p className="text-xs text-muted-foreground">
                    {mergeQty === mergeSource.quantity
                      ? "Source item will be removed after merge"
                      : `${mergeSource.quantity - mergeQty} will remain in source`}
                  </p>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setMergeSource(null)}>Cancel</Button>
                  <Button
                    disabled={!mergeTargetId || mergeQty <= 0 || mergeQty > mergeSource.quantity}
                    onClick={async () => {
                      try {
                        const result = await mergeMedications(mergeSource.id, mergeTargetId, mergeQty);
                        toast.success(
                          result.remaining === 0
                            ? `Merged all ${result.transferred} units — source removed`
                            : `Transferred ${result.transferred} units — ${result.remaining} remain in source`
                        );
                        setMergeSource(null);
                        invalidateMeds();
                      } catch (err: any) {
                        toast.error(err.message);
                      }
                    }}
                  >
                    <Merge className="h-4 w-4 mr-2" />
                    Merge
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      <SplitInventoryDialog
        source={splitSource}
        onClose={() => setSplitSource(null)}
        onComplete={() => forceUpdate((n) => n + 1)}
      />
    </div>
  );
}
