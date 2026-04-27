// Scans hr_certifications for credentials expiring within the next 30 days
// and emits both an in-app notification (hr_notifications) and a transactional
// email to the employee. Idempotent within each window via last_notified_date.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Days-until-expiry buckets that should trigger a re-notification.
const NOTIFY_WINDOWS = [60, 30, 14, 7, 1];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const horizon = new Date(today);
  horizon.setUTCDate(horizon.getUTCDate() + 60);

  const { data: certs, error } = await supabase
    .from("hr_certifications")
    .select(
      `id, name, issuing_authority, expiration_date, last_notified_date,
       employee:hr_employees!hr_certifications_employee_id_fkey
         (id, first_name, last_name, email, user_id)`,
    )
    .not("expiration_date", "is", null)
    .gte("expiration_date", today.toISOString().slice(0, 10))
    .lte("expiration_date", horizon.toISOString().slice(0, 10));

  if (error) {
    console.error("Failed to query certifications", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let processed = 0;
  let emailed = 0;
  let notified = 0;
  const errors: string[] = [];

  for (const cert of certs ?? []) {
    const employee = (cert as any).employee as
      | {
          id: string;
          first_name: string;
          last_name: string;
          email: string;
          user_id: string | null;
        }
      | null;
    if (!employee) continue;

    const expDate = new Date(cert.expiration_date as string);
    expDate.setUTCHours(0, 0, 0, 0);
    const daysRemaining = Math.round(
      (expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
    );

    // Pick the smallest window we've crossed.
    const windowHit = NOTIFY_WINDOWS.find((w) => daysRemaining <= w);
    if (windowHit === undefined) continue;

    // Skip if we've already notified inside this window today.
    const lastNotified = cert.last_notified_date
      ? new Date(cert.last_notified_date as string)
      : null;
    if (lastNotified) {
      const daysSinceLast = Math.round(
        (today.getTime() - lastNotified.getTime()) / (1000 * 60 * 60 * 24),
      );
      // Only re-notify when we cross into a tighter window.
      const lastDaysRemaining =
        Math.round(
          (expDate.getTime() - lastNotified.getTime()) / (1000 * 60 * 60 * 24),
        );
      const lastWindow = NOTIFY_WINDOWS.find((w) => lastDaysRemaining <= w);
      if (lastWindow === windowHit && daysSinceLast < 7) continue;
    }

    processed++;
    const employeeName = `${employee.first_name} ${employee.last_name}`.trim();

    // 1. In-app notification (only if employee has a linked user account)
    if (employee.user_id) {
      const { error: notifyErr } = await supabase
        .from("hr_notifications")
        .insert({
          user_id: employee.user_id,
          title: `Certification expiring in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}`,
          message: `${cert.name} expires on ${cert.expiration_date}.`,
          link: `/hr/employees/${employee.id}`,
        });
      if (notifyErr) {
        errors.push(`notify ${cert.id}: ${notifyErr.message}`);
      } else {
        notified++;
      }
    }

    // 2. Transactional email
    if (employee.email) {
      const { error: emailErr } = await supabase.functions.invoke(
        "send-transactional-email",
        {
          body: {
            templateName: "license-expiration-alert",
            recipientEmail: employee.email,
            idempotencyKey: `cert-${cert.id}-w${windowHit}`,
            templateData: {
              employeeName,
              certificationName: cert.name,
              expirationDate: cert.expiration_date,
              daysRemaining,
              issuingAuthority: cert.issuing_authority,
            },
          },
        },
      );
      if (emailErr) {
        errors.push(`email ${cert.id}: ${emailErr.message}`);
      } else {
        emailed++;
      }
    }

    // 3. Mark notified
    await supabase
      .from("hr_certifications")
      .update({ last_notified_date: today.toISOString().slice(0, 10) })
      .eq("id", cert.id);
  }

  return new Response(
    JSON.stringify({
      ok: true,
      scanned: certs?.length ?? 0,
      processed,
      emailed,
      notified,
      errors,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
