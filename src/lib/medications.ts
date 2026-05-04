import { supabase } from "@/integrations/supabase/client";

export type UnitType =
  | "Individual Tablet"
  | "Individual Capsule"
  | "Cream/Tube"
  | "Ointment/Tube"
  | "Bottle (30 tablets)"
  | "Bottle (60 tablets)"
  | "Bottle (90 tablets)"
  | "Bottle (120 tablets)"
  | "Bottle (liquid)"
  | "Inhaler"
  | "Injection/Vial"
  | "Pre-filled Syringe"
  | "Pre-dosed Pack"
  | "Patch (box)"
  | "Drops (bottle)"
  | "Suppository (box)"
  | "Bulk";

export const UNIT_TYPES: UnitType[] = [
  "Individual Tablet","Individual Capsule","Cream/Tube","Ointment/Tube",
  "Bottle (30 tablets)","Bottle (60 tablets)","Bottle (90 tablets)","Bottle (120 tablets)",
  "Bottle (liquid)","Inhaler","Injection/Vial","Pre-filled Syringe","Pre-dosed Pack",
  "Patch (box)","Drops (bottle)","Suppository (box)","Bulk",
];

export interface Medication {
  id: string;
  name: string;
  genericName: string;
  category: string;
  dosageForm: string;
  strength: string;
  quantity: number;
  reorderLevel: number;
  costPerUnit: number;
  dispensePricePerUnit: number;
  unitType: UnitType;
  expiryDate: string;
  ndcNumber: string;
  supplier: string;
  manufacturer?: string;
  lotNumber?: string;
  dateInventoried: string;
}

export const DEA_SCHEDULES = ["Non-Controlled","Schedule II","Schedule III","Schedule IV","Schedule V"] as const;
export type DEASchedule = (typeof DEA_SCHEDULES)[number];

export const CATEGORIES = [
  "Analgesics","Antibiotics","Antihypertensives","Antidiabetics","Antihistamines",
  "Cardiovascular","Gastrointestinal","Respiratory","Vitamins & Supplements","Other",
];

export const DOSAGE_FORMS = [
  "Tablet","Capsule","Syrup","Injection","Cream","Ointment","Drops","Inhaler","Patch","Suppository",
];

export const MEDICATIONS_QUERY_KEY = ["medications"] as const;

interface MedicationRow {
  id: string;
  name: string;
  generic_name: string;
  category: string;
  dosage_form: string;
  strength: string;
  quantity: number;
  reorder_level: number;
  cost_per_unit: number | string;
  dispense_price_per_unit: number | string;
  unit_type: string;
  expiry_date: string | null;
  ndc_number: string;
  supplier: string | null;
  manufacturer: string | null;
  lot_number: string | null;
  date_inventoried: string;
}

function mapRow(row: MedicationRow): Medication {
  return {
    id: row.id,
    name: row.name,
    genericName: row.generic_name,
    category: row.category,
    dosageForm: row.dosage_form,
    strength: row.strength,
    quantity: row.quantity,
    reorderLevel: row.reorder_level,
    costPerUnit: Number(row.cost_per_unit),
    dispensePricePerUnit: Number(row.dispense_price_per_unit),
    unitType: row.unit_type as UnitType,
    expiryDate: row.expiry_date ?? "",
    ndcNumber: row.ndc_number,
    supplier: row.supplier ?? "",
    manufacturer: row.manufacturer ?? undefined,
    lotNumber: row.lot_number ?? undefined,
    dateInventoried: row.date_inventoried,
  };
}

function toDbInsert(med: Omit<Medication, "id">) {
  return {
    name: med.name,
    generic_name: med.genericName,
    category: med.category,
    dosage_form: med.dosageForm,
    strength: med.strength,
    quantity: med.quantity,
    reorder_level: med.reorderLevel,
    cost_per_unit: med.costPerUnit,
    dispense_price_per_unit: med.dispensePricePerUnit,
    unit_type: med.unitType,
    expiry_date: med.expiryDate || null,
    ndc_number: med.ndcNumber,
    supplier: med.supplier || null,
    manufacturer: med.manufacturer ?? null,
    lot_number: med.lotNumber ?? null,
    date_inventoried: med.dateInventoried,
  };
}

function toDbUpdate(updates: Partial<Medication>): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  if (updates.name !== undefined) map.name = updates.name;
  if (updates.genericName !== undefined) map.generic_name = updates.genericName;
  if (updates.category !== undefined) map.category = updates.category;
  if (updates.dosageForm !== undefined) map.dosage_form = updates.dosageForm;
  if (updates.strength !== undefined) map.strength = updates.strength;
  if (updates.quantity !== undefined) map.quantity = updates.quantity;
  if (updates.reorderLevel !== undefined) map.reorder_level = updates.reorderLevel;
  if (updates.costPerUnit !== undefined) map.cost_per_unit = updates.costPerUnit;
  if (updates.dispensePricePerUnit !== undefined) map.dispense_price_per_unit = updates.dispensePricePerUnit;
  if (updates.unitType !== undefined) map.unit_type = updates.unitType;
  if (updates.expiryDate !== undefined) map.expiry_date = updates.expiryDate || null;
  if (updates.ndcNumber !== undefined) map.ndc_number = updates.ndcNumber;
  if (updates.supplier !== undefined) map.supplier = updates.supplier || null;
  if (updates.manufacturer !== undefined) map.manufacturer = updates.manufacturer ?? null;
  if (updates.lotNumber !== undefined) map.lot_number = updates.lotNumber ?? null;
  if (updates.dateInventoried !== undefined) map.date_inventoried = updates.dateInventoried;
  return map;
}

