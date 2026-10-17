// Pull newly signed Elation prescriptions whose pharmacy instructions say
// PCVIP or HERO into the pharmacy queue. READ-ONLY toward Elation.
//
// Elation's /medications/ list ignores date filters, but its cursor is a
// base64 "p=<medication id>" position and ids grow over time, so we resume
// from the last id we've seen. Inserts are idempotent on
// elation_prescription_id, so re-scanning a window is safe.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, requireStaff } from "../_shared/auth.ts";
import { detectRxProgram } from "../_shared/rxProgram.ts";

const REST = "https://app.elationemr.com/api/2.0";
const MAX_PAGES = 20;
const UNSIGNED_HOLD_MS = 24 * 60 * 60 * 1000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function token(): Promise<string> {
  const res = await fetch(`${REST}/oauth2/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: Deno.env.get("ELATION_CLIENT_ID") ?? "",
      client_secret: Deno.env.get("ELATION_CLIENT_SECRET") ?? "",
    }).toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Elation sign-in failed [${res.status}]: ${text.slice(0, 200)}`);
  return JSON.parse(text).access_token;
}

const digits = (s: string) => s.replace(/\D/g, "");
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9./]/g, "");

type Med = {
  id: number;
  patient: number;
  is_doc_med: boolean;
  deleted_date: string | null;
  signed_date: string | null;
  created_date: string;
  pharmacy_instructions: string | null;
  directions: string | null;
  qty: string | null;
  days_supply: number | null;
  auth_refills: number | null;
  prescribing_physician: number | null;
  icd10_codes: Array<{ code?: string } | string> | null;
  medication: {
    name: string;
    generic_name?: string;
    strength?: string;
    ndcs?: string[];
    active_ndcs?: string[];
    is_controlled?: boolean;
  };
};

type InvMed = { id: string; name: string; generic_name: string; strength: string; ndc_number: string };

