// Sandbox FHIR-style MedicationRequest endpoint.
// Returns mock medication/refill data shaped like a FHIR Bundle, then
// flattens to the shape the MedicationStats UI expects.

import { corsHeaders, requireStaff, logPhiAccess } from "../_shared/auth.ts";

type FhirMedicationRequest = {
  resourceType: "MedicationRequest";
  id: string;
  status: "active" | "on-hold" | "completed";
  intent: "order";
  category: { text: string }[];
  medicationCodeableConcept: { text: string };
  subject: { reference: string; display: string };
  dispenseRequest: {
    nextRefillDate: string; // ISO date
    quantity: { value: number; unit: string };
  };
};

const today = new Date("2026-04-16T00:00:00Z");

const seed: FhirMedicationRequest[] = [
  mr("rx-001", "Thompson, R.", "Metformin 500mg", "Chronic / Routine", "2026-04-22"),
  mr("rx-002", "Garcia, M.", "Lisinopril 10mg", "Chronic / Routine", "2026-04-18"),
  mr("rx-003", "Chen, L.", "Adderall XR 20mg", "Controlled", "2026-04-25"),
  mr("rx-004", "Williams, J.", "Oxycodone 5mg", "Controlled", "2026-04-17"),
  mr("rx-005", "Patel, S.", "Atorvastatin 40mg", "Chronic / Routine", "2026-05-02"),
  mr("rx-006", "Davis, K.", "Amoxicillin 500mg", "Acute", "2026-04-20"),
  mr("rx-007", "Nguyen, T.", "Amlodipine 5mg", "Chronic / Routine", "2026-04-19"),
  mr("rx-008", "Brown, A.", "Alprazolam 0.5mg", "Controlled", "2026-04-30"),
  mr("rx-009", "Lee, H.", "Flu Vaccine", "Preventive", "2026-10-01"),
  mr("rx-010", "Martinez, C.", "Levothyroxine 50mcg", "Chronic / Routine", "2026-04-21"),
  mr("rx-011", "Garcia, M.", "Atorvastatin 20mg", "Chronic / Routine", "2026-04-18"),
  mr("rx-012", "Garcia, M.", "Aspirin 81mg", "Preventive", "2026-04-18"),
  mr("rx-013", "Thompson, R.", "Glipizide 5mg", "Chronic / Routine", "2026-04-22"),
  mr("rx-014", "Okafor, B.", "Sertraline 50mg", "Chronic / Routine", "2026-04-24"),
  mr("rx-015", "Williams, J.", "Gabapentin 300mg", "Controlled", "2026-04-17"),
];

function mr(
  id: string,
  patient: string,
  medication: string,
  category: string,
  refillDate: string,
): FhirMedicationRequest {
  return {
    resourceType: "MedicationRequest",
    id,
    status: "active",
    intent: "order",
    category: [{ text: category }],
    medicationCodeableConcept: { text: medication },
    subject: {
      reference: `Patient/${id.replace("rx", "pt")}`,
      display: patient,
    },
    dispenseRequest: {
      nextRefillDate: refillDate,
      quantity: { value: 30, unit: "tablet" },
    },
  };
}

function statusFor(daysLeft: number): "urgent" | "due-soon" | "on-track" {
  if (daysLeft <= 2) return "urgent";
  if (daysLeft <= 7) return "due-soon";
  return "on-track";
}

function daysBetween(iso: string): number {
  const target = new Date(`${iso}T00:00:00Z`).getTime();
  return Math.round((target - today.getTime()) / (1000 * 60 * 60 * 24));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const format = url.searchParams.get("format") ?? "ui"; // "ui" | "fhir"
    const category = url.searchParams.get("category"); // optional filter
    const patient = url.searchParams.get("patient"); // optional substring filter

    // Simulate light sandbox latency
    await new Promise((r) => setTimeout(r, 150));

    let resources = seed;
    if (category && category !== "All") {
      resources = resources.filter((r) => r.category[0]?.text === category);
    }
    if (patient) {
      const q = patient.toLowerCase();
      resources = resources.filter(
        (r) =>
          r.subject.display.toLowerCase().includes(q) ||
          r.medicationCodeableConcept.text.toLowerCase().includes(q),
      );
    }

    if (format === "fhir") {
      const bundle = {
        resourceType: "Bundle",
        type: "searchset",
        total: resources.length,
        meta: {
          source: "sandbox.fhir.lovable.local",
          generated: new Date().toISOString(),
        },
        entry: resources.map((r) => ({ resource: r })),
      };
      return new Response(JSON.stringify(bundle), {
        headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
      });
    }

    // Flattened "ui" shape — matches the MedicationStats table.
    const medications = resources.map((r, i) => {
      const daysLeft = daysBetween(r.dispenseRequest.nextRefillDate);
      return {
        id: i + 1,
        rxId: r.id,
        patient: r.subject.display,
        medication: r.medicationCodeableConcept.text,
        category: r.category[0]?.text ?? "Unknown",
        refillDate: r.dispenseRequest.nextRefillDate,
        daysLeft,
        status: statusFor(daysLeft),
      };
    });

    return new Response(
      JSON.stringify({
        source: "sandbox.fhir.lovable.local",
        generated: new Date().toISOString(),
        count: medications.length,
        medications,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
