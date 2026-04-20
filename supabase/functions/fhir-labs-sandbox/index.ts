// Sandbox FHIR-style ServiceRequest + DiagnosticReport endpoint for lab orders.
// Returns mock lab order pipeline data shaped like a FHIR Bundle, then
// flattens to the shape the LabOrders UI expects.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type LabStage =
  | "ordered"
  | "collected"
  | "in-lab"
  | "resulted"
  | "reviewed"
  | "notified";

type Priority = "routine" | "urgent" | "stat";

type Vendor = "Quest" | "Labcorp" | "In-House";

type LabOrder = {
  id: string;
  patient: string;
  panel: string;
  loinc: string;
  vendor: Vendor;
  priority: Priority;
  stage: LabStage;
  orderedAt: string; // ISO
  collectedAt?: string;
  resultedAt?: string;
  reviewedAt?: string;
  notifiedAt?: string;
  abnormalFlag?: "H" | "L" | "C" | null; // High / Low / Critical
  orderingProvider: string;
};

const today = new Date("2026-04-16T12:00:00Z");

function iso(daysAgo: number, hourOffset = 0): string {
  const d = new Date(today);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(d.getUTCHours() + hourOffset);
  return d.toISOString();
}

const seed: LabOrder[] = [
  {
    id: "lab-001",
    patient: "Thompson, R.",
    panel: "Comprehensive Metabolic Panel",
    loinc: "24323-8",
    vendor: "Quest",
    priority: "routine",
    stage: "notified",
    orderedAt: iso(5),
    collectedAt: iso(4),
    resultedAt: iso(3),
    reviewedAt: iso(2),
    notifiedAt: iso(1),
    abnormalFlag: null,
    orderingProvider: "Dr. Patel",
  },
  {
    id: "lab-002",
    patient: "Garcia, M.",
    panel: "Lipid Panel",
    loinc: "57698-3",
    vendor: "Quest",
    priority: "routine",
    stage: "reviewed",
    orderedAt: iso(4),
    collectedAt: iso(3),
    resultedAt: iso(1),
    reviewedAt: iso(0, -2),
    abnormalFlag: "H",
    orderingProvider: "Dr. Patel",
  },
  {
    id: "lab-003",
    patient: "Chen, L.",
    panel: "TSH w/ Reflex",
    loinc: "11580-8",
    vendor: "Labcorp",
    priority: "routine",
    stage: "resulted",
    orderedAt: iso(3),
    collectedAt: iso(2),
    resultedAt: iso(0, -4),
    abnormalFlag: null,
    orderingProvider: "Dr. Okafor",
  },
  {
    id: "lab-004",
    patient: "Williams, J.",
    panel: "Troponin I",
    loinc: "10839-9",
    vendor: "In-House",
    priority: "stat",
    stage: "resulted",
    orderedAt: iso(0, -6),
    collectedAt: iso(0, -5),
    resultedAt: iso(0, -3),
    abnormalFlag: "C",
    orderingProvider: "Dr. Patel",
  },
  {
    id: "lab-005",
    patient: "Patel, S.",
    panel: "HbA1c",
    loinc: "4548-4",
    vendor: "Quest",
    priority: "routine",
    stage: "in-lab",
    orderedAt: iso(2),
    collectedAt: iso(1),
    orderingProvider: "Dr. Okafor",
  },
  {
    id: "lab-006",
    patient: "Davis, K.",
    panel: "CBC w/ Differential",
    loinc: "57021-8",
    vendor: "Labcorp",
    priority: "urgent",
    stage: "in-lab",
    orderedAt: iso(1),
    collectedAt: iso(0, -8),
    orderingProvider: "Dr. Patel",
  },
  {
    id: "lab-007",
    patient: "Nguyen, T.",
    panel: "Vitamin D, 25-OH",
    loinc: "62292-8",
    vendor: "Quest",
    priority: "routine",
    stage: "collected",
    orderedAt: iso(1),
    collectedAt: iso(0, -3),
    orderingProvider: "Dr. Okafor",
  },
  {
    id: "lab-008",
    patient: "Brown, A.",
    panel: "Urinalysis, Complete",
    loinc: "24356-8",
    vendor: "In-House",
    priority: "routine",
    stage: "collected",
    orderedAt: iso(0, -10),
    collectedAt: iso(0, -2),
    orderingProvider: "Dr. Patel",
  },
  {
    id: "lab-009",
    patient: "Lee, H.",
    panel: "PSA, Total",
    loinc: "2857-1",
    vendor: "Labcorp",
    priority: "routine",
    stage: "ordered",
    orderedAt: iso(0, -2),
    orderingProvider: "Dr. Okafor",
  },
  {
    id: "lab-010",
    patient: "Martinez, C.",
    panel: "Iron + Ferritin",
    loinc: "2498-4",
    vendor: "Quest",
    priority: "routine",
    stage: "ordered",
    orderedAt: iso(0, -1),
    orderingProvider: "Dr. Patel",
  },
  {
    id: "lab-011",
    patient: "Okafor, B.",
    panel: "Hepatic Function Panel",
    loinc: "24325-3",
    vendor: "Labcorp",
    priority: "routine",
    stage: "resulted",
    orderedAt: iso(2),
    collectedAt: iso(1),
    resultedAt: iso(0, -5),
    abnormalFlag: "H",
    orderingProvider: "Dr. Okafor",
  },
  {
    id: "lab-012",
    patient: "Garcia, M.",
    panel: "Hemoglobin A1c",
    loinc: "4548-4",
    vendor: "Quest",
    priority: "routine",
    stage: "reviewed",
    orderedAt: iso(6),
    collectedAt: iso(5),
    resultedAt: iso(3),
    reviewedAt: iso(2),
    abnormalFlag: "H",
    orderingProvider: "Dr. Patel",
  },
];

