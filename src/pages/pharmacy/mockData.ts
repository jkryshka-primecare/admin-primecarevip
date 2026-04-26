// Pharmacy mock data — ported from MediScan Dispense.
// Replace with real Elation/MediScan reads once endpoints are exposed.

export interface Medication {
  id: string;
  ndc: string;
  name: string;
  genericName: string;
  dosage: string;
  form: "tablet" | "capsule" | "liquid" | "injection" | "topical" | "inhaler";
  manufacturer: string;
  lotNumber: string;
  expirationDate: string;
  quantityOnHand: number;
  reorderLevel: number;
  unitPrice: number;
  schedule: "OTC" | "Rx" | "II" | "III" | "IV" | "V";
  location: string;
}

export interface Patient {
  id: string;
  mrn: string;
  firstName: string;
  lastName: string;
  dob: string;
  allergies: string[];
}

export interface DispenseRecord {
  id: string;
  medicationId: string;
  patientId: string;
  quantity: number;
  dispensedBy: string;
  dispensedAt: string;
  status: "pending" | "verified" | "dispensed" | "returned";
}

export const medications: Medication[] = [
  { id: "1", ndc: "0009-0029-01", name: "Lipitor", genericName: "Atorvastatin", dosage: "20mg", form: "tablet", manufacturer: "Pfizer", lotNumber: "LT-2024-0891", expirationDate: "2026-03-15", quantityOnHand: 342, reorderLevel: 100, unitPrice: 1.25, schedule: "Rx", location: "A-12-3" },
  { id: "2", ndc: "0006-0072-31", name: "Januvia", genericName: "Sitagliptin", dosage: "100mg", form: "tablet", manufacturer: "Merck", lotNumber: "LT-2024-1432", expirationDate: "2025-11-30", quantityOnHand: 87, reorderLevel: 100, unitPrice: 14.50, schedule: "Rx", location: "B-04-1" },
  { id: "3", ndc: "0310-0272-90", name: "Advair Diskus", genericName: "Fluticasone/Salmeterol", dosage: "250/50mcg", form: "inhaler", manufacturer: "GSK", lotNumber: "LT-2024-0567", expirationDate: "2025-08-20", quantityOnHand: 24, reorderLevel: 30, unitPrice: 45.00, schedule: "Rx", location: "C-01-2" },
  { id: "4", ndc: "0071-0155-23", name: "Dilantin", genericName: "Phenytoin", dosage: "100mg", form: "capsule", manufacturer: "Pfizer", lotNumber: "LT-2023-9012", expirationDate: "2025-06-10", quantityOnHand: 156, reorderLevel: 50, unitPrice: 0.85, schedule: "Rx", location: "A-08-5" },
  { id: "5", ndc: "59762-5000-1", name: "Metformin", genericName: "Metformin HCl", dosage: "500mg", form: "tablet", manufacturer: "Teva", lotNumber: "LT-2024-2200", expirationDate: "2027-01-01", quantityOnHand: 1200, reorderLevel: 200, unitPrice: 0.12, schedule: "Rx", location: "A-01-1" },
  { id: "6", ndc: "0093-0058-01", name: "Amoxicillin", genericName: "Amoxicillin", dosage: "250mg/5ml", form: "liquid", manufacturer: "Teva", lotNumber: "LT-2024-1890", expirationDate: "2025-09-15", quantityOnHand: 45, reorderLevel: 50, unitPrice: 3.20, schedule: "Rx", location: "D-02-3" },
  { id: "7", ndc: "0078-0401-05", name: "Entresto", genericName: "Sacubitril/Valsartan", dosage: "49/51mg", form: "tablet", manufacturer: "Novartis", lotNumber: "LT-2024-0333", expirationDate: "2026-06-30", quantityOnHand: 60, reorderLevel: 40, unitPrice: 18.75, schedule: "Rx", location: "B-11-2" },
  { id: "8", ndc: "00002-4462-30", name: "Humalog", genericName: "Insulin Lispro", dosage: "100u/ml", form: "injection", manufacturer: "Eli Lilly", lotNumber: "LT-2024-0712", expirationDate: "2025-07-22", quantityOnHand: 18, reorderLevel: 25, unitPrice: 32.00, schedule: "Rx", location: "FRIDGE-01" },
];

export const patients: Patient[] = [
  { id: "p1", mrn: "MRN-001234", firstName: "James", lastName: "Harrison", dob: "1958-04-12", allergies: ["Penicillin"] },
  { id: "p2", mrn: "MRN-001235", firstName: "Maria", lastName: "Santos", dob: "1972-09-30", allergies: [] },
  { id: "p3", mrn: "MRN-001236", firstName: "Robert", lastName: "Chen", dob: "1985-01-18", allergies: ["Sulfa", "Codeine"] },
  { id: "p4", mrn: "MRN-001237", firstName: "Angela", lastName: "Thompson", dob: "1990-07-05", allergies: ["Latex"] },
];

export const dispenseRecords: DispenseRecord[] = [
  { id: "d1", medicationId: "1", patientId: "p1", quantity: 30, dispensedBy: "PharmD Smith", dispensedAt: "2025-04-06T14:30:00Z", status: "dispensed" },
  { id: "d2", medicationId: "5", patientId: "p2", quantity: 60, dispensedBy: "PharmD Smith", dispensedAt: "2025-04-06T15:10:00Z", status: "verified" },
  { id: "d3", medicationId: "3", patientId: "p3", quantity: 1, dispensedBy: "PharmD Lee", dispensedAt: "2025-04-07T09:00:00Z", status: "pending" },
];
