// Pulls READ-ONLY patient + medication data from the elation-sandbox edge
// function and normalises it into the shapes the Pharmacy UI already uses
// (Patient, Medication from src/pages/pharmacy/mockData.ts).
//
// Behaviour:
//   - If Elation sandbox credentials are not configured (the function returns
//     `configured: false`), we fall back to the local mock seeds so the UI
//     keeps working in demos.
//   - When credentials are present, we surface live Elation rows with a
//     `source: "elation"` flag so the UI can show a "Live · Elation Sandbox"
//     banner.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  medications as mockMedications,
  patients as mockPatients,
  type Medication,
  type Patient,
} from "@/pages/pharmacy/mockData";

export type PharmacySource = "mock" | "elation";

export type UseElationPharmacyResult = {
  patients: Patient[];
  medications: Medication[];
  source: PharmacySource;
  status: "loading" | "ready" | "error";
  message?: string;
};

type ElationPatient = {
  id: number | string;
  first_name?: string;
  last_name?: string;
  dob?: string;
  mrn?: string;
  allergies?: Array<{ name?: string } | string>;
};

type ElationMedication = {
  id: number | string;
  ndc?: string;
  brand_name?: string;
  generic_name?: string;
  dosage?: string;
  form?: string;
  manufacturer?: string;
  lot_number?: string;
  expiration_date?: string;
  quantity_on_hand?: number;
  reorder_level?: number;
  unit_price?: number;
  schedule?: string;
  location?: string;
};

type FnEnvelope<T> = {
  configured?: boolean;
  error?: string;
  data?: { results?: T[] } | T[];
};

function normalisePatient(p: ElationPatient): Patient {
  const allergies = (p.allergies ?? [])
    .map((a) => (typeof a === "string" ? a : a?.name))
    .filter((x): x is string => Boolean(x));
  return {
    id: String(p.id),
    mrn: p.mrn ?? `ELN-${p.id}`,
    firstName: p.first_name ?? "",
    lastName: p.last_name ?? "",
    dob: p.dob ?? "",
    allergies,
  };
}

function normaliseMedication(m: ElationMedication): Medication {
  const form = (m.form ?? "tablet") as Medication["form"];
  const schedule = (m.schedule ?? "Rx") as Medication["schedule"];
  return {
    id: String(m.id),
    ndc: m.ndc ?? "",
    name: m.brand_name ?? m.generic_name ?? "Unknown",
    genericName: m.generic_name ?? "",
    dosage: m.dosage ?? "",
    form,
    manufacturer: m.manufacturer ?? "",
    lotNumber: m.lot_number ?? "",
    expirationDate: m.expiration_date ?? "",
    quantityOnHand: m.quantity_on_hand ?? 0,
    reorderLevel: m.reorder_level ?? 0,
    unitPrice: m.unit_price ?? 0,
    schedule,
    location: m.location ?? "",
  };
}

function extractRows<T>(env: FnEnvelope<T> | null | undefined): T[] {
  if (!env?.data) return [];
  if (Array.isArray(env.data)) return env.data;
  return env.data.results ?? [];
}

export function useElationPharmacy(): UseElationPharmacyResult {
  const [state, setState] = useState<UseElationPharmacyResult>({
    patients: mockPatients,
    medications: mockMedications,
    source: "mock",
    status: "loading",
  });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [patientsRes, medsRes] = await Promise.all([
          supabase.functions.invoke("elation-sandbox", {
            body: {
              resource: "patients",
              scope: "rest",
              query: { limit: 50 },
            },
          }),
          supabase.functions.invoke("elation-sandbox", {
            body: {
              resource: "medications",
              scope: "rest",
              query: { limit: 50 },
            },
          }),
        ]);

        if (cancelled) return;

        const pBody = patientsRes.data as FnEnvelope<ElationPatient> | null;
        const mBody = medsRes.data as FnEnvelope<ElationMedication> | null;

        // Either response signalling "awaiting credentials" → stay on mock.
        if (
          pBody?.configured === false ||
          mBody?.configured === false ||
          patientsRes.error ||
          medsRes.error
        ) {
          setState({
            patients: mockPatients,
            medications: mockMedications,
            source: "mock",
            status: "ready",
            message:
              pBody?.error ??
              mBody?.error ??
              patientsRes.error?.message ??
              medsRes.error?.message,
          });
          return;
        }

        const livePatients = extractRows(pBody).map(normalisePatient);
        const liveMeds = extractRows(mBody).map(normaliseMedication);

        setState({
          patients: livePatients.length ? livePatients : mockPatients,
          medications: liveMeds.length ? liveMeds : mockMedications,
          source: livePatients.length || liveMeds.length ? "elation" : "mock",
          status: "ready",
        });
      } catch (err) {
        if (cancelled) return;
        setState({
          patients: mockPatients,
          medications: mockMedications,
          source: "mock",
          status: "error",
          message: err instanceof Error ? err.message : "Unknown error",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
