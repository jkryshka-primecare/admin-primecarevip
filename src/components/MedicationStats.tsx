import { useState } from "react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import ReminderModal from "@/components/ReminderModal";

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
  { id: 11, patient: "Garcia, M.", medication: "Atorvastatin 20mg", category: "Chronic / Routine", refillDate: "2026-04-18", daysLeft: 2, status: "urgent" },
  { id: 12, patient: "Garcia, M.", medication: "Aspirin 81mg", category: "Preventive", refillDate: "2026-04-18", daysLeft: 2, status: "urgent" },
  { id: 13, patient: "Thompson, R.", medication: "Glipizide 5mg", category: "Chronic / Routine", refillDate: "2026-04-22", daysLeft: 6, status: "due-soon" },
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


const MedicationStats = () => {
  const [activeCategory, setActiveCategory] = useState("All");
  const [searchTerm, setSearchTerm] = useState("");
  const [reminderMed, setReminderMed] = useState<Medication | null>(null);

  const filtered = medications.filter((m) => {
    const matchesCat = activeCategory === "All" || m.category === activeCategory;
    const matchesSearch =
      m.patient.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.medication.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesCat && matchesSearch;
  });

  // Group by patient + refillDate to detect consolidation opportunities
  const groupKey = (m: Medication) => `${m.patient}|${m.refillDate}`;
  const groupCounts = medications.reduce<Record<string, number>>((acc, m) => {
    const k = groupKey(m);
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const getGroup = (med: Medication) =>
    medications.filter((m) => groupKey(m) === groupKey(med));

  const openReminder = (med: Medication) => setReminderMed(med);
  const groupedForReminder = reminderMed ? getGroup(reminderMed) : undefined;

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
                <TableCell className="font-mono text-sm text-foreground">
                  <div className="flex items-center gap-2">
                    {med.refillDate}
                    {groupCounts[`${med.patient}|${med.refillDate}`] > 1 && (
                      <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-cyan-clinical/15 text-cyan-clinical border border-cyan-clinical/30">
                        +{groupCounts[`${med.patient}|${med.refillDate}`] - 1} same day
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="font-mono text-sm text-foreground">{med.daysLeft}</TableCell>
                <TableCell>
                  <span className={`px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider border ${statusStyle[med.status]}`}>
                    {statusLabel[med.status]}
                  </span>
                </TableCell>
                <TableCell>
                  <button
                    onClick={() => openReminder(med)}
                    className="px-4 py-2.5 rounded bg-sapphire/10 text-sapphire border border-sapphire/20 text-xs font-bold hover:bg-sapphire/20 transition-colors whitespace-nowrap"
                  >
                    {groupCounts[`${med.patient}|${med.refillDate}`] > 1
                      ? `Set Reminder (${groupCounts[`${med.patient}|${med.refillDate}`]})`
                      : "Set Reminder"}
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

      <ReminderModal
        medication={reminderMed}
        groupedMedications={groupedForReminder}
        onClose={() => setReminderMed(null)}
      />
    </div>
  );
};

export default MedicationStats;
