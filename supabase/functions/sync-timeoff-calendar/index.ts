// Sync an HR time-off request to the configured Google Calendar.
// Actions: "upsert" (default) creates or updates the event; "delete" removes it.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL =
  "https://connector-gateway.lovable.dev/google_calendar/calendar/v3";

interface Payload {
  request_id: string;
  action?: "upsert" | "delete";
}

const TYPE_LABEL: Record<string, string> = {
  vacation: "Vacation",
  sick: "Sick",
  personal: "Personal",
  bereavement: "Bereavement",
  jury_duty: "Jury Duty",
  unpaid: "Unpaid",
  other: "Time Off",
};

function isoEndExclusive(end: string): string {
  // Google all-day events use exclusive end date.
  const d = new Date(end + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const GOOGLE_CALENDAR_API_KEY = Deno.env.get("GOOGLE_CALENDAR_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
    if (!GOOGLE_CALENDAR_API_KEY)
      throw new Error("GOOGLE_CALENDAR_API_KEY not configured");

    const body = (await req.json()) as Payload;
    if (!body?.request_id) {
      return new Response(JSON.stringify({ error: "request_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const action = body.action ?? "upsert";

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: settings } = await admin
      .from("hr_settings")
      .select("google_calendar_id")
      .eq("id", true)
      .maybeSingle();
    const calendarId = settings?.google_calendar_id || "primary";

    const { data: request, error: reqErr } = await admin
      .from("hr_time_off_requests")
      .select(
        "id, type, start_date, end_date, status, reason, calendar_event_id, hr_employees(first_name, last_name, email)",
      )
      .eq("id", body.request_id)
      .maybeSingle();
    if (reqErr) throw reqErr;
    if (!request) throw new Error("request not found");

    const gcalHeaders = {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": GOOGLE_CALENDAR_API_KEY,
      "Content-Type": "application/json",
    };

    // DELETE
    if (action === "delete") {
      if (!request.calendar_event_id) {
        return new Response(JSON.stringify({ ok: true, skipped: "no event" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const res = await fetch(
        `${GATEWAY_URL}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(request.calendar_event_id)}`,
        { method: "DELETE", headers: gcalHeaders },
      );
      if (!res.ok && res.status !== 404 && res.status !== 410) {
        const t = await res.text();
        throw new Error(`gcal delete failed [${res.status}]: ${t}`);
      }
      await admin
        .from("hr_time_off_requests")
        .update({ calendar_event_id: null })
        .eq("id", request.id);
      return new Response(JSON.stringify({ ok: true, deleted: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // UPSERT
    const emp = request.hr_employees as
      | { first_name: string; last_name: string; email: string }
      | null;
    const empName = emp ? `${emp.first_name} ${emp.last_name}` : "Employee";
    const label = TYPE_LABEL[String(request.type)] ?? "Time Off";

    const eventBody = {
      summary: `${empName} — ${label}`,
      description: request.reason
        ? `${label} (HR-approved)\n\n${request.reason}`
        : `${label} (HR-approved)`,
      start: { date: request.start_date },
      end: { date: isoEndExclusive(request.end_date) },
      transparency: "opaque",
      extendedProperties: {
        private: { primecare_request_id: request.id },
      },
    };

    let res: Response;
    if (request.calendar_event_id) {
      res = await fetch(
        `${GATEWAY_URL}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(request.calendar_event_id)}`,
        { method: "PUT", headers: gcalHeaders, body: JSON.stringify(eventBody) },
      );
      if (res.status === 404 || res.status === 410) {
        // Stale ID — recreate.
        res = await fetch(
          `${GATEWAY_URL}/calendars/${encodeURIComponent(calendarId)}/events`,
          {
            method: "POST",
            headers: gcalHeaders,
            body: JSON.stringify(eventBody),
          },
        );
      }
    } else {
      res = await fetch(
        `${GATEWAY_URL}/calendars/${encodeURIComponent(calendarId)}/events`,
        {
          method: "POST",
          headers: gcalHeaders,
          body: JSON.stringify(eventBody),
        },
      );
    }

    const data = await res.json();
    if (!res.ok) {
      throw new Error(`gcal upsert failed [${res.status}]: ${JSON.stringify(data)}`);
    }

    if (data?.id && data.id !== request.calendar_event_id) {
      await admin
        .from("hr_time_off_requests")
        .update({ calendar_event_id: data.id })
        .eq("id", request.id);
    }

    return new Response(
      JSON.stringify({ ok: true, event_id: data.id, calendar_id: calendarId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("sync-timeoff-calendar error:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
