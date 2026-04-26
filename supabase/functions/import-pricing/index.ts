import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function extractMeta(text: string) {
  const e = (ps: string[]) => {
    for (const p of ps) {
      const m = text.match(new RegExp(`"${p}"\\s*:\\s*"([^"]*)"`, "i"));
      if (m) return m[1];
    }
    return null;
  };
  return {
    name: e(["hospital_name", "facility_name", "name", "organization_name"]),
    address: e(["hospital_address", "address"]),
    city: e(["city"]) || "Unknown",
    state: e(["state"]) || "FL",
    zip: e(["zip", "zipcode"]),
    phone: e(["hospital_phone", "phone"]) || "N/A",
  };
}

const ACCEPTED_CODES = new Set(["CPT", "HCPCS", "MS-DRG", "DRG", "APC", "EAPG", "REV", "CDM", "LOCAL"]);

// ── Convert Google Drive sharing links to direct download URLs ───────
function normalizeUrl(url: string): string {
  let fileId: string | null = null;
  const driveMatch = url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (driveMatch) fileId = driveMatch[1];
  const openMatch = url.match(/drive\.google\.com\/open\?id=([^&]+)/);
  if (openMatch) fileId = openMatch[1];
  const ucMatch = url.match(/drive\.google\.com\/uc\?.*id=([^&]+)/);
  if (ucMatch) fileId = ucMatch[1];
  if (fileId) {
    // Use confirm=t to bypass the virus scan warning for large files
    return `https://drive.google.com/uc?export=download&confirm=t&id=${fileId}`;
  }
  return url;
}

