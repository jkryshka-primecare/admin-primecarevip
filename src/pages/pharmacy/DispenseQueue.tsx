import { useState } from "react";
import { Pill, User, AlertTriangle, Check, ClipboardList, Clock, CheckCircle2, Loader2, Database, Cloud } from "lucide-react";
import { motion } from "framer-motion";
import {
  dispenseRecords as seedRecords,
  type DispenseRecord,
} from "./mockData";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useElationPharmacy } from "@/hooks/useElationPharmacy";

const queueStats = [
  { label: "In Verification", value: "14", icon: Clock, tone: "accent" },
  { label: "Ready for Pickup", value: "47", icon: CheckCircle2, tone: "success" },
  { label: "Awaiting Counseling", value: "6", icon: AlertTriangle, tone: "warning" },
  { label: "Filled Today", value: "183", icon: ClipboardList, tone: "primary" },
] as const;

const toneClass: Record<string, string> = {
  accent: "text-accent bg-accent/10 border-accent/20",
  success: "text-success bg-success/10 border-success/20",
  warning: "text-warning bg-warning/10 border-warning/20",
  primary: "text-primary bg-primary/10 border-primary/20",
};

export default function DispenseQueue() {
  const [patientSearch, setPatientSearch] = useState("");
  const [selectedPatient, setSelectedPatient] = useState<string | null>(null);
  const [selectedMed, setSelectedMed] = useState<string | null>(null);
  const [qty, setQty] = useState("1");
  const [dispensed, setDispensed] = useState<DispenseRecord[]>(seedRecords);
  const { patients, medications, source, status, message } = useElationPharmacy();

  const matchedPatients =
    patientSearch.length > 1
      ? patients.filter(
          (p) =>
            `${p.firstName} ${p.lastName}`.toLowerCase().includes(patientSearch.toLowerCase()) ||
            p.mrn.includes(patientSearch),
        )
      : [];

  const patient = patients.find((p) => p.id === selectedPatient);
  const med = medications.find((m) => m.id === selectedMed);

  const handleDispense = () => {
    if (!selectedPatient || !selectedMed || !qty) return;
    const record: DispenseRecord = {
      id: `d-${Date.now()}`,
      medicationId: selectedMed,
      patientId: selectedPatient,
      quantity: Number(qty),
      dispensedBy: "Current Pharmacist",
      dispensedAt: new Date().toISOString(),
      status: "pending",
    };
    setDispensed((prev) => [record, ...prev]);
    setSelectedMed(null);
    setQty("1");
  };

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {queueStats.map((s) => (
          <div
            key={s.label}
            className="rounded-2xl bg-card border border-border p-5 shadow-soft"
          >
            <div
              className={`inline-flex items-center justify-center h-9 w-9 rounded-lg border ${toneClass[s.tone]} mb-3`}
            >
              <s.icon className="h-4 w-4" />
            </div>
            <p className="text-3xl font-mono font-light text-foreground">{s.value}</p>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mt-1">
              {s.label}
            </p>
          </div>
        ))}
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-border bg-card p-6 shadow-soft"
        >
          <div className="flex items-center gap-2 mb-4">
            <User className="h-4 w-4 text-accent" />
            <h2 className="font-serif text-base text-foreground">Select patient</h2>
          </div>
          <Input
            placeholder="Search by name or MRN..."
            value={patientSearch}
            onChange={(e) => {
              setPatientSearch(e.target.value);
              setSelectedPatient(null);
            }}
          />
          <div className="mt-3 space-y-2">
            {matchedPatients.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setSelectedPatient(p.id);
                  setPatientSearch(`${p.firstName} ${p.lastName}`);
                }}
                className={`w-full rounded-lg px-4 py-3 text-left transition-colors ${
                  selectedPatient === p.id
                    ? "bg-accent/10 border border-accent/30"
                    : "bg-muted/40 hover:bg-muted"
                }`}
              >
                <p className="text-sm font-medium text-foreground">
                  {p.lastName}, {p.firstName}
                </p>
                <p className="text-xs text-muted-foreground font-mono">
                  {p.mrn} · DOB: {p.dob}
                </p>
                {p.allergies.length > 0 && (
                  <div className="mt-1 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 text-destructive" />
                    <span className="text-xs text-destructive font-medium">
                      {p.allergies.join(", ")}
                    </span>
                  </div>
                )}
              </button>
            ))}
          </div>

          {patient && (
            <div className="mt-4 rounded-lg bg-accent/5 border border-accent/20 p-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-accent">
                Selected Patient
              </p>
              <p className="text-sm font-semibold text-foreground mt-1">
                {patient.lastName}, {patient.firstName}
              </p>
              <p className="text-xs text-muted-foreground font-mono">{patient.mrn}</p>
            </div>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="rounded-2xl border border-border bg-card p-6 shadow-soft"
        >
          <div className="flex items-center gap-2 mb-4">
            <Pill className="h-4 w-4 text-accent" />
            <h2 className="font-serif text-base text-foreground">Select medication</h2>
          </div>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {medications.map((m) => (
              <button
                key={m.id}
                onClick={() => setSelectedMed(m.id)}
                className={`w-full rounded-lg px-4 py-3 text-left transition-colors ${
                  selectedMed === m.id
                    ? "bg-accent/10 border border-accent/30"
                    : "bg-muted/40 hover:bg-muted"
                }`}
              >
                <p className="text-sm font-medium text-foreground">
                  {m.name} {m.dosage}
                </p>
                <p className="text-xs text-muted-foreground">
                  {m.genericName} · Qty: {m.quantityOnHand}
                </p>
              </button>
            ))}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-2xl border border-border bg-card p-6 shadow-soft"
        >
          <div className="flex items-center gap-2 mb-4">
            <Check className="h-4 w-4 text-success" />
            <h2 className="font-serif text-base text-foreground">Dispense</h2>
          </div>

          {patient && med ? (
            <div className="space-y-4">
              <div className="rounded-lg bg-muted/40 p-4 space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Patient
                </p>
                <p className="text-sm font-medium text-foreground">
                  {patient.lastName}, {patient.firstName}
                </p>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mt-2">
                  Medication
                </p>
                <p className="text-sm font-medium text-foreground">
                  {med.name} {med.dosage}
                </p>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Quantity
                </label>
                <Input
                  type="number"
                  min="1"
                  max={med.quantityOnHand}
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  className="mt-1"
                />
              </div>

              {patient.allergies.length > 0 && (
                <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-destructive mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-destructive">Allergy alert</p>
                    <p className="text-xs text-destructive/80">
                      {patient.allergies.join(", ")}
                    </p>
                  </div>
                </div>
              )}

              <Button onClick={handleDispense} className="w-full">
                Confirm Dispense
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Select a patient and medication to dispense.
            </p>
          )}

          {dispensed.length > 0 && (
            <div className="mt-6 space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Session History
              </p>
              {dispensed.slice(0, 5).map((rec) => {
                const m = medications.find((x) => x.id === rec.medicationId);
                const p = patients.find((x) => x.id === rec.patientId);
                return (
                  <div
                    key={rec.id}
                    className="rounded-lg bg-success/5 border border-success/20 px-3 py-2"
                  >
                    <p className="text-xs font-medium text-success">
                      {m?.name} × {rec.quantity} → {p?.lastName}
                    </p>
                    <p className="text-[10px] font-mono uppercase tracking-wider text-success/70">
                      {rec.status}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </motion.div>
      </section>
    </div>
  );
}
