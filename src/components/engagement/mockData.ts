import type { EngagementPatient } from "./types";

export const reportDefaults = {
  startDate: new Date("2025-10-01"),
  endDate: new Date("2026-04-18"),
  employer: "all" as string,
  dpc: "all" as string,
  physician: "all" as string,
};

export const employerOptions = [
  "Aligned Marketplace",
  "Ernst & Young",
  "KD Nutra",
  "Mind And Mobility",
  "Persona Healthcare Direct",
  "Prime Care VIP Health - Retail",
];

export const dpcOptions = ["PrimeCare VIP", "Hero Healthcare"];

export const physicianOptions = [
  "Jarrod Frydman",
  "Lainey Kieffer",
  "Melissa Buchanan",
  "Michael Kieffer",
  "Nicole Aguila",
  "Raphael Lopez",
  "Shannon Nelson",
];

// Sample patient population used to power every drill-down view.
// In production this would come from Hint + Elation joined queries.
export const enrolledPatients: EngagementPatient[] = [
  { id: "VIP-9942-A", name: "Ryan Spam",          employer: "Acme Holdings",      dpc: "PrimeCare VIP",   physician: "Dr. Patel",    lastEncounter: "2026-04-16", encounters: 4, rxOrders: 12, messages: 3, afterHours: true,  digital: true,  flag: "High touch" },
  { id: "VIP-8210-C", name: "Marisol Beltran",    employer: "Bridgewater Group",  dpc: "PrimeCare VIP",   physician: "Dr. Cho",      lastEncounter: "2026-04-15", encounters: 2, rxOrders: 6,  messages: 1, afterHours: false, digital: true },
  { id: "VIP-1104-E", name: "Wendell Park",       employer: "Acme Holdings",      dpc: "PrimeCare VIP",   physician: "Dr. Patel",    lastEncounter: "2026-04-14", encounters: 1, rxOrders: 3,  messages: 0, afterHours: false, digital: false, flag: "CKD" },
  { id: "HH-3382-B",  name: "Anita Torres",       employer: "Hero Logistics",     dpc: "Hero Healthcare", physician: "Dr. Singh",    lastEncounter: "2026-04-12", encounters: 3, rxOrders: 9,  messages: 4, afterHours: true,  digital: true },
  { id: "HH-4501-D",  name: "Jordan Mahoney",     employer: "Hero Logistics",     dpc: "Hero Healthcare", physician: "Dr. Singh",    lastEncounter: "2026-04-10", encounters: 0, rxOrders: 0,  messages: 0, afterHours: false, digital: false, flag: "No-touch" },
  { id: "VIP-6620-F", name: "Priya Ramachandran", employer: "Bridgewater Group",  dpc: "PrimeCare VIP",   physician: "Dr. Cho",      lastEncounter: "2026-04-09", encounters: 5, rxOrders: 14, messages: 6, afterHours: true,  digital: true,  flag: "CHF" },
  { id: "VIP-7732-G", name: "Diego Alvarez",      employer: "Acme Holdings",      dpc: "PrimeCare VIP",   physician: "Dr. Patel",    lastEncounter: "2026-04-08", encounters: 2, rxOrders: 4,  messages: 2, afterHours: false, digital: true },
  { id: "HH-2210-J",  name: "Faith Okonkwo",      employer: "Hero Logistics",     dpc: "Hero Healthcare", physician: "Dr. Singh",    lastEncounter: "2026-04-05", encounters: 1, rxOrders: 1,  messages: 1, afterHours: false, digital: false },
  { id: "VIP-5511-K", name: "Theodore Lin",       employer: "Bridgewater Group",  dpc: "PrimeCare VIP",   physician: "Dr. Cho",      lastEncounter: "2026-04-04", encounters: 3, rxOrders: 7,  messages: 2, afterHours: true,  digital: true },
  { id: "VIP-9081-L", name: "Selene Carrasco",    employer: "Acme Holdings",      dpc: "PrimeCare VIP",   physician: "Dr. Patel",    lastEncounter: "2026-04-02", encounters: 4, rxOrders: 11, messages: 5, afterHours: true,  digital: true,  flag: "Diabetic" },
  { id: "HH-7741-M",  name: "Bennett Hayes",      employer: "Hero Logistics",     dpc: "Hero Healthcare", physician: "Dr. Singh",    lastEncounter: "2026-03-30", encounters: 2, rxOrders: 5,  messages: 1, afterHours: false, digital: false },
  { id: "VIP-3320-N", name: "Camille Devereux",   employer: "Bridgewater Group",  dpc: "PrimeCare VIP",   physician: "Dr. Cho",      lastEncounter: "2026-03-28", encounters: 1, rxOrders: 2,  messages: 0, afterHours: false, digital: true },
  { id: "VIP-1180-P", name: "Rashid El-Amin",     employer: "Acme Holdings",      dpc: "PrimeCare VIP",   physician: "Dr. Patel",    lastEncounter: "2025-12-12", encounters: 1, rxOrders: 2,  messages: 0, afterHours: false, digital: false },
  { id: "HH-9912-Q",  name: "Margot Sinclair",    employer: "Hero Logistics",     dpc: "Hero Healthcare", physician: "Dr. Singh",    lastEncounter: "2025-11-05", encounters: 2, rxOrders: 3,  messages: 1, afterHours: false, digital: true },
];

