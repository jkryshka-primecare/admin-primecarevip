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
  onClose: () => void;
}

const defaultMessage = (med: MedicationInfo) =>
  `Hi ${med.patient.split(",")[0]}, this is a reminder that your ${med.medication} refill is coming up on ${med.refillDate}. Are you ready to have this refill sent to your pharmacy? Please reply YES to confirm or contact us to update your preferred pharmacy.`;

const ReminderModal = ({ medication, onClose }: ReminderModalProps) => {
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
      setMessageText(defaultMessage(medication));
      setPatientConsent("pending");
      setPharmacySelection("ph-1");
      setCustomPharmacy("");
    }
  }, [medication]);

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
    toast.success(`Reminder set for ${medication.patient}`, {
      description: `${medication.medication} — ${freqLabel} via ${selectedMethods.join(", ")} · Pharmacy: ${pharmacy}`,
    });
    onClose();
  };

  const btnClass = (active: boolean) =>
    `px-4 py-2.5 rounded text-xs font-bold uppercase tracking-wider transition-colors ${
      active
        ? "bg-sapphire text-primary-foreground"
        : "bg-secondary text-muted-foreground hover:text-foreground border border-border"
    }`;

  return (
    <Dialog open={!!medication} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-card border-border max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-foreground text-lg font-medium tracking-tight">
            Configure Refill Reminder
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-sm">
            {medication && (
              <>
                <span className="text-cyan-clinical font-mono">{medication.patient}</span>
                {" — "}{medication.medication}{" · Next refill "}
                <span className="font-mono">{medication.refillDate}</span>
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          {/* Patient Consent */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Patient Ready to Receive Refill?
            </label>
            <div className="flex gap-2">
              {(["pending", "yes", "no"] as const).map((opt) => (
                <button
                  key={opt}
                  onClick={() => setPatientConsent(opt)}
                  className={`px-5 py-3 rounded text-xs font-bold uppercase tracking-wider transition-colors ${
                    patientConsent === opt
                      ? opt === "yes"
                        ? "bg-cyan-clinical/20 text-cyan-clinical border border-cyan-clinical/30"
                        : opt === "no"
                        ? "bg-hcc-alert/15 text-hcc-alert border border-hcc-alert/30"
                        : "bg-yellow-500/15 text-yellow-400 border border-yellow-500/30"
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
                      ? "bg-cyan-clinical/15 text-cyan-clinical border border-cyan-clinical/30"
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
                    ? "bg-cyan-clinical/15 text-cyan-clinical border border-cyan-clinical/30"
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
                  className="w-full px-4 py-3 rounded bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-cyan-clinical/40"
                />
              )}
            </div>
          </div>

          {/* Reminder Message */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Reminder Message
            </label>
            <textarea
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              rows={4}
              className="w-full px-4 py-3 rounded bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-cyan-clinical/40 resize-none leading-relaxed"
            />
            <button
              onClick={() => medication && setMessageText(defaultMessage(medication))}
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
                  className="w-16 px-3 py-2 rounded bg-secondary border border-border text-sm text-foreground font-mono text-center focus:outline-none focus:ring-1 focus:ring-cyan-clinical/40"
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
                      ? "bg-cyan-clinical/15 text-cyan-clinical border border-cyan-clinical/30"
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
              className="w-full px-4 py-3 rounded bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-cyan-clinical/40 resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              onClick={handleSave}
              className="flex-1 px-6 py-3 bg-sapphire text-primary-foreground text-xs font-bold uppercase tracking-wider rounded hover:opacity-90 transition-opacity"
            >
              Save Reminder
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
