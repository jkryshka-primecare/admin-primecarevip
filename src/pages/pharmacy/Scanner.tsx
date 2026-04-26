import { useState } from "react";
import { ScanBarcode, Search, Package, Check, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { medications, type Medication } from "./mockData";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function Scanner() {
  const [scanInput, setScanInput] = useState("");
  const [scannedMed, setScannedMed] = useState<Medication | null>(null);
  const [scanMode, setScanMode] = useState<"individual" | "bulk">("individual");
  const [bulkResults, setBulkResults] = useState<Medication[]>([]);
  const [error, setError] = useState("");

  const handleScan = () => {
    setError("");
    const q = scanInput.trim();
    if (!q) return;
    const found = medications.find(
      (m) =>
        m.ndc === q ||
        m.lotNumber === q ||
        m.name.toLowerCase() === q.toLowerCase(),
    );

    if (scanMode === "individual") {
      if (found) {
        setScannedMed(found);
        setBulkResults([]);
      } else {
        setScannedMed(null);
        setError("No medication found. Check NDC, lot number, or name.");
      }
    } else {
      if (found) {
        if (!bulkResults.find((m) => m.id === found.id)) {
          setBulkResults((prev) => [...prev, found]);
        }
        setScannedMed(null);
      } else {
        setError("Item not found in inventory.");
      }
    }
    setScanInput("");
  };

  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        {(["individual", "bulk"] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => {
              setScanMode(mode);
              setScannedMed(null);
              setBulkResults([]);
              setError("");
            }}
            className={`rounded-full px-4 py-2 text-xs font-medium transition-colors ${
              scanMode === mode
                ? "bg-primary text-primary-foreground shadow-soft"
                : "bg-card border border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            {mode === "individual" ? "Individual Scan" : "Bulk Scan"}
          </button>
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-border bg-card p-6 shadow-soft"
      >
        <div className="flex items-center gap-2 mb-4">
          <ScanBarcode className="h-5 w-5 text-accent" />
          <h2 className="font-serif text-lg text-foreground">
            {scanMode === "individual" ? "Scan individual item" : "Bulk scanning mode"}
          </h2>
        </div>

        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Enter NDC, lot number, or medication name..."
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleScan()}
              className="pl-10"
            />
          </div>
          <Button onClick={handleScan}>
            <ScanBarcode className="h-4 w-4 mr-2" /> Scan
          </Button>
        </div>

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-4 flex items-center gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3"
            >
              <AlertCircle className="h-4 w-4 text-destructive" />
              <p className="text-sm text-destructive">{error}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <AnimatePresence>
        {scannedMed && scanMode === "individual" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-2xl border border-success/30 bg-success/5 p-6 shadow-soft"
          >
            <div className="flex items-center gap-2 mb-4">
              <Check className="h-5 w-5 text-success" />
              <h2 className="font-serif text-lg text-foreground">Medication found</h2>
            </div>
            <MedDetail med={scannedMed} />
          </motion.div>
        )}
      </AnimatePresence>

      {scanMode === "bulk" && bulkResults.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-2xl border border-border bg-card p-6 shadow-soft"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-accent" />
              <h2 className="font-serif text-lg text-foreground">Bulk scan results</h2>
            </div>
            <span className="rounded-full bg-accent/10 px-3 py-1 text-xs font-mono uppercase tracking-wider text-accent">
              {bulkResults.length} items
            </span>
          </div>
          <div className="space-y-3">
            {bulkResults.map((med) => (
              <div key={med.id} className="rounded-lg bg-muted/50 p-4">
                <MedDetail med={med} compact />
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}

function MedDetail({ med, compact }: { med: Medication; compact?: boolean }) {
  return (
    <div
      className={`grid ${
        compact ? "grid-cols-2 md:grid-cols-4 gap-3" : "grid-cols-2 md:grid-cols-3 gap-4"
      }`}
    >
      <Field label="Name" value={`${med.name} (${med.genericName})`} />
      <Field label="NDC" value={med.ndc} />
      <Field label="Dosage" value={med.dosage} />
      <Field label="Form" value={med.form} />
      <Field label="Lot #" value={med.lotNumber} />
      <Field label="Expires" value={med.expirationDate} />
      <Field label="Qty on Hand" value={String(med.quantityOnHand)} />
      <Field label="Location" value={med.location} />
      {!compact && <Field label="Schedule" value={med.schedule} />}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className="text-sm font-mono text-foreground mt-0.5">{value}</p>
    </div>
  );
}
