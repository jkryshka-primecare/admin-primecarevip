import { useState, useCallback } from "react";
import { ArrowRightLeft, ShieldCheck, Bell } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MedicationLabel, type LabelData } from "@/components/pharmacy/MedicationLabel";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  fetchMedications,
  decrementStock,
  MEDICATIONS_QUERY_KEY,
  DEA_SCHEDULES,
  type DEASchedule,
} from "@/lib/medications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import PrescriptionQueue, { type QueuedPrescription } from "@/components/pharmacy/PrescriptionQueue";
import { supabase } from "@/integrations/supabase/client";
import { formatPrice } from "@/lib/pharmacy/format";

export default function Dispense() {
  const [selectedMedId, setSelectedMedId] = useState("");
  // Patient
  const [patientName, setPatientName] = useState("");
  const [patientDOB, setPatientDOB] = useState("");
  const [patientAddress, setPatientAddress] = useState("");
  const [patientPhone, setPatientPhone] = useState("");
  // Prescription
  const [rxNumber, setRxNumber] = useState(() => {
    const now = new Date();
    return `RX-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
  });
  const [prescriber, setPrescriber] = useState("");
  const [prescriberDEA, setPrescriberDEA] = useState("");
  const [prescriberNPI, setPrescriberNPI] = useState("");
  const [prescriberPhone, setPrescriberPhone] = useState("");
  const [dateWritten, setDateWritten] = useState("");
  // Drug details
  const [quantity, setQuantity] = useState(1);
  const [daysSupply, setDaysSupply] = useState(30);
  const [directions, setDirections] = useState("");
  const [deaSchedule, setDeaSchedule] = useState<DEASchedule>("Non-Controlled");
  const [lotNumber, setLotNumber] = useState("");
  // Refills
  const [refillsAuthorized, setRefillsAuthorized] = useState(0);
  const [refillNumber, setRefillNumber] = useState(0);
  // Dispensing
  const [dispenserRole, setDispenserRole] = useState("Pharmacist");
  const [dispensedBy, setDispensedBy] = useState("");
  const [pharmacistLicense, setPharmacistLicense] = useState("");
  // Additional
  const [notes, setNotes] = useState("");
  const [diagnosisCode, setDiagnosisCode] = useState("");

  const [filledFromEmr, setFilledFromEmr] = useState(false);
  const [emrQueueId, setEmrQueueId] = useState<string | null>(null);
  const [prescribedMedName, setPrescribedMedName] = useState("");
  const [labelData, setLabelData] = useState<LabelData | null>(null);
  const [showLabel, setShowLabel] = useState(false);

  const queryClient = useQueryClient();
  const { data: medications = [] } = useQuery({
    queryKey: MEDICATIONS_QUERY_KEY,
    queryFn: fetchMedications,
  });
  const selectedMed = medications.find((m) => m.id === selectedMedId);

  const handleFillFromEmr = useCallback((rx: QueuedPrescription) => {
    // Auto-populate all fields from EMR data
    setPatientName(rx.patient_name || "");
    setPatientDOB(rx.patient_dob || "");
    setPatientAddress(rx.patient_address || "");
    setPatientPhone(rx.patient_phone || "");
    setPrescriber(rx.prescriber_name || "");
    setPrescriberDEA(rx.prescriber_dea || "");
    setPrescriberNPI(rx.prescriber_npi || "");
    setPrescriberPhone(rx.prescriber_phone || "");

    // Parse date_written from ISO timestamp to YYYY-MM-DD for date input
    if (rx.date_written) {
      const parsed = rx.date_written.substring(0, 10); // "2026-04-10T18:15:56Z" → "2026-04-10"
      setDateWritten(parsed);
    } else {
      setDateWritten("");
    }

    setQuantity(rx.quantity || 1);
    setDaysSupply(rx.days_supply || 30);
    setDirections(rx.directions || "");
    setDeaSchedule((rx.dea_schedule as DEASchedule) || "Non-Controlled");
    setRefillsAuthorized(rx.refills_authorized || 0);
    setDiagnosisCode(rx.diagnosis_code || "");
    setNotes(rx.note_to_pharmacy || "");

    // Store the prescribed medication name as-is from the prescription
    const rxMedName = rx.medication_name || "";
    const rxMedStrength = rx.medication_strength || "";
    setPrescribedMedName(rxMedName + (rxMedStrength ? ` (${rxMedStrength})` : ""));

    // Try to match medication by name in inventory
    const matchedMed = medications.find(
      (m) =>
        m.name.toLowerCase() === rxMedName.toLowerCase() ||
        m.genericName.toLowerCase() === rxMedName.toLowerCase()
    );
    if (matchedMed) {
      setSelectedMedId(matchedMed.id);
    } else {
      setSelectedMedId("");
    }

    setFilledFromEmr(true);
    setEmrQueueId(rx.id);
    toast.success(`Loaded prescription for ${rx.patient_name} from EMR`);
  }, [medications]);

  const handleDispense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMedId) {
      toast.error("Please select a medication");
      return;
    }
    try {
      // Decrement stock atomically in the database
      await decrementStock(selectedMedId, quantity);
      queryClient.invalidateQueries({ queryKey: MEDICATIONS_QUERY_KEY });

      // Save to database for long-term history
      const { data: insertedRecord, error: insertErr } = await supabase
        .from("dispense_records")
        .insert({
          medication_id: selectedMedId,
          medication_name: selectedMed?.name || "",
          patient_name: patientName,
          patient_dob: patientDOB,
          patient_address: patientAddress,
          patient_phone: patientPhone,
          rx_number: rxNumber,
          prescriber,
          prescriber_dea: prescriberDEA,
          prescriber_npi: prescriberNPI,
          prescriber_phone: prescriberPhone,
          date_written: dateWritten,
          quantity,
          days_supply: daysSupply,
          directions,
          dea_schedule: deaSchedule,
          lot_number: lotNumber,
          refills_authorized: refillsAuthorized,
          refill_number: refillNumber,
          dispensed_by: dispensedBy,
          pharmacist_license: pharmacistLicense,
          notes,
          diagnosis_code: diagnosisCode,
          prescription_queue_id: emrQueueId || undefined,
          unit_price: selectedMed?.dispensePricePerUnit ?? null,
          total_cost: selectedMed ? selectedMed.dispensePricePerUnit * quantity : null,
        })
        .select("id")
        .single();
      if (insertErr) throw insertErr;

      // Auto-bill (pended) to Hint. Failures are non-blocking — the dashboard
      // panel will surface a Retry button for failed billings.
      if (insertedRecord?.id) {
        supabase.functions
          .invoke("hint-create-charge", { body: { dispense_record_id: insertedRecord.id } })
          .then(({ data, error }) => {
            if (error) {
              toast.warning("Dispensed, but Hint billing failed — retry from the dashboard");
              return;
            }
            const result = data as { success?: boolean; error?: string; code?: string } | null;
            if (result?.success === false) {
              toast.warning(
                result.code === "patient_not_found"
                  ? `${result.error}. Add this patient to the Hint sandbox, then retry.`
                  : "Dispensed, but Hint billing failed — retry from the dashboard",
              );
            }
          })
          .catch(() => {
            toast.warning("Dispensed, but Hint billing failed — retry from the dashboard");
          });
      }

      // Capture label data before resetting form
      setLabelData({
        patientName,
        rxNumber,
        medicationName: selectedMed?.name || "",
        strength: selectedMed?.strength || "",
        quantity,
        directions,
        prescriber,
        dispensedBy,
        dispensedDate: new Date().toISOString(),
        refillsAuthorized,
        refillNumber,
        manufacturer: selectedMed?.manufacturer,
        lotNumber: lotNumber || undefined,
        expiryDate: selectedMed?.expiryDate,
        totalCost: selectedMed ? selectedMed.dispensePricePerUnit * quantity : undefined,
      });
      setShowLabel(true);

      toast.success(
        `Dispensed ${quantity}x ${selectedMed?.name} to ${patientName} (Rx #${rxNumber})`
      );

      // Mark EMR queue item as dispensed if applicable
      if (emrQueueId) {
        await supabase
          .from("prescription_queue")
          .update({ status: "dispensed" })
          .eq("id", emrQueueId);
      }

      // Reset form
      setSelectedMedId("");
      setPatientName("");
      setPatientDOB("");
      setPatientAddress("");
      setPatientPhone("");
      setRxNumber(() => {
        const now = new Date();
        return `RX-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
      });
      setPrescriber("");
      setPrescriberDEA("");
      setPrescriberNPI("");
      setPrescriberPhone("");
      setDateWritten("");
      setQuantity(1);
      setDaysSupply(30);
      setDirections("");
      setDeaSchedule("Non-Controlled");
      setLotNumber("");
      setRefillsAuthorized(0);
      setRefillNumber(0);
      setDispensedBy("");
      setPharmacistLicense("");
      setNotes("");
      setDiagnosisCode("");
      setFilledFromEmr(false);
      setEmrQueueId(null);
      setPrescribedMedName("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to dispense");
    }
  };

  const SectionTitle = ({ children }: { children: React.ReactNode }) => (
    <div className="flex items-center gap-2 pt-2">
      <h3 className="text-sm font-semibold text-primary">{children}</h3>
      <Separator className="flex-1" />
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Dispense Medication</h2>
        <p className="text-muted-foreground text-sm mt-1 flex items-center gap-1.5">
          <ShieldCheck className="h-4 w-4" />
          FDA &amp; DEA compliant dispensing record
        </p>
      </div>

      {/* Pending prescriptions from Elation EMR */}
      <PrescriptionQueue onFillPrescription={handleFillFromEmr} />

      {filledFromEmr && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm text-primary flex items-center gap-2">
          <Bell className="h-4 w-4" />
          This prescription was auto-populated from your EMR. Review all fields before dispensing.
        </div>
      )}

      <Card className="animate-fade-in">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4 text-primary" />
            Dispensing Form
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleDispense} className="space-y-4">
            {/* ── Patient Information (FDA/DEA) ── */}
            <SectionTitle>Patient Information</SectionTitle>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="patientName">Full Name *</Label>
                <Input
                  id="patientName"
                  value={patientName}
                  onChange={(e) => setPatientName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="patientDOB">Date of Birth *</Label>
                <Input
                  id="patientDOB"
                  type="date"
                  value={patientDOB}
                  onChange={(e) => setPatientDOB(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5 col-span-2 sm:col-span-1">
                <Label htmlFor="patientAddress">Address *</Label>
                <Input
                  id="patientAddress"
                  value={patientAddress}
                  onChange={(e) => setPatientAddress(e.target.value)}
                  placeholder="Street, City, State, ZIP"
                  required
                />
              </div>
              <div className="space-y-1.5 col-span-2 sm:col-span-1">
                <Label htmlFor="patientPhone">Phone</Label>
                <Input
                  id="patientPhone"
                  type="tel"
                  value={patientPhone}
                  onChange={(e) => setPatientPhone(e.target.value)}
                  placeholder="(555) 555-5555"
                />
              </div>
            </div>

            {/* ── Prescriber Information (DEA 21 CFR 1306) ── */}
            <SectionTitle>Prescriber Information</SectionTitle>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="prescriber">Prescriber Name *</Label>
                <Input
                  id="prescriber"
                  value={prescriber}
                  onChange={(e) => setPrescriber(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prescriberDEA">Prescriber DEA #{deaSchedule !== "Non-Controlled" ? " *" : ""}</Label>
                <Input
                  id="prescriberDEA"
                  value={prescriberDEA}
                  onChange={(e) => setPrescriberDEA(e.target.value)}
                  placeholder="e.g. AB1234567"
                  required={deaSchedule !== "Non-Controlled"}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="prescriberNPI">NPI #</Label>
                <Input
                  id="prescriberNPI"
                  value={prescriberNPI}
                  onChange={(e) => setPrescriberNPI(e.target.value)}
                  placeholder="10-digit NPI"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prescriberPhone">Prescriber Phone</Label>
                <Input
                  id="prescriberPhone"
                  type="tel"
                  value={prescriberPhone}
                  onChange={(e) => setPrescriberPhone(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dateWritten">Date Written *</Label>
                <Input
                  id="dateWritten"
                  type="date"
                  value={dateWritten}
                  onChange={(e) => setDateWritten(e.target.value)}
                  required
                />
              </div>
            </div>

            {/* ── Prescription Details ── */}
            <SectionTitle>Prescription &amp; Medication Details</SectionTitle>

            {/* ── Medication Selection ── */}
            {filledFromEmr && prescribedMedName && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm space-y-1">
                <p className="font-medium text-primary">Prescribed Medication (from EMR)</p>
                <p className="text-foreground">{prescribedMedName}</p>
                {!selectedMedId && (
                  <p className="text-xs text-muted-foreground">
                    No matching medication found in inventory. Please select the closest match below.
                  </p>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Medication *</Label>
              <Select value={selectedMedId} onValueChange={setSelectedMedId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select medication..." />
                </SelectTrigger>
                <SelectContent>
                  {medications.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name} ({m.strength}) — {m.quantity} in stock
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedMed && (
              <div className="rounded-lg bg-secondary/50 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{selectedMed.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {selectedMed.strength} · {selectedMed.dosageForm} · NDC:{" "}
                      {selectedMed.ndcNumber}
                      {selectedMed.manufacturer && ` · Mfr: ${selectedMed.manufacturer}`}
                    </p>
                  </div>
                  <Badge
                    variant={
                      selectedMed.quantity <= selectedMed.reorderLevel
                        ? "destructive"
                        : "outline"
                    }
                  >
                    {selectedMed.quantity} available
                  </Badge>
                </div>
                <div className="flex items-center gap-4 text-xs border-t border-border/50 pt-2">
                  <span className="text-muted-foreground">
                    Cost/unit: <span className="font-medium text-foreground">${formatPrice(selectedMed.costPerUnit)}</span>
                  </span>
                  <span className="text-muted-foreground">
                    Price/unit: <span className="font-medium text-foreground">${formatPrice(selectedMed.dispensePricePerUnit)}</span>
                  </span>
                  <span className="text-muted-foreground">
                    Total cost ({quantity}): <span className="font-semibold text-foreground">${formatPrice(selectedMed.dispensePricePerUnit * quantity)}</span>
                  </span>
                </div>
              </div>
            )}
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="rxNumber">Rx Number</Label>
                <Input
                  id="rxNumber"
                  value={rxNumber}
                  onChange={(e) => setRxNumber(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="quantity">Quantity Dispensed *</Label>
                <Input
                  id="quantity"
                  type="number"
                  min={1}
                  max={selectedMed?.quantity || 9999}
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="daysSupply">Days Supply *</Label>
                <Input
                  id="daysSupply"
                  type="number"
                  min={1}
                  value={daysSupply}
                  onChange={(e) => setDaysSupply(Number(e.target.value))}
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="directions">Directions (Sig) *</Label>
              <Input
                id="directions"
                value={directions}
                onChange={(e) => setDirections(e.target.value)}
                placeholder="e.g. Take 1 tablet by mouth twice daily"
                required
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label>DEA Schedule</Label>
                <Select
                  value={deaSchedule}
                  onValueChange={(v) => setDeaSchedule(v as DEASchedule)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DEA_SCHEDULES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lotNumber">Lot Number</Label>
                <Input
                  id="lotNumber"
                  value={lotNumber}
                  onChange={(e) => setLotNumber(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="diagnosisCode">ICD-10 Code</Label>
                <Input
                  id="diagnosisCode"
                  value={diagnosisCode}
                  onChange={(e) => setDiagnosisCode(e.target.value)}
                  placeholder="e.g. E11.9"
                />
              </div>
            </div>

            {/* ── Refill Information (DEA) ── */}
            <SectionTitle>Refill Information</SectionTitle>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="refillsAuthorized">Refills Authorized</Label>
                <Input
                  id="refillsAuthorized"
                  type="number"
                  min={0}
                  max={deaSchedule === "Schedule II" ? 0 : 99}
                  value={refillsAuthorized}
                  onChange={(e) => setRefillsAuthorized(Number(e.target.value))}
                />
                {deaSchedule === "Schedule II" && (
                  <p className="text-xs text-destructive">
                    Schedule II medications cannot be refilled per DEA regulations.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="refillNumber">Refill # (current)</Label>
                <Input
                  id="refillNumber"
                  type="number"
                  min={0}
                  max={refillsAuthorized}
                  value={refillNumber}
                  onChange={(e) => setRefillNumber(Number(e.target.value))}
                />
              </div>
            </div>

            {/* ── Dispensing Pharmacist / Provider ── */}
            <SectionTitle>Dispensing Pharmacist / Provider</SectionTitle>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label>Role *</Label>
                <Select value={dispenserRole} onValueChange={(v) => setDispenserRole(v as typeof dispenserRole)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Pharmacist">Pharmacist</SelectItem>
                    <SelectItem value="Pharmacy Technician">Pharmacy Technician</SelectItem>
                    <SelectItem value="Physician">Physician (MD/DO)</SelectItem>
                    <SelectItem value="Nurse Practitioner">Nurse Practitioner</SelectItem>
                    <SelectItem value="Physician Assistant">Physician Assistant</SelectItem>
                    <SelectItem value="Dentist">Dentist</SelectItem>
                    <SelectItem value="Veterinarian">Veterinarian</SelectItem>
                    <SelectItem value="Other">Other Provider</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dispensedBy">Name *</Label>
                <Input
                  id="dispensedBy"
                  value={dispensedBy}
                  onChange={(e) => setDispensedBy(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pharmacistLicense">License / DEA # *</Label>
                <Input
                  id="pharmacistLicense"
                  value={pharmacistLicense}
                  onChange={(e) => setPharmacistLicense(e.target.value)}
                  placeholder="State license or DEA #"
                  required
                />
              </div>
            </div>

            {/* ── Notes ── */}
            <div className="space-y-1.5">
              <Label htmlFor="notes">Additional Notes</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Allergies, counseling notes, special instructions..."
                rows={3}
              />
            </div>

            <Button type="submit" className="w-full" disabled={!selectedMedId}>
              <ArrowRightLeft className="h-4 w-4 mr-2" />
              Dispense Medication
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Print Label Dialog */}
      <Dialog open={showLabel} onOpenChange={setShowLabel}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Medication Label Preview</DialogTitle>
          </DialogHeader>
          {labelData && (
            <MedicationLabel
              data={labelData}
              onClose={() => setShowLabel(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
