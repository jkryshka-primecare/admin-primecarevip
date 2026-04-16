import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import ReminderModal from "@/components/ReminderModal";
import { HintDetailDrawer } from "@/components/hint-sandbox/HintDetailDrawer";
import type { HintResponse } from "@/components/hint-sandbox/types";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const categories = ["All", "Chronic / Routine", "Controlled", "Acute", "Preventive"];

type Medication = {
  id: number;
  rxId?: string;
  patient: string;
  patientId?: string; // Hint pat-… id (when joined with the Hint sandbox)
  seedPatient?: string; // original FHIR seed display name, kept for debugging
  medication: string;
  category: string;
  refillDate: string;
  daysLeft: number;
  status: "urgent" | "due-soon" | "on-track";
};

type HintPatient = {
  id: string;
  name?: string;
  first_name?: string;
  last_name?: string;
};

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
  const [rawMedications, setRawMedications] = useState<Medication[]>([]);
  const [hintPatients, setHintPatients] = useState<HintPatient[]>([]);
  const [loading, setLoading] = useState(true);
  const [sandboxMeta, setSandboxMeta] = useState<{ source: string; generated: string } | null>(null);
  const [hintMeta, setHintMeta] = useState<{ count: number; total: number | null } | null>(null);

  // Hint patient detail drawer state
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<HintResponse | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const openPatientDetail = useCallback(async (patientId: string) => {
    setDetailOpen(true);
    setDetailId(patientId);
    setDetail(null);
    setDetailLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke<HintResponse>("hint-sandbox", {
        body: { resource: "patients", id: patientId, scope: "practice", method: "GET" },
      });
      if (error) throw error;
      if (!data) throw new Error("Empty response from Hint sandbox");
      setDetail(data);
      if (data.status >= 400) toast.error(`Hint patients/${patientId} returned ${data.status}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      toast.error(msg);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const loadAll = useCallback(async (isRefresh = false) => {
    setLoading(true);
    try {
      // Fetch FHIR medications and Hint patients in parallel.
      const [fhirRes, hintRes] = await Promise.all([
        supabase.functions.invoke("fhir-medications-sandbox", { method: "GET" }),
        supabase.functions.invoke("hint-sandbox", {
          body: {
            resource: "patients",
            scope: "practice",
            method: "GET",
            query: { limit: 100, offset: 0 },
          },
        }),
      ]);

      if (fhirRes.error) throw fhirRes.error;
      const meds: Medication[] = fhirRes.data?.medications ?? [];
      setRawMedications(meds);
      setSandboxMeta({ source: fhirRes.data.source, generated: fhirRes.data.generated });

      // Hint failures shouldn't block medication display — just log.
      if (hintRes.error) {
        console.warn("Hint patient fetch failed:", hintRes.error);
        setHintPatients([]);
        setHintMeta(null);
      } else {
        const hintData = hintRes.data;
        const patients: HintPatient[] = Array.isArray(hintData?.data) ? hintData.data : [];
        setHintPatients(patients);
        setHintMeta({
          count: patients.length,
          total: hintData?.pagination?.total ?? null,
        });
      }

      if (isRefresh) {
        toast.success("Sandbox data refreshed", {
          description: `${meds.length} Rx · ${(hintRes.data?.data?.length ?? 0)} Hint patients`,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load sandbox data";
      toast.error("Sandbox API error", { description: msg });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Join: replace each med's `patient` with a real Hint patient, grouped by
  // surname seed. Same seed name → same Hint patient (preserves multi-Rx
  // groupings like "Garcia, M. has 3 meds"). If no surname match, fall back
  // to round-robin through the remaining unmatched Hint patients so every
  // medication still gets a real Hint identity.
  const medications = useMemo<Medication[]>(() => {
    if (rawMedications.length === 0) return [];
    if (hintPatients.length === 0) return rawMedications;

    const uniqueSeedNames = Array.from(
      new Set(rawMedications.map((m) => m.patient)),
    );
    const usedHintIds = new Set<string>();
    const seedToHint = new Map<string, HintPatient>();
    let fallbackCursor = 0;

    const findBySurname = (seedName: string): HintPatient | undefined => {
      // "Thompson, R." → surname "thompson"
      const surname = seedName.split(",")[0]?.trim().toLowerCase();
      if (!surname) return undefined;
      return hintPatients.find(
        (p) =>
          !usedHintIds.has(p.id) &&
          p.last_name?.toLowerCase() === surname,
      );
    };

    const nextFallback = (): HintPatient | undefined => {
      while (fallbackCursor < hintPatients.length) {
        const candidate = hintPatients[fallbackCursor++];
        if (!usedHintIds.has(candidate.id)) return candidate;
      }
      // All Hint patients already used — start reusing from the top.
      return hintPatients[0];
    };

    for (const seedName of uniqueSeedNames) {
      const matched = findBySurname(seedName) ?? nextFallback();
      if (matched) {
        usedHintIds.add(matched.id);
        seedToHint.set(seedName, matched);
      }
    }

    return rawMedications.map((m) => {
      const hint = seedToHint.get(m.patient);
      if (!hint) return m;
      const displayName =
        hint.name ??
        [hint.first_name, hint.last_name].filter(Boolean).join(" ") ??
        m.patient;
      return {
        ...m,
        seedPatient: m.patient,
        patient: displayName,
        patientId: hint.id,
      };
    });
  }, [rawMedications, hintPatients]);

  const filtered = medications.filter((m) => {
    const matchesCat = activeCategory === "All" || m.category === activeCategory;
    const term = searchTerm.toLowerCase();
    const matchesSearch =
      m.patient.toLowerCase().includes(term) ||
      m.medication.toLowerCase().includes(term) ||
      (m.patientId?.toLowerCase().includes(term) ?? false);
    return matchesCat && matchesSearch;
  });

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
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
              Refill Tracker
            </h2>
            <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-sapphire/15 text-sapphire border border-sapphire/30">
              Sandbox FHIR API
            </span>
            {hintMeta && (
              <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-cyan-clinical/15 text-cyan-clinical border border-cyan-clinical/30">
                Hint · {hintMeta.count}
                {hintMeta.total !== null ? `/${hintMeta.total}` : ""} patients
              </span>
            )}
            <button
              type="button"
              onClick={() => loadAll(true)}
              disabled={loading}
              aria-label="Refresh sandbox data"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider bg-secondary text-foreground border border-border hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
            {loading && (
              <span className="text-[10px] font-mono text-muted-foreground animate-pulse">
                fetching…
              </span>
            )}
            {!loading && sandboxMeta && (
              <span className="text-[10px] font-mono text-muted-foreground">
                {sandboxMeta.source} · {new Date(sandboxMeta.generated).toLocaleTimeString()}
              </span>
            )}
          </div>
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
                <TableCell>
                  {med.patientId ? (
                    <button
                      type="button"
                      onClick={() => openPatientDetail(med.patientId!)}
                      className="text-left group"
                    >
                      <div className="font-mono text-sm text-cyan-clinical group-hover:underline">
                        {med.patient}
                      </div>
                      <div className="text-[10px] font-mono text-muted-foreground mt-0.5 group-hover:text-foreground">
                        {med.patientId}
                      </div>
                    </button>
                  ) : (
                    <div className="font-mono text-sm text-foreground">{med.patient}</div>
                  )}
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
                  {loading ? "Loading sandbox FHIR data…" : "No medications match the current filters."}
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

      <HintDetailDrawer
        open={detailOpen}
        resource="patients"
        detailId={detailId}
        detail={detail}
        loading={detailLoading}
        onClose={() => setDetailOpen(false)}
      />
    </div>
  );
};

export default MedicationStats;
