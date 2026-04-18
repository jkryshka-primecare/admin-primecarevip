import { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";

const frequencyOptions = ["Daily", "Weekly", "Bi-Weekly", "Monthly", "Custom"] as const;
const notificationMethods = [
  { id: "in-app", label: "In-App Alert" },
  { id: "email", label: "Email" },
  { id: "sms", label: "SMS" },
  { id: "messaging", label: "Messaging App" },
] as const;

const savedPharmacies = [
  { id: "ph-1", name: "CVS Pharmacy — 1200 Main St" },
  { id: "ph-2", name: "Walgreens — 450 Oak Ave" },
  { id: "ph-3", name: "Rite Aid — 78 Elm Blvd" },
];

interface MedicationInfo {
  patient: string;
  medication: string;
  refillDate: string;
}

interface ReminderModalProps {
  medication: MedicationInfo | null;
  /** All meds for this patient sharing the same refill date (includes the primary). */
  groupedMedications?: MedicationInfo[];
  onClose: () => void;
}

const firstName = (patient: string) => patient.split(",")[0];

const buildDefaultMessage = (meds: MedicationInfo[]) => {
  if (meds.length === 0) return "";
  const name = firstName(meds[0].patient);
  const date = meds[0].refillDate;
  if (meds.length === 1) {
    return `Hi ${name}, this is a reminder that your ${meds[0].medication} refill is coming up on ${date}. Are you ready to have this refill sent to your pharmacy? Please reply YES to confirm or contact us to update your preferred pharmacy.`;
  }
  const list = meds.map((m) => `• ${m.medication}`).join("\n");
  return `Hi ${name}, you have ${meds.length} medications due for refill on ${date}:\n${list}\n\nAre you ready to have these refills sent to your pharmacy? Please reply YES to confirm all, or let us know which ones you'd like to skip. You can also update your preferred pharmacy with us.`;
};

const ReminderModal = ({ medication, groupedMedications, onClose }: ReminderModalProps) => {
  const meds = groupedMedications && groupedMedications.length > 0
    ? groupedMedications
    : medication ? [medication] : [];
  const isGrouped = meds.length > 1;

  const [frequency, setFrequency] = useState("Weekly");
  const [customDays, setCustomDays] = useState("3");
  const [selectedMethods, setSelectedMethods] = useState<string[]>(["in-app"]);
  const [notes, setNotes] = useState("");
  const [messageText, setMessageText] = useState("");
  const [patientConsent, setPatientConsent] = useState<"pending" | "yes" | "no">("pending");
  const [pharmacySelection, setPharmacySelection] = useState("ph-1");
  const [customPharmacy, setCustomPharmacy] = useState("");

  useEffect(() => {
    if (medication) {
      setFrequency("Weekly");
      setCustomDays("3");
      setSelectedMethods(["in-app"]);
      setNotes("");
      setMessageText(buildDefaultMessage(meds));
      setPatientConsent("pending");
      setPharmacySelection("ph-1");
      setCustomPharmacy("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [medication, groupedMedications?.length]);

  const toggleMethod = (id: string) => {
    setSelectedMethods((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  };

  const handleSave = () => {
    if (!medication) return;
    if (selectedMethods.length === 0) {
      toast.error("Select at least one notification method.");
      return;
    }
    if (messageText.trim().length === 0) {
      toast.error("Reminder message cannot be empty.");
      return;
    }
    const pharmacy = pharmacySelection === "other"
      ? customPharmacy || "Not specified"
      : savedPharmacies.find((p) => p.id === pharmacySelection)?.name ?? "Unknown";
    const freqLabel = frequency === "Custom" ? `Every ${customDays} days` : frequency;
    const summary = isGrouped
      ? `${meds.length} medications consolidated — ${freqLabel} via ${selectedMethods.join(", ")} · Pharmacy: ${pharmacy}`
      : `${medication.medication} — ${freqLabel} via ${selectedMethods.join(", ")} · Pharmacy: ${pharmacy}`;
    toast.success(`Reminder set for ${medication.patient}`, { description: summary });
    onClose();
  };

  const btnClass = (active: boolean) =>
    `px-4 py-2.5 rounded text-xs font-bold uppercase tracking-wider transition-colors ${
      active
        ? "bg-accent text-accent-foreground"
        : "bg-secondary text-muted-foreground hover:text-foreground border border-border"
    }`;

  return (
    <Dialog open={!!medication} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-card border-border max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-foreground text-lg font-medium tracking-tight">
            {isGrouped ? "Configure Consolidated Refill Reminder" : "Configure Refill Reminder"}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-sm">
            {medication && (
              <>
                <span className="text-accent font-mono">{medication.patient}</span>
                {isGrouped ? (
                  <> — {meds.length} medications · Refill date <span className="font-mono">{medication.refillDate}</span></>
                ) : (
                  <> — {medication.medication} · Next refill <span className="font-mono">{medication.refillDate}</span></>
                )}
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          {/* Grouped notice */}
          {isGrouped && (
            <div className="rounded border border-accent/30 bg-accent/10 p-4 space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-accent">
                Consolidated into one message
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {meds.length} medications share this refill date and will be sent in a single notification:
              </p>
              <ul className="text-xs text-foreground space-y-1 pl-1">
                {meds.map((m) => (
                  <li key={m.medication} className="font-mono">• {m.medication}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Patient Consent */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Patient Ready to Receive Refill{isGrouped ? "s" : ""}?
            </label>
            <div className="flex gap-2">
              {(["pending", "yes", "no"] as const).map((opt) => (
                <button
                  key={opt}
                  onClick={() => setPatientConsent(opt)}
                  className={`px-5 py-3 rounded text-xs font-bold uppercase tracking-wider transition-colors ${
                    patientConsent === opt
                      ? opt === "yes"
                        ? "bg-accent/20 text-accent border border-accent/30"
                        : opt === "no"
                        ? "bg-destructive/15 text-destructive border border-destructive/30"
                        : "bg-muted text-muted-foreground border border-border"
                      : "bg-secondary text-muted-foreground hover:text-foreground border border-border"
                  }`}
                >
                  {opt === "pending" ? "Awaiting Response" : opt === "yes" ? "Yes — Confirmed" : "No — Declined"}
                </button>
              ))}
            </div>
          </div>

          {/* Preferred Pharmacy */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Preferred Pharmacy
            </label>
            <div className="space-y-2">
              {savedPharmacies.map((ph) => (
                <button
                  key={ph.id}
                  onClick={() => setPharmacySelection(ph.id)}
                  className={`w-full px-4 py-3 rounded text-xs font-bold transition-colors text-left ${
                    pharmacySelection === ph.id
                      ? "bg-accent/15 text-accent border border-accent/30"
                      : "bg-secondary text-muted-foreground hover:text-foreground border border-border"
                  }`}
                >
                  {ph.name}
                </button>
              ))}
              <button
                onClick={() => setPharmacySelection("other")}
                className={`w-full px-4 py-3 rounded text-xs font-bold transition-colors text-left ${
                  pharmacySelection === "other"
                    ? "bg-accent/15 text-accent border border-accent/30"
                    : "bg-secondary text-muted-foreground hover:text-foreground border border-border"
                }`}
              >
                Other — Enter Manually
              </button>
              {pharmacySelection === "other" && (
                <input
                  type="text"
                  value={customPharmacy}
                  onChange={(e) => setCustomPharmacy(e.target.value)}
                  placeholder="Enter pharmacy name and address…"
                  className="w-full px-4 py-3 rounded bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent/40"
                />
              )}
            </div>
          </div>

          {/* Reminder Message */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Reminder Message {isGrouped && <span className="text-accent">(consolidated)</span>}
            </label>
            <textarea
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              rows={isGrouped ? 8 : 4}
              className="w-full px-4 py-3 rounded bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent/40 resize-none leading-relaxed"
            />
            <button
              onClick={() => setMessageText(buildDefaultMessage(meds))}
              className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
            >
              ↻ Reset to Default
            </button>
          </div>

          {/* Frequency */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Reminder Frequency
            </label>
            <div className="flex flex-wrap gap-2">
              {frequencyOptions.map((opt) => (
                <button key={opt} onClick={() => setFrequency(opt)} className={btnClass(frequency === opt)}>
                  {opt}
                </button>
              ))}
            </div>
            {frequency === "Custom" && (
              <div className="flex items-center gap-2 pt-1">
                <span className="text-xs text-muted-foreground">Every</span>
                <input
                  type="number"
                  min={1}
                  max={90}
                  value={customDays}
                  onChange={(e) => setCustomDays(e.target.value)}
                  className="w-16 px-3 py-2 rounded bg-secondary border border-border text-sm text-foreground font-mono text-center focus:outline-none focus:ring-1 focus:ring-accent/40"
                />
                <span className="text-xs text-muted-foreground">days</span>
              </div>
            )}
          </div>

          {/* Notification Method */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Notification Method
            </label>
            <div className="grid grid-cols-2 gap-2">
              {notificationMethods.map((method) => (
                <button
                  key={method.id}
                  onClick={() => toggleMethod(method.id)}
                  className={`px-4 py-3 rounded text-xs font-bold transition-colors text-left ${
                    selectedMethods.includes(method.id)
                      ? "bg-accent/15 text-accent border border-accent/30"
                      : "bg-secondary text-muted-foreground hover:text-foreground border border-border"
                  }`}
                >
                  {method.label}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Patient prefers morning reminders…"
              rows={2}
              className="w-full px-4 py-3 rounded bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent/40 resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              onClick={handleSave}
              className="flex-1 px-6 py-3 bg-accent text-accent-foreground text-xs font-bold uppercase tracking-wider rounded hover:opacity-90 transition-opacity"
            >
              {isGrouped ? `Save Consolidated Reminder (${meds.length})` : "Save Reminder"}
            </button>
            <button
              onClick={onClose}
              className="px-6 py-3 bg-secondary text-muted-foreground text-xs font-bold uppercase tracking-wider rounded border border-border hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ReminderModal;