export async function fetchMedications(): Promise<Medication[]> {
  const { data, error } = await supabase
    .from("medications")
    .select("*")
    .order("name", { ascending: true });
  if (error) throw error;
  return (data as MedicationRow[]).map(mapRow);
}

export async function fetchMedicationById(id: string): Promise<Medication | null> {
  const { data, error } = await supabase
    .from("medications")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRow(data as MedicationRow) : null;
}

export async function addMedication(med: Omit<Medication, "id">): Promise<Medication> {
  const { data, error } = await supabase
    .from("medications")
    .insert(toDbInsert(med))
    .select()
    .single();
  if (error) throw error;
  return mapRow(data as MedicationRow);
}

export async function updateMedication(id: string, updates: Partial<Medication>): Promise<Medication> {
  const payload = toDbUpdate(updates) as never;
  const { data, error } = await supabase
    .from("medications")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return mapRow(data as MedicationRow);
}

export async function deleteMedication(id: string): Promise<void> {
  const { error } = await supabase.from("medications").delete().eq("id", id);
  if (error) throw error;
}

export async function decrementStock(id: string, qty: number): Promise<Medication> {
  const current = await fetchMedicationById(id);
  if (!current) throw new Error("Medication not found");
  if (current.quantity < qty) throw new Error("Insufficient stock");
  return updateMedication(id, { quantity: current.quantity - qty });
}

export async function incrementStock(id: string, qty: number): Promise<Medication | null> {
  const current = await fetchMedicationById(id);
  if (!current) return null;
  return updateMedication(id, { quantity: current.quantity + qty });
}

export function selectLowStock(meds: Medication[]): Medication[] {
  return meds.filter((m) => m.quantity <= m.reorderLevel);
}

export function selectExpiring(meds: Medication[], withinDays = 90): Medication[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + withinDays);
  return meds.filter((m) => m.expiryDate && new Date(m.expiryDate) <= cutoff);
}

export function selectMergeable(meds: Medication[], target: Medication): Medication[] {
  return meds.filter(
    (m) =>
      m.id !== target.id &&
      m.strength.toLowerCase() === target.strength.toLowerCase() &&
      m.dosageForm.toLowerCase() === target.dosageForm.toLowerCase(),
  );
}

export async function mergeMedications(
  sourceId: string,
  targetId: string,
  transferQty: number,
): Promise<{ remaining: number; transferred: number }> {
  const [source, target] = await Promise.all([
    fetchMedicationById(sourceId),
    fetchMedicationById(targetId),
  ]);
  if (!source || !target) throw new Error("Medication not found");
  if (transferQty <= 0) throw new Error("Transfer quantity must be positive");
  if (transferQty > source.quantity) throw new Error("Transfer quantity exceeds source stock");

  await updateMedication(targetId, { quantity: target.quantity + transferQty });
  const remaining = source.quantity - transferQty;
  if (remaining === 0) {
    await deleteMedication(sourceId);
  } else {
    await updateMedication(sourceId, { quantity: remaining });
  }
  return { remaining, transferred: transferQty };
}

export interface SplitResult {
  newItems: Medication[];
  sourceRemaining: number;
}

export async function splitMedication(
  sourceId: string,
  qtyPerVial: number,
  numberOfVials: number,
): Promise<SplitResult> {
  if (qtyPerVial <= 0 || numberOfVials <= 0) throw new Error("Quantities must be positive");
  const source = await fetchMedicationById(sourceId);
  if (!source) throw new Error("Medication not found");
  const totalNeeded = qtyPerVial * numberOfVials;
  if (totalNeeded > source.quantity) throw new Error("Insufficient stock to split");

  const todayIso = new Date().toISOString().split("T")[0];
  const newItems: Medication[] = [];
  for (let i = 0; i < numberOfVials; i++) {
    const created = await addMedication({
      name: source.name,
      genericName: source.genericName,
      category: source.category,
      dosageForm: source.dosageForm,
      strength: source.strength,
      quantity: qtyPerVial,
      reorderLevel: 0,
      costPerUnit: source.costPerUnit,
      dispensePricePerUnit: source.dispensePricePerUnit,
      unitType: source.unitType,
      expiryDate: source.expiryDate,
      ndcNumber: source.ndcNumber,
      supplier: source.supplier,
      manufacturer: source.manufacturer,
      dateInventoried: todayIso,
    });
    newItems.push(created);
  }

  const remaining = source.quantity - totalNeeded;
  if (remaining === 0) {
    await deleteMedication(sourceId);
  } else {
    await updateMedication(sourceId, { quantity: remaining });
  }
  return { newItems, sourceRemaining: remaining };
}
