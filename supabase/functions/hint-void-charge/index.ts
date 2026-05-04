import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_ROLES = ["admin", "pharmacist"] as const;

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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
    const userEmail = (claims.claims.email as string | undefined) ?? userId;

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: roleRows, error: roleErr } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (roleErr) return jsonResponse({ error: "Role lookup failed" }, 500);
    const roles = (roleRows ?? []).map((r) => r.role as string);
    if (!roles.some((r) => (ALLOWED_ROLES as readonly string[]).includes(r))) {
      return jsonResponse({ error: "Forbidden: only admins or pharmacists can retract invoices" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const { dispense_record_id, reason } = body ?? {};
    if (!dispense_record_id || typeof dispense_record_id !== "string") {
      return jsonResponse({ error: "dispense_record_id is required" }, 400);
    }
    if (!reason || typeof reason !== "string" || reason.trim().length < 3) {
      return jsonResponse({ error: "A retraction reason (min 3 chars) is required" }, 400);
    }
    const trimmedReason = reason.trim().slice(0, 500);

    const { data: record, error: recError } = await admin
      .from("dispense_records")
      .select("*")
      .eq("id", dispense_record_id)
      .maybeSingle();
    if (recError || !record) {
      return jsonResponse({ error: "Dispense record not found" }, 404);
    }

    if (record.reversed_at) {
      return jsonResponse({ error: "Dispense already reversed" }, 409);
    }

    // Step 1: Void Hint invoice if one exists
    let hintVoidResult: unknown = null;
    if (record.hint_charge_id) {
      const hintApiUrl = Deno.env.get("HINT_API_URL") || "https://api.hint.com/api";
      const hintApiToken = Deno.env.get("HINT_API_TOKEN");
      if (!hintApiToken) {
        return jsonResponse({ error: "Hint API token not configured" }, 500);
      }

      const voidRes = await fetch(
        `${hintApiUrl}/provider/charges/${encodeURIComponent(record.hint_charge_id)}`,
        {
          method: "DELETE",
          headers: {
            "Authorization": `Bearer ${hintApiToken}`,
            "Content-Type": "application/json",
          },
        },
      );

      // 404 from Hint is acceptable (charge already gone); other failures abort.
      if (!voidRes.ok && voidRes.status !== 404) {
        const errText = await voidRes.text();
        return jsonResponse({
          error: `Failed to void Hint invoice (${voidRes.status})`,
          details: errText.substring(0, 300),
        }, 502);
      }
      hintVoidResult = { status: voidRes.status };
    }

    // Step 2: Return stock (best-effort; if med was deleted we still proceed)
    let stockReturnedAt: string | null = null;
    if (record.medication_id && record.quantity) {
      const { data: med } = await admin
        .from("medications")
        .select("id,quantity")
        .eq("id", record.medication_id)
        .maybeSingle();
      if (med) {
        const newQty = Number(med.quantity ?? 0) + Number(record.quantity);
        const { error: incErr } = await admin
          .from("medications")
          .update({ quantity: newQty })
          .eq("id", record.medication_id);
        if (!incErr) {
          stockReturnedAt = new Date().toISOString();
        }
      }
    }

    // Step 3: Mark dispense reversed and voided
    const nowIso = new Date().toISOString();
    const { error: updErr } = await admin
      .from("dispense_records")
      .update({
        reversed_at: nowIso,
        reversed_by: userEmail,
        reversal_reason: trimmedReason,
        hint_billing_status: "voided",
        hint_voided_at: nowIso,
        hint_voided_by: userEmail,
        stock_returned_at: stockReturnedAt,
      })
      .eq("id", dispense_record_id);

    if (updErr) {
      return jsonResponse({ error: `Failed to update dispense record: ${updErr.message}` }, 500);
    }

    // Step 4: Audit log
    await admin.from("audit_log").insert({
      user_id: userId,
      action: "RETRACT_HINT_INVOICE",
      table_name: "dispense_records",
      record_id: dispense_record_id,
      new_data: {
        reason: trimmedReason,
        hint_charge_id: record.hint_charge_id,
        quantity_returned: stockReturnedAt ? record.quantity : 0,
        medication_id: record.medication_id,
        hint_void_result: hintVoidResult,
      },
    });

    return jsonResponse({
      success: true,
      stock_returned: !!stockReturnedAt,
      hint_voided: !!record.hint_charge_id,
    }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: message }, 500);
  }
});
