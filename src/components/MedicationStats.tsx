import { useState } from "react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";

const categories = ["All", "Chronic / Routine", "Controlled", "Acute", "Preventive"];

const medications = [
  { id: 1, patient: "Thompson, R.", medication: "Metformin 500mg", category: "Chronic / Routine", refillDate: "2026-04-22", daysLeft: 6, status: "due-soon" },
  { id: 2, patient: "Garcia, M.", medication: "Lisinopril 10mg", category: "Chronic / Routine", refillDate: "2026-04-18", daysLeft: 2, status: "urgent" },
  { id: 3, patient: "Chen, L.", medication: "Adderall XR 20mg", category: "Controlled", refillDate: "2026-04-25", daysLeft: 9, status: "on-track" },
  { id: 4, patient: "Williams, J.", medication: "Oxycodone 5mg", category: "Controlled", refillDate: "2026-04-17", daysLeft: 1, status: "urgent" },
  { id: 5, patient: "Patel, S.", medication: "Atorvastatin 40mg", category: "Chronic / Routine", refillDate: "2026-05-02", daysLeft: 16, status: "on-track" },
  { id: 6, patient: "Davis, K.", medication: "Amoxicillin 500mg", category: "Acute", refillDate: "2026-04-20", daysLeft: 4, status: "due-soon" },
  { id: 7, patient: "Nguyen, T.", medication: "Amlodipine 5mg", category: "Chronic / Routine", refillDate: "2026-04-19", daysLeft: 3, status: "urgent" },
  { id: 8, patient: "Brown, A.", medication: "Alprazolam 0.5mg", category: "Controlled", refillDate: "2026-04-30", daysLeft: 14, status: "on-track" },
  { id: 9, patient: "Lee, H.", medication: "Flu Vaccine", category: "Preventive", refillDate: "2026-10-01", daysLeft: 168, status: "on-track" },
  { id: 10, patient: "Martinez, C.", medication: "Levothyroxine 50mcg", category: "Chronic / Routine", refillDate: "2026-04-21", daysLeft: 5, status: "due-soon" },
];

type Medication = typeof medications[number];

const statusStyle: Record<string, string> = {
  urgent: "bg-hcc-alert/15 text-hcc-alert border-hcc-alert/30",
  "due-soon": "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  "on-track": "bg-cyan-clinical/15 text-cyan-clinical border-cyan-clinical/30",
};

const statusLabel: Record<string, string> = {
  urgent: "Urgent",
  "due-soon": "Due Soon",
  "on-track": "On Track",
};

const summaryCards = [
  { label: "Total Active Rx", value: "1,247", sub: "Across 312 patients" },
  { label: "Refills Due (7 days)", value: "38", sub: "12 controlled" },
  { label: "Overdue Refills", value: "7", sub: "Action required" },
  { label: "Adherence Rate", value: "87.3%", sub: "+2.1% vs last quarter" },
];

const frequencyOptions = ["Daily", "Weekly", "Bi-Weekly", "Monthly", "Custom"] as const;
const notificationMethods = [
  { id: "in-app", label: "In-App Alert" },
  { id: "email", label: "Email" },
  { id: "sms", label: "SMS" },
  { id: "messaging", label: "Messaging App" },
] as const;