function toServiceRequest(o: LabOrder) {
  return {
    resourceType: "ServiceRequest",
    id: o.id,
    status:
      o.stage === "notified" || o.stage === "reviewed"
        ? "completed"
        : "active",
    intent: "order",
    priority: o.priority,
    category: [{ text: "Laboratory" }],
    code: { coding: [{ system: "http://loinc.org", code: o.loinc, display: o.panel }] },
    subject: { reference: `Patient/${o.id.replace("lab", "pt")}`, display: o.patient },
    requester: { display: o.orderingProvider },
    authoredOn: o.orderedAt,
    performer: [{ display: o.vendor }],
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const format = url.searchParams.get("format") ?? "ui";
    const stage = url.searchParams.get("stage");
    const vendor = url.searchParams.get("vendor");
    const patient = url.searchParams.get("patient");

    await new Promise((r) => setTimeout(r, 150));

    let resources = seed;
    if (stage && stage !== "All") {
      resources = resources.filter((r) => r.stage === stage);
    }
    if (vendor && vendor !== "All") {
      resources = resources.filter((r) => r.vendor === vendor);
    }
    if (patient) {
      const q = patient.toLowerCase();
      resources = resources.filter(
        (r) =>
          r.patient.toLowerCase().includes(q) ||
          r.panel.toLowerCase().includes(q),
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
        entry: resources.map((r) => ({ resource: toServiceRequest(r) })),
      };
      return new Response(JSON.stringify(bundle), {
        headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
      });
    }

    const counts: Record<LabStage, number> = {
      ordered: 0,
      collected: 0,
      "in-lab": 0,
      resulted: 0,
      reviewed: 0,
      notified: 0,
    };
    for (const r of seed) counts[r.stage] += 1;

    return new Response(
      JSON.stringify({
        source: "sandbox.fhir.lovable.local",
        generated: new Date().toISOString(),
        count: resources.length,
        pipelineCounts: counts,
        orders: resources,
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