// For Google Drive, resolve the virus scan confirmation page by forwarding cookies.
async function resolveGoogleDrive(url: string, rangeHeaders: Record<string, string>): Promise<{ url: string; response: Response } | null> {
  if (!url.includes("drive.google.com") && !url.includes("drive.usercontent.google.com")) return null;

  // Try fetching directly first (small files or already-resolved URLs)
  const res = await fetch(url, { headers: rangeHeaders, redirect: "follow" });
  const ct = res.headers.get("content-type") || "";

  if (!ct.includes("text/html")) {
    // Direct download works!
    console.log(`[import] Google Drive: direct download (${res.status}, ${ct})`);
    return { url: res.url, response: res };
  }

  // Got HTML virus scan warning. Parse form and re-fetch WITH cookies from this response.
  const cookies = res.headers.get("set-cookie") || "";
  const html = await res.text();

  const actionMatch = html.match(/action="([^"]+)"/);
  if (!actionMatch) {
    console.warn(`[import] Google Drive: no confirmation form found in HTML`);
    console.warn(`[import] HTML preview: ${html.substring(0, 300)}`);
    return null;
  }
  const action = actionMatch[1].replace(/&amp;/g, "&");
  const inputs: string[] = [];
  const inputRegex = /<input[^>]+name="([^"]+)"[^>]+value="([^"]*)"/g;
  let m;
  while ((m = inputRegex.exec(html)) !== null) {
    inputs.push(`${encodeURIComponent(m[1])}=${encodeURIComponent(m[2])}`);
  }
  const confirmUrl = inputs.length > 0
    ? `${action}${action.includes("?") ? "&" : "?"}${inputs.join("&")}`
    : `${action}?confirm=t`;

  console.log(`[import] Google Drive confirm URL: ${confirmUrl.substring(0, 150)}`);

  // Forward cookies from the initial response to the confirmation request
  const confirmHeaders: Record<string, string> = { ...rangeHeaders };
  if (cookies) {
    // Extract just the cookie key=value pairs from set-cookie
    const cookieParts = cookies.split(",").map(c => {
      const first = c.split(";")[0].trim();
      return first;
    }).filter(c => c.includes("="));
    confirmHeaders["cookie"] = cookieParts.join("; ");
  }

  const res2 = await fetch(confirmUrl, { headers: confirmHeaders, redirect: "follow" });
  const ct2 = res2.headers.get("content-type") || "";

  if (ct2.includes("text/html")) {
    const body2 = await res2.text();
    console.warn(`[import] Google Drive: still HTML after confirmation (${res2.status})`);
    console.warn(`[import] Response preview: ${body2.substring(0, 300)}`);
    return null;
  }

  console.log(`[import] Google Drive resolved via confirmation (${res2.status}, ${ct2})`);
  return { url: res2.url, response: res2 };
}

// ── Detect file format from URL ──────────────────────────────────────
function detectFormat(url: string): "json" | "csv" | "xlsx" {
  // Google Drive links default to csv unless filename hints otherwise
  if (url.includes("drive.google.com")) return "csv";
  const path = url.split("?")[0].toLowerCase();
  if (path.endsWith(".csv") || path.endsWith(".txt")) return "csv";
  if (path.endsWith(".xlsx") || path.endsWith(".xls")) return "xlsx";
  return "json";
}

// ── Streaming CMS JSON Parser ────────────────────────────────────────
interface ParsedItem {
  description: string;
  codes: { code: string; type: string }[];
  price: number | null;
}

class StreamParser {
  private inStr = false;
  private esc = false;
  private lastKey = "";
  private capBuf = "";
  private capturing: "key" | "str_val" | "num_val" | null = null;
  private afterColon = false;
  private arrayStack: string[] = [];
  private codeEntryDepth = 0;
  private payerEntryDepth = 0;
  private hasItem = false;
  private desc = "";
  private codes: { code: string; type: string }[] = [];
  private codeTemp: { code?: string; type?: string } = {};
  private grossCharge: number | null = null;
  private discountedCash: number | null = null;
  private minimum: number | null = null;
  private cashPrices: number[] = [];
  private payerName = "";
  private payerPrice: number | null = null;

  public itemsFound = 0;
  public itemsWithCodes = 0;
  public itemsWithPrice = 0;
  public itemsSkippedNoCodes = 0;
  public itemsSkippedNoPrice = 0;

  constructor(private onItem: (item: ParsedItem) => Promise<void>) {}

  private get topArray(): string {
    return this.arrayStack.length > 0 ? this.arrayStack[this.arrayStack.length - 1] : "";
  }

  private flushNum() {
    if (this.capturing === "num_val" && this.capBuf) {
      this.handleKV(false);
      this.capturing = null;
      this.afterColon = false;
    }
  }

  private handleKV(isString: boolean) {
    if (!this.hasItem) return;
    const k = this.lastKey;
    const v = this.capBuf;

    if (isString) {
      if (this.topArray === "code_info") {
        if (k === "code" || k === "billing_code") this.codeTemp.code = v;
        else if (k === "type" || k === "billing_code_type") this.codeTemp.type = v.toUpperCase();
      }
      if (this.topArray === "payers_info") {
        if (k === "payer_name") this.payerName = v.toLowerCase();
        else if (k === "plan_name") {
          const lv = v.toLowerCase();
          if (lv === "cash" || lv.includes("self pay") || lv.includes("self-pay"))
            this.payerName = lv;
        }
      }
    } else {
      const n = parseFloat(v);
      if (isNaN(n) || n <= 0) return;
      if (k === "gross_charge") this.grossCharge = n;
      else if (k === "discounted_cash" || k === "discounted_cash_price") this.discountedCash = n;
      else if (k === "minimum" || k === "de_identified_minimum") {
        if (this.minimum === null) this.minimum = n;
      }
      else if (this.topArray === "payers_info" && (k === "standard_charge_dollar" || k === "standard_charge")) {
        this.payerPrice = n;
      }
      else if (k === "cash_price" || k === "self_pay") {
        this.discountedCash = n;
      }
    }
  }

  async processChunk(text: string) {
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (this.esc) {
        if (this.capturing === "str_val" || this.capturing === "key") this.capBuf += ch;
        this.esc = false;
        continue;
      }
      if (ch === "\\" && this.inStr) { this.esc = true; continue; }

      if (ch === '"') {
        if (!this.inStr) {
          this.inStr = true;
          this.capBuf = "";
          this.capturing = this.afterColon ? "str_val" : "key";
        } else {
          this.inStr = false;
          if (this.capturing === "key") {
            this.lastKey = this.capBuf;
          } else if (this.capturing === "str_val") {
            if (this.arrayStack.length === 0 &&
                (this.lastKey === "description" || this.lastKey === "billing_code_name")) {
              if (this.hasItem) await this.finalizeItem();
              this.startItem(this.capBuf);
            } else {
              this.handleKV(true);
            }
            this.afterColon = false;
          }
          this.capturing = null;
        }
        continue;
      }

      if (this.inStr) {
        if (this.capturing && this.capBuf.length < 500) this.capBuf += ch;
        continue;
      }

      switch (ch) {
        case ":": this.afterColon = true; break;
        case "{":
          this.afterColon = false;
          if (this.topArray === "code_info") {
            this.codeEntryDepth++;
            if (this.codeEntryDepth === 1) this.codeTemp = {};
          } else if (this.topArray === "payers_info") {
            this.payerEntryDepth++;
            if (this.payerEntryDepth === 1) { this.payerName = ""; this.payerPrice = null; }
          }
          break;
        case "}":
          this.flushNum();
          if (this.topArray === "code_info" && this.codeEntryDepth > 0) {
            this.codeEntryDepth--;
            if (this.codeEntryDepth === 0 && this.codeTemp.code) {
              const t = this.codeTemp.type || "CPT";
              if (ACCEPTED_CODES.has(t)) this.codes.push({ code: this.codeTemp.code, type: t });
              this.codeTemp = {};
            }
          }
          if (this.topArray === "payers_info" && this.payerEntryDepth > 0) {
            this.payerEntryDepth--;
            if (this.payerEntryDepth === 0 && this.payerPrice != null && this.payerPrice > 0) {
              const pn = this.payerName;
              if (pn === "cash" || pn.includes("self pay") || pn.includes("self-pay") || pn === "uninsured") {
                this.cashPrices.push(this.payerPrice);
              }
            }
          }
          break;
        case "[":
          this.afterColon = false;
          if (this.lastKey === "code_information" || this.lastKey === "billing_code_information") {
            this.arrayStack.push("code_info"); this.codeEntryDepth = 0;
          } else if (this.lastKey === "payers_information") {
            this.arrayStack.push("payers_info"); this.payerEntryDepth = 0;
          } else {
            this.arrayStack.push("other");
          }
          break;
        case "]":
          this.flushNum();
          if (this.arrayStack.length > 0) this.arrayStack.pop();
          this.codeEntryDepth = 0;
          this.payerEntryDepth = 0;
          break;
        case ",": this.flushNum(); this.afterColon = false; break;
        default:
          if (this.afterColon && this.capturing !== "num_val" && (ch >= "0" && ch <= "9" || ch === "-")) {
            this.capturing = "num_val"; this.capBuf = ch;
          } else if (this.capturing === "num_val") {
            if (ch >= "0" && ch <= "9" || ch === "." || ch === "e" || ch === "E" || ch === "+" || ch === "-") this.capBuf += ch;
          }
          break;
      }
    }
  }

  private startItem(description: string) {
    this.hasItem = true; this.desc = description; this.codes = []; this.codeTemp = {};
    this.grossCharge = null; this.discountedCash = null; this.minimum = null;
    this.cashPrices = []; this.payerName = ""; this.payerPrice = null;
  }

  private async finalizeItem() {
    this.itemsFound++;
    if (this.codes.length === 0 && this.codeTemp.code) {
      const t = this.codeTemp.type || "CPT";
      if (ACCEPTED_CODES.has(t)) this.codes.push({ code: this.codeTemp.code, type: t });
    }
    let price: number | null = null;
    if (this.discountedCash != null) price = this.discountedCash;
    else if (this.cashPrices.length > 0) price = Math.min(...this.cashPrices);
    else if (this.grossCharge != null) price = this.grossCharge;
    else if (this.minimum != null) price = this.minimum;
    if (this.codes.length > 0) this.itemsWithCodes++; else this.itemsSkippedNoCodes++;
    if (price != null) this.itemsWithPrice++; else if (this.codes.length > 0) this.itemsSkippedNoPrice++;
    await this.onItem({ description: this.desc, codes: this.codes, price });
  }

  async flush() { if (this.hasItem) await this.finalizeItem(); }
}