function matchInventory(m: Med, inv: InvMed[]): InvMed | null {
  const ndcs = new Set([...(m.medication.ndcs ?? []), ...(m.medication.active_ndcs ?? [])].map(digits));
  const byNdc = inv.find((i) => i.ndc_number && ndcs.has(digits(i.ndc_number)));
  if (byNdc) return byNdc;
  const names = [m.medication.name, m.medication.generic_name ?? ""].map((n) => n.toLowerCase());
  const strength = squash(m.medication.strength ?? "");
  return (
    inv.find((i) => {
      const n = i.name.toLowerCase();
      const g = (i.generic_name || "").toLowerCase();
      const nameOk = names.some((x) => (n && x.startsWith(n)) || (g && x.startsWith(g)));
      return nameOk && (!strength || !i.strength || squash(i.strength) === strength);
    }) ?? null
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const auth = await requireStaff(req);
  if (auth instanceof Response) return auth;

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: state } = await admin.from("elation_rx_sync_state").select("*").eq("id", true).maybeSingle();
  const startId = Number(state?.last_medication_id ?? 0);
  await admin.from("elation_rx_sync_state").update({ last_run_at: new Date().toISOString() }).eq("id", true);

  try {
    const t = await token();
    const H = { Authorization: `Bearer ${t}`, Accept: "application/json" };
    const get = async (url: string) => {
      const r = await fetch(url, { headers: H });
      const text = await r.text();
      if (!r.ok) throw new Error(`Elation [${r.status}] ${url.replace(REST, "")}: ${text.slice(0, 200)}`);
      return JSON.parse(text);
    };

    const { data: inv } = await admin
      .from("medications")
      .select("id,name,generic_name,strength,ndc_number");

    let url: string | null = `${REST}/medications/?limit=100&cursor=${encodeURIComponent(btoa(`p=${startId}`))}`;
    let maxId = startId;
    let holdId: number | null = null;
    const matches: Med[] = [];
    for (let page = 0; url && page < MAX_PAGES; page++) {
      const d: { next: string | null; results: Med[] } = await get(url);
      for (const m of d.results ?? []) {
        if (m.id <= startId) continue;
        maxId = Math.max(maxId, m.id);
        if (m.is_doc_med || m.deleted_date) continue;
        if (!m.signed_date) {
          // Not signed yet: come back to it later (for up to a day).
          if (Date.now() - Date.parse(m.created_date) < UNSIGNED_HOLD_MS) {
            holdId = holdId == null ? m.id : Math.min(holdId, m.id);
          }
          continue;
        }
        if (detectRxProgram(m.pharmacy_instructions).kind !== "ignore") matches.push(m);
      }
      url = d.next;
    }

    const patientCache = new Map<number, any>();
    const physCache = new Map<number, any>();
    let imported = 0;
    for (const m of matches) {
      const { data: existing } = await admin
        .from("prescription_queue")
        .select("id")
        .eq("elation_prescription_id", String(m.id))
        .maybeSingle();
      if (existing) continue;

      if (!patientCache.has(m.patient)) patientCache.set(m.patient, await get(`${REST}/patients/${m.patient}/`));
      const p = patientCache.get(m.patient);
      let doc: any = null;
      if (m.prescribing_physician) {
        if (!physCache.has(m.prescribing_physician)) {
          physCache.set(m.prescribing_physician, await get(`${REST}/physicians/${m.prescribing_physician}/`));
        }
        doc = physCache.get(m.prescribing_physician);
      }
      const det = detectRxProgram(m.pharmacy_instructions);
      const invMatch = matchInventory(m, (inv ?? []) as InvMed[]);
      const addr = p?.address
        ? [p.address.address_line1, p.address.address_line2, p.address.city, p.address.state, p.address.zip]
            .filter(Boolean).join(", ")
        : null;
      const icd = (m.icd10_codes ?? []).map((c) => (typeof c === "string" ? c : c?.code)).filter(Boolean);

      const { error } = await admin.from("prescription_queue").insert({
        elation_prescription_id: String(m.id),
        elation_patient_id: String(m.patient),
        status: "pending",
        status_reason: det.kind === "needs_review" ? "Note says both PCVIP and HERO — choose a program" : null,
        program: det.kind === "program" ? det.program : null,
        not_in_inventory: !invMatch,
        matched_medication_id: invMatch?.id ?? null,
        patient_name: [p?.first_name, p?.last_name].filter(Boolean).join(" ") || null,
        patient_dob: p?.dob ?? null,
        patient_address: addr,
        patient_phone: p?.phones?.[0]?.phone ?? null,
        prescriber_name: doc
          ? `${doc.first_name ?? ""} ${doc.last_name ?? ""}${doc.credentials ? ", " + doc.credentials : ""}`.trim()
          : null,
        prescriber_npi: doc?.npi ?? null,
        prescriber_dea: doc?.dea ?? null,
        medication_name: m.medication.name,
        medication_strength: m.medication.strength ?? null,
        medication_ndc: invMatch?.ndc_number || m.medication.active_ndcs?.[0] || m.medication.ndcs?.[0] || null,
        quantity: m.qty ? Math.round(Number(m.qty)) : null,
        days_supply: m.days_supply,
        directions: m.directions || null,
        dea_schedule: m.medication.is_controlled ? null : "Non-Controlled",
        refills_authorized: m.auth_refills ?? 0,
        diagnosis_code: icd.join(", ") || null,
        date_written: m.signed_date,
        note_to_pharmacy: m.pharmacy_instructions,
        raw_payload: m as unknown as Record<string, unknown>,
      });
      if (error && !String(error.message).includes("duplicate")) throw new Error(error.message);
      if (!error) imported++;
    }

    const newCursor = holdId != null ? Math.min(holdId - 1, maxId) : maxId;
    await admin.from("elation_rx_sync_state").update({
      last_medication_id: Math.max(newCursor, startId),
      last_success_at: new Date().toISOString(),
      last_error: null,
      last_imported: imported,
      updated_at: new Date().toISOString(),
    }).eq("id", true);

    return json({ ok: true, imported, matched: matches.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[elation-rx-sync]", msg);
    await admin.from("elation_rx_sync_state").update({ last_error: msg.slice(0, 500), updated_at: new Date().toISOString() }).eq("id", true);
    return json({ ok: false, error: msg }, 502);
  }
});
