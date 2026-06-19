// Bulk CSV/XLSX import for the cost estimator.
// Expects a job row (kind='bulk_csv') with `url` pointing to a signed-URL CSV
// (columns: Hospital, Provider, procedure, Address, City, State, ZIP, Total Price)
// and `network` set to the network tag (e.g. "Tendo").
//
// Creates ONE provider per unique Hospital+Address, tagged with the given
// network. AI-maps procedure names to CPT codes in batches via Lovable AI.
// Writes service rows and service_prices (component='cash').

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface Row {
  hospital: string;
  provider: string;
  procedure: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  price: number;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function slugCpt(name: string): string {
  return (
    "TENDO-" +
    name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40)
  );
}

async function aiMapProcedures(
  procedures: string[],
  apiKey: string,
): Promise<Record<string, { cpt: string | null; name: string }>> {
  const result: Record<string, { cpt: string | null; name: string }> = {};
  const BATCH = 40;
  for (let i = 0; i < procedures.length; i += BATCH) {
    const batch = procedures.slice(i, i + BATCH);
    const prompt =
      `Map each medical procedure name to its most likely CPT code. ` +
      `Return ONLY a JSON array of objects { "procedure": string, "cpt": string|null, "name": string }. ` +
      `cpt is the 5-character CPT code as a string (or null if uncertain). ` +
      `name is a short canonical service name. No prose.\n\nProcedures:\n` +
      batch.map((p, j) => `${j + 1}. ${p}`).join("\n");
    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Lovable-API-Key": apiKey,
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: "You are a precise medical coding assistant. Output JSON only." },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
        }),
      });
      if (!res.ok) {
        console.error("[bulk-import] AI error", res.status, await res.text());
        for (const p of batch) result[p] = { cpt: null, name: p };
        continue;
      }
      const data = await res.json();
      let content = data?.choices?.[0]?.message?.content ?? "[]";
      // Strip markdown fences if any
      content = content.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      // Some models wrap in { "results": [...] }
      let arr: any[] = [];
      try {
        const parsed = JSON.parse(content);
        arr = Array.isArray(parsed) ? parsed : parsed.results ?? parsed.data ?? parsed.mappings ?? [];
      } catch (e) {
        console.error("[bulk-import] parse error", e, content.slice(0, 200));
      }
      for (const item of arr) {
        const proc = String(item.procedure ?? "").trim();
        if (!proc) continue;
        const cpt = item.cpt && /^\d{4,5}[A-Z]?$/.test(String(item.cpt).trim())
          ? String(item.cpt).trim()
          : null;
        result[proc] = { cpt, name: String(item.name ?? proc).trim() || proc };
      }
      // Fill any missing
      for (const p of batch) if (!(p in result)) result[p] = { cpt: null, name: p };
    } catch (e) {
      console.error("[bulk-import] AI batch failed", e);
      for (const p of batch) result[p] = { cpt: null, name: p };
    }
  }
  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const aiKey = Deno.env.get("LOVABLE_API_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const { job_id } = await req.json();
  if (!job_id) {
    return new Response(JSON.stringify({ error: "job_id required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Kick off async processing, return immediately.
  const work = (async () => {
    const { data: job, error: jobErr } = await supabase
      .from("import_jobs")
      .select("*")
      .eq("id", job_id)
      .single();
    if (jobErr || !job) {
      console.error("[bulk-import] no job", jobErr);
      return;
    }
    const network = (job as any).network || "Tendo";
    const fileUrl = job.url;

    await supabase.from("import_jobs").update({ status: "processing" }).eq("id", job_id);

    try {
      const res = await fetch(fileUrl);
      if (!res.ok) throw new Error(`Failed to fetch file: ${res.status}`);
      const text = await res.text();
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length < 2) throw new Error("File has no data rows");

      const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
      const idx = {
        hospital: header.findIndex((h) => h.includes("hospital")),
        provider: header.findIndex((h) => h === "provider" || h.includes("facility")),
        procedure: header.findIndex((h) => h.includes("procedure") || h.includes("service") || h.includes("description")),
        address: header.findIndex((h) => h.includes("address")),
        city: header.findIndex((h) => h === "city"),
        state: header.findIndex((h) => h === "state"),
        zip: header.findIndex((h) => h.includes("zip") || h.includes("postal")),
        price: header.findIndex((h) => h.includes("price") || h.includes("charge") || h.includes("cost")),
      };
      if (idx.procedure === -1 || idx.price === -1) {
        throw new Error("Required columns missing: procedure and price");
      }

      const rows: Row[] = [];
      for (let i = 1; i < lines.length; i++) {
        const parts = parseCsvLine(lines[i]);
        const price = parseFloat(String(parts[idx.price] ?? "").replace(/[$,\s]/g, ""));
        if (!isFinite(price) || price <= 0) continue;
        const procedure = (parts[idx.procedure] ?? "").trim();
        if (!procedure) continue;
        rows.push({
          hospital: (parts[idx.hospital] ?? parts[idx.provider] ?? "").trim(),
          provider: (parts[idx.provider] ?? parts[idx.hospital] ?? "").trim(),
          procedure,
          address: (parts[idx.address] ?? "").trim(),
          city: (parts[idx.city] ?? "").trim(),
          state: (parts[idx.state] ?? "").trim(),
          zip: (parts[idx.zip] ?? "").trim(),
          price,
        });
      }

      await supabase
        .from("import_jobs")
        .update({ total_rows: rows.length, rows_imported: 0 })
        .eq("id", job_id);

      // Unique procedures → AI map
      const uniqueProcs = Array.from(new Set(rows.map((r) => r.procedure)));
      console.log(`[bulk-import] ${rows.length} rows, ${uniqueProcs.length} unique procedures`);
      const procMap = await aiMapProcedures(uniqueProcs, aiKey);

      // Build service rows
      const serviceByProc = new Map<string, { id: string; cpt: string; name: string }>();
      const servicesToUpsert: any[] = [];
      for (const proc of uniqueProcs) {
        const mapped = procMap[proc] ?? { cpt: null, name: proc };
        const cpt = mapped.cpt ?? slugCpt(proc);
        const id = mapped.cpt ? `CPT-${cpt}` : slugCpt(proc);
        serviceByProc.set(proc, { id, cpt, name: mapped.name });
        servicesToUpsert.push({
          id,
          name: mapped.name || proc,
          cpt_code: cpt,
          specialty_id: "other",
          icd10_codes: [],
        });
      }
      // Chunked upsert services
      for (let i = 0; i < servicesToUpsert.length; i += 500) {
        const chunk = servicesToUpsert.slice(i, i + 500);
        const { error } = await supabase.from("services").upsert(chunk, { onConflict: "id" });
        if (error) console.error("[bulk-import] services upsert error", error);
      }

      // Unique providers (Hospital+Address)
      const providerKey = (r: Row) => `${r.hospital}|${r.address}|${r.city}`;
      const provInfo = new Map<string, Row>();
      for (const r of rows) if (!provInfo.has(providerKey(r))) provInfo.set(providerKey(r), r);

      const providerIds = new Map<string, string>();
      let provCount = 0;
      for (const [key, r] of provInfo.entries()) {
        // Look up existing by name+address
        const { data: existing } = await supabase
          .from("providers")
          .select("id")
          .eq("name", r.hospital || r.provider)
          .eq("address", r.address || null)
          .maybeSingle();
        let pid: string;
        if (existing) {
          pid = existing.id;
          await supabase
            .from("providers")
            .update({
              network,
              city: r.city || null,
              state: r.state || null,
              zip: r.zip || null,
              last_price_update: new Date().toISOString().slice(0, 10),
            } as any)
            .eq("id", pid);
        } else {
          const { data: ins, error: insErr } = await supabase
            .from("providers")
            .insert({
              name: r.hospital || r.provider,
              address: r.address || null,
              city: r.city || null,
              state: r.state || null,
              zip: r.zip || null,
              specialty_id: "other",
              categories: [],
              network,
            } as any)
            .select("id")
            .single();
          if (insErr || !ins) { console.error("[bulk-import] provider insert", insErr); continue; }
          pid = ins.id;
        }
        providerIds.set(key, pid);
        provCount++;
      }
      console.log(`[bulk-import] ${provCount} providers ready`);

      // Insert service_prices in chunks
      const prices: any[] = [];
      for (const r of rows) {
        const pid = providerIds.get(providerKey(r));
        const svc = serviceByProc.get(r.procedure);
        if (!pid || !svc) continue;
        prices.push({
          provider_id: pid,
          service_id: svc.id,
          component: "cash",
          price: r.price,
        });
      }
      let written = 0;
      for (let i = 0; i < prices.length; i += 500) {
        const chunk = prices.slice(i, i + 500);
        const { error } = await supabase
          .from("service_prices")
          .upsert(chunk, { onConflict: "provider_id,service_id,component" });
        if (error) {
          console.error("[bulk-import] prices upsert error", error);
        } else {
          written += chunk.length;
          await supabase
            .from("import_jobs")
            .update({ rows_imported: written })
            .eq("id", job_id);
        }
      }

      await supabase
        .from("import_jobs")
        .update({ status: "done", rows_imported: written })
        .eq("id", job_id);
      console.log(`[bulk-import] done: ${written} prices written`);
    } catch (e: any) {
      console.error("[bulk-import] error", e);
      await supabase
        .from("import_jobs")
        .update({ status: "error", error_message: e?.message ?? String(e) })
        .eq("id", job_id);
    }
  })();

  // @ts-ignore EdgeRuntime is provided by Deno deploy
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work);
  else work.catch(console.error);

  return new Response(JSON.stringify({ started: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