// ── Streaming CSV Parser ─────────────────────────────────────────────
// Processes CSV line-by-line within chunked reads, same 4MB-per-run
// pattern as JSON. Handles quoted fields and mid-line chunk boundaries.
// Auto-detects columns from header row (first run only, offset=0).
//
// Common CMS CSV columns:
//   code|billing_code, code_type|billing_code_type, description,
//   gross_charge, discounted_cash_price, cash_price, de_identified_minimum,
//   payer_name, standard_charge

class CsvParser {
  // Keywords that indicate a real data header row (not metadata/disclaimer)
  private static readonly HEADER_KEYWORDS = [
    "billing_code", "code", "cpt", "hcpcs", "description", "gross_charge",
    "standard_charge", "charge", "cash", "payer", "negotiated", "procedure",
    "service", "drg", "revenue_code", "ndc", "drug", "drug_id", "product",
    "brand", "ingredients", "list_price", "price",
  ];

  private headers: string[] = [];
  private colMap: Record<string, number> = {};
  private leftover = "";
  public headersDetected = false;
  public itemsFound = 0;

  constructor(private onItem: (item: ParsedItem) => Promise<void>) {}

  /** Provide pre-detected headers (for resumed chunks where header row was in a prior run) */
  setHeaders(h: string[]) {
    this.headers = h;
    this.buildColMap();
    this.headersDetected = true;
  }

  private normalize(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  }

  private buildColMap() {
    // Log raw headers for debugging
    console.log(`[csv] raw headers (${this.headers.length}):`, JSON.stringify(this.headers.slice(0, 30)));

    // Each alias list uses normalized form (lowercase, non-alphanumeric → _)
    const alias: Record<string, string[]> = {
      code: ["code", "billing_code", "cpt_code", "hcpcs_code", "procedure_code", "cpt", "hcpcs",
             "code_1", "billing_code_1", "local_code", "drug_id", "drug_package_id", "din"],
      code_type: ["code_type", "billing_code_type", "code_category", "type",
                  "code_type_1", "billing_code_type_1", "revenue_code_type",
                  "code_1_type"],
      code2: ["code_2", "billing_code_2", "code_2_code"],
      code2_type: ["code_2_type", "billing_code_2_type", "code_type_2"],
      code3: ["code_3", "billing_code_3", "code_3_code"],
      code3_type: ["code_3_type", "billing_code_3_type", "code_type_3"],
      description: ["description", "billing_code_name", "procedure_description", "service_description",
                    "service_name", "procedure_name", "item_description", "additional_generic_notes",
                    "additional_payer_specific_notes", "drug_unit_of_measurement",
                    "standard_charge_methodology", "drug", "product", "brand", "ingredients"],
      gross_charge: ["gross_charge", "gross_charges", "charge", "charges",
                    "standard_charge_gross", "standard_charge_gross_charge"],
      discounted_cash: ["discounted_cash_price", "discounted_cash", "cash_price", "cash_discount_price",
                       "self_pay_price", "self_pay", "cash", "standard_charge_discounted_cash_price",
                       "standard_charge_discounted_cash", "standard_charge_cash", "standard_charge_self_pay",
                       "list_price", "tier_2", "price"],
      minimum: ["de_identified_minimum", "minimum", "min_price", "de_identified_min",
               "standard_charge_de_identified_minimum", "standard_charge_minimum", "standard_charge_min"],
      maximum: ["de_identified_maximum", "maximum", "max_price", "de_identified_max",
               "standard_charge_de_identified_maximum", "standard_charge_maximum", "standard_charge_max"],
      payer_name: ["payer_name", "payer", "insurance_name", "plan_name"],
      standard_charge: ["standard_charge_dollar", "standard_charge", "negotiated_rate",
                       "allowed_amount", "standard_charge_negotiated_dollar"],
    };

    this.colMap = {};
    const normalizedHeaders = this.headers.map(h => this.normalize(h));

    for (const [key, aliases] of Object.entries(alias)) {
      // First pass: exact match, honoring alias priority
      for (const a of aliases) {
        const idx = normalizedHeaders.indexOf(a);
        if (idx !== -1) {
          this.colMap[key] = idx;
          break;
        }
      }
      // Second pass: substring/contains match (only if no exact match found)
      if (this.colMap[key] == null) {
        for (let i = 0; i < normalizedHeaders.length; i++) {
          const h = normalizedHeaders[i];
          if (!h) continue;
          for (const a of aliases) {
            if (!a) continue;
            if (h.includes(a) || (a.length > 4 && h.length > 4 && a.includes(h))) {
              this.colMap[key] = i;
              break;
            }
          }
          if (this.colMap[key] != null) break;
        }
      }
    }
    console.log(`[csv] colMap:`, JSON.stringify(this.colMap));
  }

