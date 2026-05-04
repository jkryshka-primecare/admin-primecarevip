import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Usb, Plus, RotateCcw, ScanLine, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { fetchMedications, MEDICATIONS_QUERY_KEY, Medication } from "@/lib/medications";
import { createExternalScannerListener } from "@/lib/scanner";
import { parseGS1, isGS1Barcode, type GS1ParsedData } from "@/lib/gs1-parser";
import { MedicationCodes } from "@/components/MedicationCodes";

export default function Scanner() {
  const [result, setResult] = useState<Medication | null>(null);
  const [error, setError] = useState("");
  const [lastScannedText, setLastScannedText] = useState("");
  const [lastGS1Data, setLastGS1Data] = useState<GS1ParsedData | null>(null);
  const [externalListening, setExternalListening] = useState(true);
  const [scanSource, setScanSource] = useState<"manual" | "external" | "">("");
  const [manualNdc, setManualNdc] = useState("");
  const manualInputRef = useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();

  const { data: medications = [] } = useQuery({
    queryKey: MEDICATIONS_QUERY_KEY,
    queryFn: fetchMedications,
  });

  const lookupMedication = useCallback(
    (decoded: string): Medication | null => {
      try {
        const data = JSON.parse(decoded);
        if (data.id) {
          return medications.find((m) => m.id === data.id) || null;
        }
        if (data.ndcNumber) {
          return medications.find((m) => m.ndcNumber === data.ndcNumber) || null;
        }
      } catch {
        // Not JSON — try NDC or ID match
      }
      const cleaned = decoded.replace(/^0+/, "");
      return (
        medications.find(
          (m) =>
            m.ndcNumber === decoded ||
            m.ndcNumber === cleaned ||
            m.id === decoded ||
            m.ndcNumber.replace(/-/g, "") === decoded ||
            m.ndcNumber.replace(/-/g, "") === cleaned,
        ) || null
      );
    },
    [medications],
  );

  const handleScanResult = useCallback(
    (decodedText: string, source: "manual" | "external") => {
      setLastScannedText(decodedText);
      setScanSource(source);

      // Parse GS1 DataMatrix if applicable
      let gs1: GS1ParsedData | null = null;
      if (isGS1Barcode(decodedText)) {
        gs1 = parseGS1(decodedText);
        setLastGS1Data(gs1);
      } else {
        setLastGS1Data(null);
      }

      // Try lookup using GS1 NDC first, then raw barcode
      const lookupCode = gs1?.ndc || decodedText;
      const med = lookupMedication(lookupCode);
      if (med) {
        setResult(med);
        setError("");
      } else {
        setResult(null);
        const info = gs1
          ? `GS1 Data Matrix — NDC: ${gs1.ndc || "N/A"}, Lot: ${gs1.lot || "N/A"}, Exp: ${gs1.expiry || "N/A"}`
          : `Barcode: ${decodedText.slice(0, 60)}`;
        setError(`No medication found. ${info}`);
      }
    },
    [lookupMedication]
  );

  // External USB/Bluetooth barcode reader listener (Zebra DS4608, etc.)
  useEffect(() => {
    if (!externalListening) return;
    const cleanup = createExternalScannerListener((barcode) => {
      handleScanResult(barcode, "external");
    });
    return cleanup;
  }, [externalListening, handleScanResult]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = manualNdc.trim();
    if (!value) return;
    handleScanResult(value, "manual");
    setManualNdc("");
  };

  const resetScan = () => {
    setResult(null);
    setError("");
    setLastScannedText("");
    setLastGS1Data(null);
    setScanSource("");
    manualInputRef.current?.focus();
  };

  const handleAddToInventory = () => {
    const params = new URLSearchParams();
    params.set("addNew", "true");

    if (lastGS1Data) {
      if (lastGS1Data.ndc) params.set("ndcNumber", lastGS1Data.ndc);
      if (lastGS1Data.expiry) params.set("expiryDate", lastGS1Data.expiry);
    } else {
      try {
        const data = JSON.parse(lastScannedText);
        const fields = [
          "ndcNumber",
          "name",
          "genericName",
          "strength",
          "category",
          "dosageForm",
          "expiryDate",
          "supplier",
        ];
        fields.forEach((key) => {
          if (data[key]) params.set(key, data[key]);
        });
      } catch {
        params.set("ndcNumber", lastScannedText);
      }
    }
    navigate(`/inventory?${params.toString()}`);
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Scan Medication</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Use your Zebra DS4608 (or any USB/Bluetooth HID barcode reader), or enter an NDC manually below.
        </p>
      </div>

      {/* External scanner status */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Usb className="h-4 w-4" />
        <span>
          External barcode reader (Zebra DS4608):{" "}
          <button
            onClick={() => setExternalListening((v) => !v)}
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            {externalListening ? "Listening" : "Paused"}
          </button>
        </span>
        {externalListening && (
          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-accent/10 text-accent font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
            Active
          </span>
        )}
      </div>

      {/* Manual NDC entry */}
      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center gap-2">
            <ScanLine className="h-5 w-5 text-primary" />
            <h3 className="font-semibold">Manual NDC Entry</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            Type or paste any NDC (e.g. <span className="font-mono">50580-449-10</span>) and press Enter.
            GS1 Data Matrix strings are also accepted.
          </p>
          <form onSubmit={handleManualSubmit} className="flex gap-2">
            <Input
              ref={manualInputRef}
              value={manualNdc}
              onChange={(e) => setManualNdc(e.target.value)}
              placeholder="Enter NDC or paste barcode…"
              className="font-mono"
              autoFocus
            />
            <Button type="submit" disabled={!manualNdc.trim()}>
              <Search className="h-4 w-4 mr-2" />
              Look Up
            </Button>
          </form>

          {error && (
            <div className="p-4 rounded-md bg-destructive/10 text-destructive text-sm space-y-3">
              <p>{error}</p>
              {lastScannedText && (
                <p className="text-xs text-muted-foreground font-mono break-all">
                  Raw scan: {lastScannedText}
                </p>
              )}
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleAddToInventory}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add to Inventory
                </Button>
                <Button variant="outline" size="sm" onClick={resetScan}>
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Try Again
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {result && (
        <Card className="animate-fade-in">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold">
                  {result.name}
                  {scanSource && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      via {scanSource === "external" ? "Barcode Reader" : "Manual Entry"}
                    </span>
                  )}
                </h3>
              </div>
              <Badge
                variant={
                  result.quantity <= result.reorderLevel ? "destructive" : "outline"
                }
              >
                Qty: {result.quantity}
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground">Generic Name</span>
                <p className="font-medium">{result.genericName}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Category</span>
                <p className="font-medium">{result.category}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Dosage Form</span>
                <p className="font-medium">{result.dosageForm}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Strength</span>
                <p className="font-medium">{result.strength}</p>
              </div>
              <div>
                <span className="text-muted-foreground">NDC Number</span>
                <p className="font-medium">{result.ndcNumber}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Expiry Date</span>
                <p className="font-medium">{result.expiryDate}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Cost / Unit</span>
                <p className="font-medium">${result.costPerUnit.toFixed(2)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Dispense Price</span>
                <p className="font-medium">
                  ${result.dispensePricePerUnit.toFixed(2)}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Unit Type</span>
                <p className="font-medium">{result.unitType}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Supplier</span>
                <p className="font-medium">{result.supplier}</p>
              </div>
            </div>

            {lastScannedText && (
              <p className="text-xs text-muted-foreground font-mono break-all">
                Scanned: {lastScannedText}
              </p>
            )}

            <MedicationCodes medication={result} size="md" />

            <div className="flex gap-2 pt-2">
              <Button onClick={resetScan} variant="outline">
                <RotateCcw className="h-4 w-4 mr-2" />
                Scan Another
              </Button>
              <Button onClick={() => navigate("/dispense")}>Dispense This</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
