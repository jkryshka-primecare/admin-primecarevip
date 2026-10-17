import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { selectExactHintPatient } from "../_shared/hintMatch.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_ROLES = ["admin", "super_admin", "pharmacy"] as const;
const DEFAULT_HINT_API_URL = "https://api.hint.com/api";

type HintPatient = Record<string, unknown>;
type BillingFailureCode = "already_billed" | "patient_not_found" | "ambiguous_match" | "reversed";

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function splitPatientName(fullName: unknown) {
  const name = String(fullName ?? "").trim();
  const parts = name.split(/\s+/).filter(Boolean);
  return { fullName: name, firstName: parts[0] || "", lastName: parts.slice(1).join(" ") || "" };
}

function extractPatientList(payload: unknown): HintPatient[] {
  if (Array.isArray(payload)) return payload as HintPatient[];
  if (payload && typeof payload === "object") {
    const maybeResults = (payload as Record<string, unknown>).results;
    if (Array.isArray(maybeResults)) return maybeResults as HintPatient[];
    const maybeData = (payload as Record<string, unknown>).data;
    if (Array.isArray(maybeData)) return maybeData as HintPatient[];
  }
  return [];
}

async function markBillingFailed(
  admin: ReturnType<typeof createClient>,
  dispenseRecordId: string,
  message: string,
) {
  await admin
    .from("dispense_records")
    .update({ hint_billing_status: "failed", hint_billing_error: message })
    .eq("id", dispenseRecordId);
}

function handledFailure(code: BillingFailureCode, error: string, extra?: Record<string, unknown>) {
  return jsonResponse({ success: false, code, error, ...extra }, 200);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Missing authorization" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claims?.claims?.sub) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    const userId = claims.claims.sub as string;

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: roleRows, error: roleErr } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (roleErr) return jsonResponse({ error: "Role lookup failed" }, 500);

    const roles = (roleRows ?? []).map((row) => row.role as string);
    if (!roles.some((role) => (ALLOWED_ROLES as readonly string[]).includes(role))) {
      return jsonResponse({ error: "Forbidden: insufficient role" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const { dispense_record_id, hint_patient_id_override } = body ?? {};
    if (!dispense_record_id || typeof dispense_record_id !== "string") {
      return jsonResponse({ error: "dispense_record_id is required" }, 400);
    }
    const overrideId =
      typeof hint_patient_id_override === "string" && hint_patient_id_override.trim()
        ? hint_patient_id_override.trim()
        : null;

    const { data: record, error: recError } = await admin
      .from("dispense_records")
      .select("*")
      .eq("id", dispense_record_id)
      .maybeSingle();

    if (recError || !record) {
      return jsonResponse({ error: "Dispense record not found" }, 404);
    }

    if (record.reversed_at) {
      return handledFailure("reversed", "Dispense is reversed; cannot bill");
    }

    if (record.hint_charge_id) {
      return handledFailure("already_billed", "Already billed to Hint", {
        charge_id: record.hint_charge_id,
        status: record.hint_billing_status,
      });
    }

    const hintApiUrl = Deno.env.get("HINT_API_URL") || DEFAULT_HINT_API_URL;
    const hintApiToken = (Deno.env.get("HINT_API_TOKEN")?.trim() || Deno.env.get("HINT_PRACTICE_API_KEY")?.trim());
    if (!hintApiToken) {
      return jsonResponse({ error: "Hint API token not configured" }, 500);
    }

    const { fullName, firstName, lastName } = splitPatientName(record.patient_name);
    let billingPatientId: unknown = null;

    if (overrideId) {
      billingPatientId = overrideId;
    } else {
      const searchParams = new URLSearchParams();
      if (firstName) searchParams.set("first_name", firstName);
      if (lastName) searchParams.set("last_name", lastName);

      const patientSearchRes = await fetch(`${hintApiUrl}/provider/patients?${searchParams.toString()}`, {
        headers: {
          Authorization: `Bearer ${hintApiToken}`,
          "Content-Type": "application/json",
        },
      });

      if (!patientSearchRes.ok) {
        const errText = await patientSearchRes.text();
        const msg = `Hint patient search failed (${patientSearchRes.status}): ${errText.substring(0, 300)}`;
        await markBillingFailed(admin, dispense_record_id, msg);
        return jsonResponse({ error: "Failed to search Hint patients", details: msg }, 502);
      }

      const patientsText = await patientSearchRes.text();
      let patientsPayload: unknown;
      try {
        patientsPayload = JSON.parse(patientsText);
      } catch {
        const msg = `Hint returned non-JSON: ${patientsText.substring(0, 300)}`;
        await markBillingFailed(admin, dispense_record_id, msg);
        return jsonResponse({ error: msg }, 502);
      }

      const patientList = extractPatientList(patientsPayload);
      const match = selectExactHintPatient(patientList, fullName, record.patient_dob);

      if (match.kind === "ambiguous") {
        const msg = `${match.count} Hint patients share this name and date of birth — choose the right one manually`;
        await markBillingFailed(admin, dispense_record_id, msg);
        return handledFailure("ambiguous_match", msg, { searched_name: fullName });
      }
      if (match.kind === "none") {
        const msg = `No exact Hint match for ${fullName} with this date of birth`;
        await markBillingFailed(admin, dispense_record_id, msg);
        return handledFailure("patient_not_found", msg, {
          searched_name: fullName,
          searched_first_name: firstName,
          searched_last_name: lastName,
        });
      }
      const hintPatient = match.patient;

      billingPatientId = hintPatient.head_member_id || hintPatient.id;
    }

    const totalCents = record.total_cost != null
      ? Math.round(Number(record.total_cost) * 100)
      : Math.round((record.unit_price ? Number(record.unit_price) : 1) * (record.quantity || 1) * 100);

    const medName = record.medication_name || "Medication";
    const rxNum = record.rx_number || "";
    const qty = record.quantity || 0;

    const chargePayload = {
      patient_id: billingPatientId,
      amount_cents: totalCents,
      description: `${medName} - Qty: ${qty}${rxNum ? ` (Rx #${rxNum})` : ""}`,
      category: "medication",
      pended: true,
      status: "pended",
      metadata: {
        medication_name: medName,
        ndc: record.medication_id || "",
        quantity: qty,
        rx_number: rxNum,
        dispensed_at: record.dispensed_at,
        lot_number: record.lot_number || "",
        prescriber: record.prescriber || "",
        patient_name: record.patient_name,
        dispense_record_id,
      },
    };

    const chargeRes = await fetch(`${hintApiUrl}/provider/charges`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${hintApiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(chargePayload),
    });

    if (!chargeRes.ok) {
      const errText = await chargeRes.text();
      const msg = `Hint charge create failed (${chargeRes.status}): ${errText.substring(0, 300)}`;
      await markBillingFailed(admin, dispense_record_id, msg);
      return jsonResponse({ error: msg }, 502);
    }

    const charge = await chargeRes.json();
    const chargeId = charge.id || charge.charge_id || null;

    await admin
      .from("dispense_records")
      .update({
        hint_charge_id: chargeId ? String(chargeId) : JSON.stringify(charge),
        hint_patient_id: billingPatientId ? String(billingPatientId) : null,
        hint_billed_at: new Date().toISOString(),
        hint_billing_status: "billed",
        hint_billing_error: null,
      })
      .eq("id", dispense_record_id);

    return jsonResponse({
      success: true,
      charge_id: chargeId,
      patient_id: billingPatientId,
      amount_cents: totalCents,
      status: "billed",
    }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: message }, 500);
  }
});