  private parseCsvLine(line: string): string[] {
    const fields: string[] = [];
    let field = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuote) {
        if (ch === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            field += '"'; i++;
          } else {
            inQuote = false;
          }
        } else {
          field += ch;
        }
      } else {
        if (ch === '"') { inQuote = true; }
        else if (ch === ",") { fields.push(field.trim()); field = ""; }
        else { field += ch; }
      }
    }
    fields.push(field.trim());
    return fields;
  }

  async processChunk(text: string) {
    const combined = this.leftover + text;
    const lines = combined.split(/\r?\n/);
    // Last element may be incomplete — save as leftover
    this.leftover = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;

      if (!this.headersDetected) {
        const candidate = this.parseCsvLine(line);

        // Heuristic 1: Real header rows have short column names.
        // If any field is longer than 80 chars, it's probably attestation/disclaimer text.
        const maxFieldLen = Math.max(...candidate.map(f => f.length));
        if (maxFieldLen > 80) {
          console.log(`[csv] Skipping row (field too long: ${maxFieldLen} chars): ${candidate[0]?.substring(0, 40)}...`);
          continue;
        }

        // Heuristic 2: Check keyword matches with word-boundary matching
        const normalized = candidate.map(f => this.normalize(f));
        const matchCount = normalized.filter(h => {
          const parts = h.split("_");
          return CsvParser.HEADER_KEYWORDS.some(kw => {
            const kwParts = kw.split("_");
            for (let i = 0; i <= parts.length - kwParts.length; i++) {
              if (kwParts.every((kp, j) => parts[i + j] === kp)) return true;
            }
            return false;
          });
        }).length;

        // Heuristic 3: Must have at least one service/code-related column
        const CODE_KEYWORDS = ["code", "cpt", "hcpcs", "billing_code", "drg", "ndc", "revenue_code", "drug_id", "din", "drug", "product"];
        const hasCodeColumn = normalized.some(h => {
          const parts = h.split("_");
          return CODE_KEYWORDS.some(kw => {
            const kwParts = kw.split("_");
            for (let i = 0; i <= parts.length - kwParts.length; i++) {
              if (kwParts.every((kp, j) => parts[i + j] === kp)) return true;
            }
            return h === kw;
          });
        });

        if (matchCount >= 3 && hasCodeColumn) {
          this.headers = candidate;
          this.buildColMap();
          this.headersDetected = true;
          console.log(`[csv] Found header row with ${matchCount} keyword matches`);
        } else {
          console.log(`[csv] Skipping non-header row (${matchCount} matches, hasCode=${hasCodeColumn}): ${candidate.slice(0, 3).join(", ")}...`);
        }
        continue;
      }

      const fields = this.parseCsvLine(line);
      await this.processRow(fields);
    }
  }

  private async processRow(fields: string[]) {
    const col = (key: string) => {
      const idx = this.colMap[key];
      return idx != null && idx < fields.length ? fields[idx].trim() : "";
    };

    // Collect all codes from code|1, code|2, code|3 columns.
    // For pharmacy catalogs, use the drug/package identifier as a LOCAL code.
    const codes: { code: string; type: string }[] = [];
    const addCode = (codeKey: string, typeKey: string) => {
      const c = col(codeKey);
      const rawType = col(typeKey).toUpperCase();
      const t = ACCEPTED_CODES.has(rawType) ? rawType : (codeKey === "code" && /^(D|DP)-/i.test(c) ? "LOCAL" : "CPT");
      if (c && ACCEPTED_CODES.has(t)) codes.push({ code: c, type: t });
    };
    addCode("code", "code_type");
    addCode("code2", "code2_type");
    addCode("code3", "code3_type");

    const description = [col("description"), col("gross_charge") ? "" : null].filter(Boolean)[0] || col("code");

    if (codes.length === 0) return;

    const parseNum = (s: string) => { const n = parseFloat(s.replace(/[,$]/g, "")); return isNaN(n) || n <= 0 ? null : n; };

    const discountedCash = parseNum(col("discounted_cash"));
    const grossCharge = parseNum(col("gross_charge"));
    const minimum = parseNum(col("minimum"));

    // Check if this is a cash/self-pay payer row
    const payerName = col("payer_name").toLowerCase();
    const standardCharge = parseNum(col("standard_charge"));
    let isCashRow = !payerName || payerName === "cash" || payerName.includes("self pay") || payerName.includes("self-pay") || payerName === "uninsured";

    let price: number | null = null;
    if (discountedCash != null) price = discountedCash;
    else if (isCashRow && standardCharge != null) price = standardCharge;
    else if (grossCharge != null) price = grossCharge;
    else if (minimum != null) price = minimum;

    // If a payer name exists and it's not cash-related, skip (we only want cash prices)
    if (payerName && !isCashRow && standardCharge != null && !discountedCash && !grossCharge) return;

    this.itemsFound++;
    await this.onItem({
      description: description || codes[0].code,
      codes,
      price,
    });
  }

  async flush() {
    if (this.leftover.trim() && this.headersDetected) {
      const fields = this.parseCsvLine(this.leftover);
      await this.processRow(fields);
      this.leftover = "";
    }
  }
}