const MedicationStats = () => {
  const [activeCategory, setActiveCategory] = useState("All");
  const [searchTerm, setSearchTerm] = useState("");
  const [reminderMed, setReminderMed] = useState<Medication | null>(null);
  const [frequency, setFrequency] = useState<string>("Weekly");
  const [customDays, setCustomDays] = useState("3");
  const [selectedMethods, setSelectedMethods] = useState<string[]>(["in-app"]);
  const [notes, setNotes] = useState("");

  const filtered = medications.filter((m) => {
    const matchesCat = activeCategory === "All" || m.category === activeCategory;
    const matchesSearch =
      m.patient.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.medication.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesCat && matchesSearch;
  });

  const toggleMethod = (id: string) => {
    setSelectedMethods((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  };

  const handleSaveReminder = () => {
    if (!reminderMed) return;
    if (selectedMethods.length === 0) {
      toast.error("Select at least one notification method.");
      return;
    }
    const freqLabel = frequency === "Custom" ? `Every ${customDays} days` : frequency;
    toast.success(`Reminder set for ${reminderMed.patient}`, {
      description: `${reminderMed.medication} — ${freqLabel} via ${selectedMethods.join(", ")}`,
    });
    setReminderMed(null);
    setFrequency("Weekly");
    setCustomDays("3");
    setSelectedMethods(["in-app"]);
    setNotes("");
  };

  const openReminder = (med: Medication) => {
    setReminderMed(med);
    setFrequency("Weekly");
    setCustomDays("3");
    setSelectedMethods(["in-app"]);
    setNotes("");
  };

  return (
    <div className="space-y-8">
      {/* Summary Cards */}
      <section className="grid grid-cols-4 gap-6">
        {summaryCards.map((card) => (
          <div key={card.label} className="titanium-border rounded-lg bg-card p-6">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
              {card.label}
            </p>
            <p className="text-3xl font-light tracking-tight text-foreground font-mono">
              {card.value}
            </p>
            <p className="text-xs text-muted-foreground mt-1">{card.sub}</p>
          </div>
        ))}
      </section>

      {/* Filters */}
      <section className="titanium-border rounded-lg bg-card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
            Refill Tracker
          </h2>
          <input
            type="text"
            placeholder="Search patient or medication…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="px-4 py-3 rounded bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-cyan-clinical/40 w-72"
          />
        </div>

        <div className="flex gap-2">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-5 py-3 rounded text-xs font-bold uppercase tracking-wider transition-colors ${
                activeCategory === cat
                  ? "bg-sapphire text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:text-foreground border border-border"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <Table>
          <TableHeader>
            <TableRow className="border-border">
              <TableHead className="text-[10px] uppercase tracking-widest">Patient</TableHead>
              <TableHead className="text-[10px] uppercase tracking-widest">Medication</TableHead>
              <TableHead className="text-[10px] uppercase tracking-widest">Category</TableHead>
              <TableHead className="text-[10px] uppercase tracking-widest">Next Refill</TableHead>
              <TableHead className="text-[10px] uppercase tracking-widest">Days Left</TableHead>
              <TableHead className="text-[10px] uppercase tracking-widest">Status</TableHead>
              <TableHead className="text-[10px] uppercase tracking-widest">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((med) => (
              <TableRow key={med.id} className="border-border hover:bg-muted/30">
                <TableCell className="font-mono text-sm text-cyan-clinical cursor-pointer hover:underline">
                  {med.patient}
                </TableCell>
                <TableCell className="text-sm text-foreground">{med.medication}</TableCell>
                <TableCell>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    {med.category}
                  </span>
                </TableCell>
                <TableCell className="font-mono text-sm text-foreground">{med.refillDate}</TableCell>
                <TableCell className="font-mono text-sm text-foreground">{med.daysLeft}</TableCell>
                <TableCell>
                  <span className={`px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider border ${statusStyle[med.status]}`}>
                    {statusLabel[med.status]}
                  </span>
                </TableCell>
                <TableCell>
                  <button
                    onClick={() => openReminder(med)}
                    className="px-4 py-2.5 rounded bg-sapphire/10 text-sapphire border border-sapphire/20 text-xs font-bold hover:bg-sapphire/20 transition-colors"
                  >
                    Set Reminder
                  </button>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  No medications match the current filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>

      {/* Reminder Modal */}
      <Dialog open={!!reminderMed} onOpenChange={(open) => !open && setReminderMed(null)}>
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground text-lg font-medium tracking-tight">
              Configure Refill Reminder
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-sm">
              {reminderMed && (
                <>
                  <span className="text-cyan-clinical font-mono">{reminderMed.patient}</span>
                  {" — "}
                  {reminderMed.medication}
                  {" · Next refill "}
                  <span className="font-mono">{reminderMed.refillDate}</span>
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 pt-2">
            {/* Frequency */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Reminder Frequency
              </label>
              <div className="flex flex-wrap gap-2">
                {frequencyOptions.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => setFrequency(opt)}
                    className={`px-4 py-2.5 rounded text-xs font-bold uppercase tracking-wider transition-colors ${
                      frequency === opt
                        ? "bg-sapphire text-primary-foreground"
                        : "bg-secondary text-muted-foreground hover:text-foreground border border-border"
                    }`}
                  >
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
                onClick={handleSaveReminder}
                className="flex-1 px-6 py-3 bg-sapphire text-primary-foreground text-xs font-bold uppercase tracking-wider rounded hover:opacity-90 transition-opacity"
              >
                Save Reminder
              </button>
              <button
                onClick={() => setReminderMed(null)}
                className="px-6 py-3 bg-secondary text-muted-foreground text-xs font-bold uppercase tracking-wider rounded border border-border hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MedicationStats;
