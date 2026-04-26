import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PROVIDER_ID = "b2c3d4e5-f6a7-8901-bcde-f12345678901";
const SPECIALTY_ID = "lab";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json();

    // Setup provider
    if (body.setup) {
      await supabase
        .from("specialties")
        .upsert({ id: SPECIALTY_ID, name: "Laboratory", icon: "FlaskConical" }, { onConflict: "id" });

      await supabase.from("providers").upsert(
        {
          id: PROVIDER_ID,
          name: "LabCorp",
          specialty_id: SPECIALTY_ID,
          city: "National",
          state: "US",
          phone: "(800) 845-6167",
          address: "Mail-in & 2,000+ patient service centers",
          zip: null,
          distance: null,
        },
        { onConflict: "id" }
      );
    }

    // Accept rows directly: [[testNumber, testName, price], ...]
    const rows: [string, string, number][] = body.rows || [];

    if (rows.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "Setup complete, send rows in batches" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Deduplicate
    const seen = new Map<string, [string, string, number]>();
    for (const row of rows) {
      if (!seen.has(row[0])) seen.set(row[0], row);
    }
    const unique = Array.from(seen.values());

    const toId = (testNumber: string) => {
      const cleaned = testNumber.replace(/[^0-9]/g, "");
      return "lab-" + cleaned.padStart(6, "0");
    };

    const BATCH = 200;
    let servicesInserted = 0;
    let pricesInserted = 0;

    for (let i = 0; i < unique.length; i += BATCH) {
      const batch = unique.slice(i, i + BATCH);

      const services = batch.map(([num, name]) => {
        const padded = num.replace(/[^0-9]/g, "").padStart(6, "0");
        return {
          id: toId(num),
          name,
          specialty_id: SPECIALTY_ID,
          description: "LabCorp Test #" + padded,
          icd10_codes: [],
        };
      });

      const { error: sErr } = await supabase
        .from("services")
        .upsert(services, { onConflict: "id" });
      if (sErr) console.error("Service batch error:", sErr);
      else servicesInserted += services.length;

      const prices = batch.map(([num, , price]) => ({
        provider_id: PROVIDER_ID,
        service_id: toId(num),
        component: "Lab Fee",
        price,
      }));

      const { error: pErr } = await supabase
        .from("service_prices")
        .upsert(prices, { onConflict: "provider_id,service_id,component", ignoreDuplicates: false });
      if (pErr) {
        console.error("Price batch error:", pErr);
        for (const p of prices) {
          const { error } = await supabase.from("service_prices").insert(p);
          if (!error) pricesInserted++;
        }
      } else {
        pricesInserted += prices.length;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        batch_size: rows.length,
        unique_tests: unique.length,
        services_inserted: servicesInserted,
        prices_inserted: pricesInserted,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Seed error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