// ── Chain to next run ────────────────────────────────────────────────
function queueNextRun(jobId: string) {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return;
  fetch(`${url}/functions/v1/import-pricing`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key, authorization: `Bearer ${key}` },
    body: JSON.stringify({ job_id: jobId }),
  }).catch(err => console.error(`[import] Chain fetch error:`, err));
}

// ── Main handler ─────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let jobId: string | undefined;

  try {
    jobId = (await req.json()).job_id;
    if (!jobId) return new Response(JSON.stringify({ error: "job_id required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    const { data: job, error: je } = await supabase.from("import_jobs").select("*").eq("id", jobId).single();
    if (je || !job) return new Response(JSON.stringify({ error: "Job not found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
    if (job.status === "done") return new Response(JSON.stringify({ message: "Already done" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
    if (job.status === "processing") return new Response(JSON.stringify({ message: "Already processing" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    try { new URL(job.url); } catch {
      const msg = `Invalid URL: '${job.url.substring(0, 80)}'`;
      await supabase.from("import_jobs").update({ status: "error", error_message: msg, updated_at: new Date().toISOString() }).eq("id", jobId);
      return new Response(JSON.stringify({ error: msg }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await supabase.from("import_jobs").update({ status: "processing", updated_at: new Date().toISOString() }).eq("id", jobId);

    const normalizedUrl = normalizeUrl(job.url);
    const startOffset: number = (job as any).byte_offset ?? 0;
    const format = detectFormat(job.url);

    const fetchHeaders: Record<string, string> = {};
    if (startOffset > 0) fetchHeaders["Range"] = `bytes=${startOffset}-`;

    // For Google Drive, use the combined resolve+fetch that keeps session cookies
    let fileRes: Response;
    const gdriveResult = await resolveGoogleDrive(normalizedUrl, fetchHeaders);
    if (gdriveResult) {
      fileRes = gdriveResult.response;
      console.log(`[import] job=${jobId} format=${format} offset=${startOffset} rows=${job.rows_imported} url=${gdriveResult.url.substring(0, 120)}`);
    } else if (normalizedUrl.includes("drive.google.com") || normalizedUrl.includes("drive.usercontent.google.com")) {
      // Google Drive resolution failed entirely
      const msg = "Failed to resolve Google Drive download URL. Ensure the file is shared publicly.";
      await supabase.from("import_jobs").update({ status: "error", error_message: msg, updated_at: new Date().toISOString() }).eq("id", jobId);
      return new Response(JSON.stringify({ error: msg }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    } else {
      console.log(`[import] job=${jobId} format=${format} offset=${startOffset} rows=${job.rows_imported} url=${normalizedUrl.substring(0, 120)}`);
      fileRes = await fetch(normalizedUrl, { headers: fetchHeaders, redirect: "follow" });
    }

    if ((!fileRes.ok && fileRes.status !== 206) || !fileRes.body) {
      const msg = `Fetch failed: ${fileRes.status}`;
      await supabase.from("import_jobs").update({ status: "error", error_message: msg, updated_at: new Date().toISOString() }).eq("id", jobId);
      return new Response(JSON.stringify({ error: msg }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Capture total file size from HTTP headers (first chunk or any chunk)
    if (!(job as any).total_bytes) {
      let totalBytes: number | null = null;
      const contentRange = fileRes.headers.get("content-range");
      if (contentRange) {
        // Format: bytes 0-1234/56789
        const match = contentRange.match(/\/(\d+)$/);
        if (match) totalBytes = parseInt(match[1], 10);
      } else if (startOffset === 0) {
        const contentLength = fileRes.headers.get("content-length");
        if (contentLength) totalBytes = parseInt(contentLength, 10);
      }
      if (totalBytes && totalBytes > 0) {
        console.log(`[import] total_bytes=${totalBytes}`);
        await supabase.from("import_jobs").update({ total_bytes: totalBytes, updated_at: new Date().toISOString() } as any).eq("id", jobId);
      }
    }

    // ── XLSX handling (background task, lazy row iteration) ─────────────
    if (format === "xlsx") {
      // Run heavy work in background so we don't hit the 2s CPU/worker limit on the request
      const xlsxTask = (async () => {
        try {
          const arrayBuffer = await fileRes.arrayBuffer();
          const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: "array", cellDates: false, cellNF: false, cellText: false });
          const sheetName = workbook.SheetNames[0];
          const sheet = workbook.Sheets[sheetName];

          // Find header row by reading just the first 20 rows
          const headerKeywords = ["code", "cpt", "hcpcs", "description", "procedure", "price", "charge", "cash", "service", "item", "fee"];
          const sample: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false, range: 0 }).slice(0, 20) as any[][];
          let headerRowIdx = 0, bestScore = 0;
          for (let i = 0; i < sample.length; i++) {
            const row = sample[i] || [];
            let score = 0;
            for (const cell of row) {
              const s = String(cell || "").toLowerCase();
              if (s && headerKeywords.some(k => s.includes(k))) score++;
            }
            if (score > bestScore) { bestScore = score; headerRowIdx = i; }
          }
          const headers = (sample[headerRowIdx] || []).map((h: any, i: number) => String(h || "").trim() || `__EMPTY_${i}`);

          // Stream rows starting AFTER header row to keep memory low
          const rowsIter: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet, {
            header: headers, defval: "", raw: false, range: headerRowIdx + 1, blankrows: false,
          }) as Record<string, any>[];

          console.log(`[import] XLSX loaded: ${rowsIter.length} rows from sheet "${sheetName}" (header row ${headerRowIdx}, score ${bestScore})`);
          console.log(`[import] XLSX columns: ${headers.join(", ")}`);

          // Auto-detect columns
          const lower = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "_");
          const findCol = (...patterns: string[]) => headers.find((c: string) => patterns.some(p => lower(c).includes(p))) || null;
          const codeCol = findCol("cpt", "hcpcs", "billing_code", "procedure_code", "code");
          const codeTypeCol = findCol("code_type", "billing_code_type", "code_1_type");
          const descCol = findCol("description", "procedure", "proc_name", "service_name", "item_description", "item", "product", "drug", "medication", "name", "proc");
          const cashCol = findCol("discounted_cash", "cash_price", "self_pay", "cash_charge", "cash");
          const grossCol = findCol("gross_charge", "gross", "standard_charge_gross", "charge_amount", "charge", "unit_charge", "price", "fee", "amount", "rate");
          const minCol = findCol("minimum", "min", "standard_charge_min");

          console.log(`[import] XLSX colMap: code=${codeCol} codeType=${codeTypeCol} desc=${descCol} cash=${cashCol} gross=${grossCol} min=${minCol}`);

          if (!codeCol && !descCol) {
            await supabase.from("import_jobs").update({ status: "error", error_message: "Could not detect code or description columns in XLSX", updated_at: new Date().toISOString() }).eq("id", jobId);
            return;
          }

          // Auto-create provider if missing (mirror CSV behavior)
          let providerId = job.provider_id;
          let hospitalName = job.hospital_name ?? null;
          if (!providerId) {
            try {
              if (!hospitalName) {
                const urlPath = new URL(job.url).pathname;
                const filename = decodeURIComponent(urlPath.split("/").pop() || "").replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
                if (filename.length > 3) hospitalName = filename;
              }
              if (hospitalName) {
                const { data: ex } = await supabase.from("providers").select("id").eq("name", hospitalName).limit(1).maybeSingle();
                if (ex) {
                  providerId = ex.id;
                } else {
                  const { data: np } = await supabase.from("providers").insert({
                    name: hospitalName,
                    address: (job as any).hospital_address || null,
                    city: (job as any).hospital_city || "Unknown",
                    state: (job as any).hospital_state || "FL",
                    zip: (job as any).hospital_zip || null,
                    phone: "N/A", specialty_id: "general",
                  }).select("id").single();
                  if (np) providerId = np.id;
                }
                await supabase.from("import_jobs").update({ provider_id: providerId, hospital_name: hospitalName, updated_at: new Date().toISOString() }).eq("id", jobId);
              }
            } catch (e) { console.error("[import] provider create failed:", e); }
          }

          let specialtyId = "general";
          if (providerId) {
            const { data: prov } = await supabase.from("providers").select("specialty_id").eq("id", providerId).single();
            if (prov) specialtyId = prov.specialty_id;
          }

          const svcMap = new Map<string, any>();
          const priceMap = new Map<string, any>();
          let totalRows = 0;

          const flushSvc = async () => {
            if (!svcMap.size) return;
            const { error } = await supabase.from("services").upsert(Array.from(svcMap.values()), { onConflict: "id", ignoreDuplicates: true });
            if (error) console.error(`[import] services upsert error:`, error.message);
            svcMap.clear();
          };
          const flushPrc = async () => {
            if (!priceMap.size) return;
            const { error } = await supabase.from("service_prices").upsert(Array.from(priceMap.values()), { onConflict: "provider_id,service_id,component", ignoreDuplicates: false });
            if (error) console.error(`[import] prices upsert error:`, error.message);
            priceMap.clear();
          };

          for (let ri = 0; ri < rowsIter.length; ri++) {
            const row = rowsIter[ri];
            const rawCode = codeCol ? String(row[codeCol] || "").trim() : "";
            const rawType = codeTypeCol ? String(row[codeTypeCol] || "").trim().toUpperCase() : "";
            const desc = descCol ? String(row[descCol] || "").trim() : rawCode;

            let price: number | null = null;
            const parsePrice = (v: any) => {
              const n = parseFloat(String(v).replace(/[$,]/g, ""));
              return !isNaN(n) && n > 0 ? n : null;
            };
            if (cashCol) price = parsePrice(row[cashCol]);
            if (price == null && grossCol) price = parsePrice(row[grossCol]);
            if (price == null && minCol) price = parsePrice(row[minCol]);

            if ((!rawCode && !desc) || price == null) continue;

            let codeType = rawType;
            let codeVal = rawCode;
            if (!codeVal) {
              codeType = "LOCAL";
              codeVal = desc.substring(0, 80).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
            } else if (!codeType || !ACCEPTED_CODES.has(codeType)) {
              if (/^\d{5}$/.test(codeVal)) codeType = "CPT";
              else if (/^[A-Z]\d{4}$/i.test(codeVal)) codeType = "HCPCS";
              else if (/^\d{3,4}$/.test(codeVal)) codeType = "REV";
              else codeType = "LOCAL";
            }

            const sid = `${codeType}-${codeVal}`.toLowerCase();
            if (!svcMap.has(sid)) {
              svcMap.set(sid, { id: sid, name: desc || rawCode, specialty_id: specialtyId, description: desc || null, icd10_codes: [] });
            }
            if (providerId) {
              priceMap.set(`${providerId}|${sid}|Cash/Self-Pay`, {
                provider_id: providerId, service_id: sid, component: "Cash/Self-Pay", price,
              });
            }
            totalRows++;
            if (svcMap.size >= 200) await flushSvc();
            if (priceMap.size >= 500) { await flushSvc(); await flushPrc(); }
            // Yield to event loop every 500 rows to avoid CPU starvation
            if (ri % 500 === 0) await new Promise((r) => setTimeout(r, 0));
          }

          await flushSvc();
          await flushPrc();
          console.log(`[import] XLSX done: ${totalRows} items imported`);

          await supabase.from("import_jobs").update({
            status: "done", rows_imported: totalRows,
            byte_offset: arrayBuffer.byteLength,
            total_bytes: arrayBuffer.byteLength,
            hospital_name: hospitalName || job.hospital_name || null,
            updated_at: new Date().toISOString(),
          } as any).eq("id", jobId);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[import] XLSX task error:", msg);
          await supabase.from("import_jobs").update({ status: "error", error_message: msg, updated_at: new Date().toISOString() }).eq("id", jobId);
        }
      })();

      // Run in background — return immediately
      // @ts-ignore EdgeRuntime is available in Supabase edge runtime
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(xlsxTask);

      return new Response(JSON.stringify({ success: true, status: "processing" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    const reader = fileRes.body!.getReader();
    const decoder = new TextDecoder();

    // Resolve provider (first run only)
    let providerId: string | null = job.provider_id;
    let hospitalName: string | null = job.hospital_name ?? null;
    let initialData = "";

    if (startOffset === 0 && !providerId && format === "json") {
      let peek = "";
      const peekChunks: Uint8Array[] = [];
      while (peek.length < 8192) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        peekChunks.push(value);
        peek += decoder.decode(value, { stream: true });
      }
      const meta = extractMeta(peek);
      if (meta.name) {
        hospitalName = meta.name;
        const { data: ex } = await supabase.from("providers").select("id").eq("name", meta.name).limit(1).maybeSingle();
        if (ex) { providerId = ex.id; }
        else {
          const { data: np, error: pe } = await supabase.from("providers")
            .insert({ name: meta.name, address: meta.address, city: meta.city, state: meta.state, zip: meta.zip, phone: meta.phone, specialty_id: "general" })
            .select("id").single();
          if (!pe && np) providerId = np.id;
        }
        await supabase.from("import_jobs").update({ provider_id: providerId, hospital_name: hospitalName, updated_at: new Date().toISOString() }).eq("id", jobId);
      }
      initialData = peekChunks.reduce((acc, c) => acc + decoder.decode(c, { stream: true }), "");
    }

    // For CSV on first run, create provider from job metadata or filename
    if (startOffset === 0 && !providerId && format === "csv") {
      try {
        // Prefer hospital_name already set on the job (from dialog) over filename
        if (!hospitalName) {
          const urlPath = new URL(job.url).pathname;
          const filename = decodeURIComponent(urlPath.split("/").pop() || "").replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
          if (filename.length > 3) hospitalName = filename;
        }
        if (hospitalName) {
          const { data: ex } = await supabase.from("providers").select("id").eq("name", hospitalName).limit(1).maybeSingle();
          if (ex) {
            providerId = ex.id;
          } else {
            // Use metadata from job if available (passed from dialog)
            const { data: np, error: pe } = await supabase.from("providers")
              .insert({
                name: hospitalName,
                address: (job as any).hospital_address || null,
                city: (job as any).hospital_city || "Unknown",
                state: (job as any).hospital_state || "FL",
                zip: (job as any).hospital_zip || null,
                phone: "N/A",
                specialty_id: "general",
              })
              .select("id").single();
            if (!pe && np) providerId = np.id;
          }
          await supabase.from("import_jobs").update({ provider_id: providerId, hospital_name: hospitalName, updated_at: new Date().toISOString() }).eq("id", jobId);
        }
      } catch {}
    }

    let specialtyId = "general";
    if (providerId) {
      const { data: prov } = await supabase.from("providers").select("specialty_id").eq("id", providerId).single();
      if (prov) specialtyId = prov.specialty_id;
    }

    // Processing setup
    const MAX_BYTES = 4 * 1024 * 1024;
    let bytesThisRun = 0;
    let totalRows = job.rows_imported ?? 0;
    let itemsThisRun = 0;
    const svcMap = new Map<string, any>();
    const priceMap = new Map<string, any>();

    const flushSvc = async () => {
      if (!svcMap.size) return;
      const { error } = await supabase.from("services").upsert(Array.from(svcMap.values()), { onConflict: "id", ignoreDuplicates: true });
      if (error) console.error(`[import] services upsert error:`, error.message);
      svcMap.clear();
    };
    const flushPrc = async () => {
      if (!priceMap.size) return;
      const { error } = await supabase.from("service_prices").upsert(Array.from(priceMap.values()), { onConflict: "provider_id,service_id,component", ignoreDuplicates: false });
      if (error) console.error(`[import] prices upsert error:`, error.message, `batch_size=${priceMap.size}`);
      priceMap.clear();
    };

    const handleItem = async (item: ParsedItem) => {
      if (item.codes.length === 0 || item.price == null) return;
      for (const { code, type } of item.codes) {
        const sid = `${type}-${code}`.toLowerCase();
        if (!svcMap.has(sid)) {
          svcMap.set(sid, {
            id: sid, name: item.description || code,
            specialty_id: specialtyId, description: item.description || null,
            icd10_codes: [],
          });
        }
        if (providerId) {
          const pkey = `${providerId}|${sid}|Cash/Self-Pay`;
          priceMap.set(pkey, {
            provider_id: providerId, service_id: sid,
            component: "Cash/Self-Pay", price: item.price,
          });
        }
      }
      totalRows++;
      itemsThisRun++;
      if (svcMap.size >= 100) await flushSvc();
      if (priceMap.size >= 250) { await flushSvc(); await flushPrc(); }
    };

    // Create the appropriate parser
    const jsonParser = format === "json" ? new StreamParser(handleItem) : null;
    const csvParser = format === "csv" ? new CsvParser(handleItem) : null;

    // For CSV resume: if offset > 0, we need to skip the header row since
    // we're mid-file. We store headers in error_message field temporarily
    // (hacky but avoids schema change). Actually, for CSV resume we
    // re-read from offset which may be mid-line. The leftover buffer
    // in CsvParser handles partial lines. But we need headers.
    // On resume, the first complete line will be a data row, not headers.
    // We store the detected headers as JSON in hospital_name on first run (appended).
    // Better approach: store column headers in a job metadata. For now,
    // we re-fetch from byte 0 just for the header line on CSV resume.
    if (csvParser && startOffset > 0) {
      // Fetch first 64KB to find the real header row (may be after many metadata rows)
      try {
        const gdriveHeader = await resolveGoogleDrive(normalizedUrl, { Range: "bytes=0-65535" });
        const headerRes = gdriveHeader?.response ?? await fetch(normalizedUrl, { headers: { Range: "bytes=0-65535" } });
        const headerText = await headerRes.text();
        const headerLines = headerText.split(/\r?\n/);
        const CODE_KW = ["code", "cpt", "hcpcs", "billing_code", "drg", "ndc", "revenue_code"];
        for (const hl of headerLines) {
          if (!hl.trim()) continue;
          const fields = hl.split(",").map(f => f.trim().replace(/^"|"$/g, ""));
          // Skip rows with very long fields (attestation text)
          if (Math.max(...fields.map(f => f.length)) > 80) continue;
          const normalized = fields.map(f => f.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, ""));
          const kwList = ["billing_code", "code", "cpt", "hcpcs", "description", "gross_charge",
             "standard_charge", "charge", "cash", "payer", "negotiated", "procedure",
             "service", "drg", "revenue_code"];
          const matchCount = normalized.filter(h => {
            const parts = h.split("_");
            return kwList.some(kw => {
              const kwParts = kw.split("_");
              for (let i = 0; i <= parts.length - kwParts.length; i++) {
                if (kwParts.every((kp, j) => parts[i + j] === kp)) return true;
              }
              return false;
            });
          }).length;
          const hasCodeCol = normalized.some(h => {
            const parts = h.split("_");
            return CODE_KW.some(kw => {
              const kwParts = kw.split("_");
              for (let i = 0; i <= parts.length - kwParts.length; i++) {
                if (kwParts.every((kp, j) => parts[i + j] === kp)) return true;
              }
              return false;
            });
          });
          if (matchCount >= 3 && hasCodeCol) {
            csvParser.setHeaders(fields);
            console.log(`[csv] Resume: found header row with ${matchCount} keyword matches`);
            break;
          }
        }
      } catch (e) {
        console.error("[import] Failed to re-fetch CSV headers:", e);
      }
    }

    if (initialData) {
      bytesThisRun += new TextEncoder().encode(initialData).byteLength;
      if (jsonParser) await jsonParser.processChunk(initialData);
    }

    let reachedEnd = false;
    while (bytesThisRun < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) { reachedEnd = true; break; }
      if (!value) continue;
      bytesThisRun += value.byteLength;
      const text = decoder.decode(value, { stream: true });
      if (jsonParser) await jsonParser.processChunk(text);
      if (csvParser) await csvParser.processChunk(text);
    }

    if (reachedEnd) {
      if (jsonParser) await jsonParser.flush();
      if (csvParser) await csvParser.flush();
    }

    try { reader.cancel(); } catch {}
    await flushSvc();
    await flushPrc();

    const newOffset = startOffset + bytesThisRun;
    const parserStats = jsonParser
      ? `found=${jsonParser.itemsFound} withCodes=${jsonParser.itemsWithCodes} withPrice=${jsonParser.itemsWithPrice} noCodes=${jsonParser.itemsSkippedNoCodes} noPrice=${jsonParser.itemsSkippedNoPrice}`
      : `csvItems=${csvParser?.itemsFound ?? 0}`;
    console.log(`[import] items=${itemsThisRun} total=${totalRows} bytes=${bytesThisRun} offset=${newOffset} end=${reachedEnd} ${parserStats}`);

    if (!reachedEnd) {
      await supabase.from("import_jobs").update({
        status: "pending", rows_imported: totalRows, byte_offset: newOffset,
        hospital_name: hospitalName || job.hospital_name || null,
        updated_at: new Date().toISOString(),
      } as any).eq("id", jobId);
      queueNextRun(jobId);
      return new Response(JSON.stringify({ queued: true, rows_imported: totalRows }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("import_jobs").update({
      status: "done", rows_imported: totalRows, byte_offset: newOffset,
      hospital_name: hospitalName || job.hospital_name || null,
      updated_at: new Date().toISOString(),
    } as any).eq("id", jobId);
    return new Response(JSON.stringify({ success: true, rows_imported: totalRows, hospital_name: hospitalName }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[import] Error:", err);
    if (jobId) {
      try { await supabase.from("import_jobs").update({ status: "error", error_message: err instanceof Error ? err.message : "Unknown", updated_at: new Date().toISOString() }).eq("id", jobId); } catch {}
    }
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