export interface ReportFilters {
  startDate: Date;
  endDate: Date;
  employer: string;   // "all" | employer name
  dpc: string;
  physician: string;
}

export const filterPatientsByReport = (
  patients: EngagementPatient[],
  f: ReportFilters,
): EngagementPatient[] => {
  const start = f.startDate.toISOString().slice(0, 10);
  const end = f.endDate.toISOString().slice(0, 10);
  return patients.filter((p) => {
    if (p.lastEncounter < start || p.lastEncounter > end) return false;
    if (f.employer !== "all" && p.employer !== f.employer) return false;
    if (f.dpc !== "all" && p.dpc !== f.dpc) return false;
    if (f.physician !== "all" && p.physician !== f.physician) return false;
    return true;
  });
};

export type MetricKey =
  | "active-patients"
  | "total-active"
  | "encounters"
  | "encounter-types"
  | "after-hours-encounters"
  | "patient-touch"
  | "rx-orders"
  | "rx-breakdown"
  | "after-hours-rx"
  | "messages"
  | "message-types"
  | "after-hours-messages"
  | "digital-engagement";

export interface MetricTile {
  key: MetricKey;
  title: string;
  description: string;
  /** Pull a list of patients out of the filtered population. */
  patients: (filtered: EngagementPatient[]) => EngagementPatient[];
  /** Compute the headline number from the filtered population. */
  primary: (filtered: EngagementPatient[]) => string;
  primaryUnit?: string;
  /** Optional secondary stat chips. */
  secondary?: (filtered: EngagementPatient[]) => { value: string; label: string }[];
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const fmt = (n: number) => n.toLocaleString();
const pct = (n: number, d: number) => (d === 0 ? "0%" : `${((n / d) * 100).toFixed(1)}%`);

export const metricTiles: MetricTile[] = [
  {
    key: "active-patients",
    title: "Active Patients (As of End Date)",
    description: "Total active patients as of end date.",
    patients: (f) => f,
    primary: (f) => fmt(f.length),
    secondary: (f) => {
      const recent = f.filter((p) => p.encounters > 0 && p.lastEncounter >= "2026-04-11").length;
      return [{ value: `↑ ${recent}`, label: "Last 7 days" }];
    },
  },
  {
    key: "total-active",
    title: "Total Active Patients (Selected Duration)",
    description: "Total signed-up active patients in this window.",
    patients: (f) => f,
    primary: (f) => fmt(f.length),
  },
  {
    key: "encounters",
    title: "Total # Encounters",
    description: "Total encounters during selected timeframe.",
    patients: (f) => f.filter((p) => p.encounters > 0),
    primary: (f) => fmt(sum(f.map((p) => p.encounters))),
  },
  {
    key: "encounter-types",
    title: "Encounter Types · Breakdown",
    description: "Encounter mix by type.",
    patients: (f) => f.filter((p) => p.encounters > 0),
    primary: () => "100",
    primaryUnit: "%",
    secondary: () => [{ value: "100%", label: "In-Person" }],
  },
  {
    key: "after-hours-encounters",
    title: "Total # After-Hours Encounters",
    description: "Total encounters after hours and weekends.",
    patients: (f) => f.filter((p) => p.afterHours && p.encounters > 0),
    primary: (f) => fmt(sum(f.filter((p) => p.afterHours).map((p) => p.encounters))),
  },
  {
    key: "patient-touch",
    title: "Patient Touch Ratio",
    description: "Percent of active patients with encounters.",
    patients: (f) => f.filter((p) => p.encounters > 0),
    primary: (f) => {
      if (f.length === 0) return "0";
      const touched = f.filter((p) => p.encounters > 0).length;
      return ((touched / f.length) * 100).toFixed(1);
    },
    primaryUnit: "%",
  },
  {
    key: "rx-orders",
    title: "Prescription Orders",
    description: "Overall and refill prescriptions.",
    patients: (f) => f.filter((p) => p.rxOrders > 0),
    primary: (f) => fmt(sum(f.map((p) => p.rxOrders))),
    secondary: (f) => {
      const total = sum(f.map((p) => p.rxOrders));
      const refills = Math.round(total * 0.226);
      return [
        { value: fmt(refills), label: "Refills" },
        { value: pct(refills, total), label: "Refill rate" },
      ];
    },
  },
  {
    key: "rx-breakdown",
    title: "Prescription Orders · Breakdown",
    description: "Channel mix for prescription fulfillment.",
    patients: (f) => f.filter((p) => p.rxOrders > 0),
    primary: () => "57.8",
    primaryUnit: "%",
    secondary: () => [
      { value: "57.8%", label: "In-Office" },
      { value: "37.4%", label: "Retail" },
      { value: "4.7%",  label: "Mail" },
    ],
  },
  {
    key: "after-hours-rx",
    title: "Total # After-Hours Prescriptions",
    description: "Prescriptions ordered after hours.",
    patients: (f) => f.filter((p) => p.afterHours && p.rxOrders > 0),
    primary: (f) => fmt(sum(f.filter((p) => p.afterHours).map((p) => p.rxOrders))),
    secondary: (f) => {
      const total = sum(f.filter((p) => p.afterHours).map((p) => p.rxOrders));
      const refills = Math.round(total * 0.265);
      return [
        { value: fmt(refills), label: "Refills" },
        { value: pct(refills, total), label: "Refill rate" },
      ];
    },
  },
  {
    key: "messages",
    title: "Total # Messages",
    description: "Total messages during selected timeframe.",
    patients: (f) => f.filter((p) => p.messages > 0),
    primary: (f) => fmt(sum(f.map((p) => p.messages))),
  },
  {
    key: "message-types",
    title: "Message Types · Breakdown",
    description: "Mix between chat and clinical note messages.",
    patients: (f) => f.filter((p) => p.messages > 0),
    primary: () => "90.5",
    primaryUnit: "%",
    secondary: () => [
      { value: "90.5%", label: "Chat" },
      { value: "9.5%",  label: "Note" },
    ],
  },
  {
    key: "after-hours-messages",
    title: "Total # After-Hours Messages",
    description: "Messages exchanged after hours and weekends.",
    patients: (f) => f.filter((p) => p.afterHours && p.messages > 0),
    primary: (f) => fmt(sum(f.filter((p) => p.afterHours).map((p) => p.messages))),
  },
  {
    key: "digital-engagement",
    title: "Digital Engagement",
    description: "Digital-only engagements (portal/app).",
    patients: (f) => f.filter((p) => p.digital),
    primary: (f) => fmt(f.filter((p) => p.digital).length),
    secondary: (f) => {
      const digital = f.filter((p) => p.digital).length;
      const afterHours = f.filter((p) => p.digital && p.afterHours).length;
      return [
        { value: fmt(afterHours), label: "After-hours" },
        { value: pct(afterHours, digital), label: "Share" },
      ];
    },
  },
];
