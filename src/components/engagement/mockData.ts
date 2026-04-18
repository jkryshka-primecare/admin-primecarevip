import type { EngagementPatient } from "./types";

export const reportFilters = {
  startDate: "10-01-2025",
  endDate: "04-18-2026",
  employer: "All Sponsored Patients",
  dpc: "All DPCs",
  physician: "All Physicians",
};

// Sample patient population used to power every drill-down view.
// In production this would come from Hint + Elation joined queries.
export const enrolledPatients: EngagementPatient[] = [
  { id: "VIP-9942-A", name: "Ryan Spam",          employer: "Acme Holdings",      physician: "Dr. Patel",    lastEncounter: "2026-04-16", encounters: 4, rxOrders: 12, messages: 3, afterHours: true,  digital: true,  flag: "High touch" },
  { id: "VIP-8210-C", name: "Marisol Beltran",    employer: "Bridgewater Group",  physician: "Dr. Cho",      lastEncounter: "2026-04-15", encounters: 2, rxOrders: 6,  messages: 1, afterHours: false, digital: true },
  { id: "VIP-1104-E", name: "Wendell Park",       employer: "Acme Holdings",      physician: "Dr. Patel",    lastEncounter: "2026-04-14", encounters: 1, rxOrders: 3,  messages: 0, afterHours: false, digital: false, flag: "CKD" },
  { id: "HH-3382-B",  name: "Anita Torres",       employer: "Hero Logistics",     physician: "Dr. Singh",    lastEncounter: "2026-04-12", encounters: 3, rxOrders: 9,  messages: 4, afterHours: true,  digital: true },
  { id: "HH-4501-D",  name: "Jordan Mahoney",     employer: "Hero Logistics",     physician: "Dr. Singh",    lastEncounter: "2026-04-10", encounters: 0, rxOrders: 0,  messages: 0, afterHours: false, digital: false, flag: "No-touch" },
  { id: "VIP-6620-F", name: "Priya Ramachandran", employer: "Bridgewater Group",  physician: "Dr. Cho",      lastEncounter: "2026-04-09", encounters: 5, rxOrders: 14, messages: 6, afterHours: true,  digital: true,  flag: "CHF" },
  { id: "VIP-7732-G", name: "Diego Alvarez",      employer: "Acme Holdings",      physician: "Dr. Patel",    lastEncounter: "2026-04-08", encounters: 2, rxOrders: 4,  messages: 2, afterHours: false, digital: true },
  { id: "HH-2210-J",  name: "Faith Okonkwo",      employer: "Hero Logistics",     physician: "Dr. Singh",    lastEncounter: "2026-04-05", encounters: 1, rxOrders: 1,  messages: 1, afterHours: false, digital: false },
  { id: "VIP-5511-K", name: "Theodore Lin",       employer: "Bridgewater Group",  physician: "Dr. Cho",      lastEncounter: "2026-04-04", encounters: 3, rxOrders: 7,  messages: 2, afterHours: true,  digital: true },
  { id: "VIP-9081-L", name: "Selene Carrasco",    employer: "Acme Holdings",      physician: "Dr. Patel",    lastEncounter: "2026-04-02", encounters: 4, rxOrders: 11, messages: 5, afterHours: true,  digital: true,  flag: "Diabetic" },
  { id: "HH-7741-M",  name: "Bennett Hayes",      employer: "Hero Logistics",     physician: "Dr. Singh",    lastEncounter: "2026-03-30", encounters: 2, rxOrders: 5,  messages: 1, afterHours: false, digital: false },
  { id: "VIP-3320-N", name: "Camille Devereux",   employer: "Bridgewater Group",  physician: "Dr. Cho",      lastEncounter: "2026-03-28", encounters: 1, rxOrders: 2,  messages: 0, afterHours: false, digital: true },
];

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
  primary: string;
  primaryUnit?: string;
  secondary?: { value: string; label: string }[];
  description: string;
  filterPatients: (p: EngagementPatient) => boolean;
}

export const metricTiles: MetricTile[] = [
  {
    key: "active-patients",
    title: "Active Patients (As of End Date)",
    primary: "882",
    secondary: [{ value: "↑ 12", label: "Last 7 days" }],
    description: "Total Active Patients as of End Date.",
    filterPatients: () => true,
  },
  {
    key: "total-active",
    title: "Total Active Patients (Selected Duration)",
    primary: "967",
    description: "Total signed-up active patients.",
    filterPatients: () => true,
  },
  {
    key: "encounters",
    title: "Total # Encounters",
    primary: "1,121",
    description: "Total encounters during selected timeframe.",
    filterPatients: (p) => p.encounters > 0,
  },
  {
    key: "encounter-types",
    title: "Encounter Types · Breakdown",
    primary: "100",
    primaryUnit: "%",
    secondary: [{ value: "100%", label: "In-Person" }],
    description: "Encounter mix by type.",
    filterPatients: (p) => p.encounters > 0,
  },
  {
    key: "after-hours-encounters",
    title: "Total # After-Hours Encounters",
    primary: "344",
    description: "Total encounters after hours and weekends.",
    filterPatients: (p) => p.afterHours && p.encounters > 0,
  },
  {
    key: "patient-touch",
    title: "Patient Touch Ratio",
    primary: "62.9",
    primaryUnit: "%",
    description: "Percent of active patients with encounters.",
    filterPatients: (p) => p.encounters > 0,
  },
  {
    key: "rx-orders",
    title: "Prescription Orders",
    primary: "6,403",
    secondary: [
      { value: "1,445", label: "Refills" },
      { value: "22.6%", label: "Refill rate" },
    ],
    description: "Overall and refill prescriptions.",
    filterPatients: (p) => p.rxOrders > 0,
  },
  {
    key: "rx-breakdown",
    title: "Prescription Orders · Breakdown",
    primary: "57.8",
    primaryUnit: "%",
    secondary: [
      { value: "57.8%", label: "In-Office" },
      { value: "37.4%", label: "Retail" },
      { value: "4.7%",  label: "Mail" },
    ],
    description: "Channel mix for prescription fulfillment.",
    filterPatients: (p) => p.rxOrders > 0,
  },
  {
    key: "after-hours-rx",
    title: "Total # After-Hours Prescriptions",
    primary: "1,844",
    secondary: [
      { value: "488", label: "Refills" },
      { value: "26.5%", label: "Refill rate" },
    ],
    description: "Prescriptions ordered after hours.",
    filterPatients: (p) => p.afterHours && p.rxOrders > 0,
  },
  {
    key: "messages",
    title: "Total # Messages",
    primary: "21",
    description: "Total messages during selected timeframe.",
    filterPatients: (p) => p.messages > 0,
  },
  {
    key: "message-types",
    title: "Message Types · Breakdown",
    primary: "90.5",
    primaryUnit: "%",
    secondary: [
      { value: "90.5%", label: "Chat" },
      { value: "9.5%",  label: "Note" },
    ],
    description: "Mix between chat and clinical note messages.",
    filterPatients: (p) => p.messages > 0,
  },
  {
    key: "after-hours-messages",
    title: "Total # After-Hours Messages",
    primary: "8",
    description: "Messages exchanged after hours and weekends.",
    filterPatients: (p) => p.afterHours && p.messages > 0,
  },
  {
    key: "digital-engagement",
    title: "Digital Engagement",
    primary: "4",
    secondary: [
      { value: "1", label: "After-hours" },
      { value: "25%", label: "Share" },
    ],
    description: "Digital-only engagements (portal/app).",
    filterPatients: (p) => p.digital,
  },
];
