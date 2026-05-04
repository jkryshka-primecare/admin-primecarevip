/**
 * NDC Lookup via openFDA Drug API (free, no key required).
 * Converts scanned NDC to a usable format and fetches medication details.
 */

export interface NDCLookupResult {
  brandName: string;
  genericName: string;
  strength: string;
  dosageForm: string;
  manufacturer: string;
  category: string;
}

/**
 * Normalize an NDC to the 11-digit format openFDA expects,
 * then also try the raw value and dashed variants.
 */
function buildNdcQueries(ndc: string): string[] {
  const clean = ndc.replace(/-/g, "").replace(/^0+/, "");
  const queries = new Set<string>();
  queries.add(ndc);
  queries.add(clean);

  // Zero-pad to 11 digits and try all 3 standard segment patterns (4-4-2, 5-3-2, 5-4-1)
  const padded = clean.padStart(11, "0");
  queries.add(padded);
  queries.add(`${padded.slice(0, 4)}-${padded.slice(4, 8)}-${padded.slice(8)}`);
  queries.add(`${padded.slice(0, 5)}-${padded.slice(5, 8)}-${padded.slice(8)}`);
  queries.add(`${padded.slice(0, 5)}-${padded.slice(5, 9)}-${padded.slice(9)}`);

  // Also try product_ndc (2-segment, without package code) — openFDA indexes this format
  const dashed = ndc.includes("-") ? ndc : `${padded.slice(0, 5)}-${padded.slice(5, 9)}-${padded.slice(9)}`;
  const segments = dashed.split("-");
  if (segments.length === 3) {
    queries.add(`${segments[0]}-${segments[1]}`); // product_ndc (no package)
  }

  return [...queries];
}

/**
 * Map openFDA pharm_class values to our CATEGORIES.
 */
function mapCategory(pharmClasses: string[] | undefined): string {
  if (!pharmClasses?.length) return "Other";
  const joined = pharmClasses.join(" ").toLowerCase();
  if (joined.includes("analgesic") || joined.includes("anti-inflammatory")) return "Analgesics";
  if (joined.includes("antibiotic") || joined.includes("anti-infective") || joined.includes("antimicrobial")) return "Antibiotics";
  if (joined.includes("antihypertensive") || joined.includes("angiotensin") || joined.includes("calcium channel")) return "Antihypertensives";
  if (joined.includes("antidiabetic") || joined.includes("hypoglycemic") || joined.includes("insulin")) return "Antidiabetics";
  if (joined.includes("antihistamine") || joined.includes("histamine")) return "Antihistamines";
  if (joined.includes("cardiovascular") || joined.includes("cardiac") || joined.includes("statin")) return "Cardiovascular";
  if (joined.includes("gastrointestinal") || joined.includes("proton pump") || joined.includes("antacid")) return "Gastrointestinal";
  if (joined.includes("respiratory") || joined.includes("bronchodilator") || joined.includes("pulmonary")) return "Respiratory";
  if (joined.includes("vitamin") || joined.includes("supplement") || joined.includes("mineral")) return "Vitamins & Supplements";
  return "Other";
}

/**
 * Clean FDA strength format (e.g. "500 mg/1" → "500mg", "10 mg/1" → "10mg")
 */
function cleanStrength(raw: string): string {
  if (!raw) return "";
  return raw.replace(/\s*\/\s*1$/, "").replace(/\s+/g, "");
}

/**
 * Map openFDA dosage_form to our DOSAGE_FORMS.
 */
function mapDosageForm(raw: string | undefined): string {
  if (!raw) return "Tablet";
  const lower = raw.toLowerCase();
  if (lower.includes("tablet")) return "Tablet";
  if (lower.includes("capsule")) return "Capsule";
  if (lower.includes("syrup") || lower.includes("solution") || lower.includes("suspension") || lower.includes("liquid")) return "Syrup";
  if (lower.includes("injection") || lower.includes("injectable")) return "Injection";
  if (lower.includes("cream")) return "Cream";
  if (lower.includes("ointment")) return "Ointment";
  if (lower.includes("drop") || lower.includes("ophthalmic")) return "Drops";
  if (lower.includes("inhaler") || lower.includes("aerosol") || lower.includes("inhalation")) return "Inhaler";
  if (lower.includes("patch") || lower.includes("transdermal")) return "Patch";
  if (lower.includes("suppository") || lower.includes("rectal")) return "Suppository";
  return "Tablet";
}

/**
 * localStorage cache: NDC → { result, ts }. TTL = 30 days.
 * `result: null` means "confirmed not found in FDA" so we don't re-query.
 */
const CACHE_PREFIX = "ndc-lookup:";
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface CacheEntry {
  result: NDCLookupResult | null;
  ts: number;
}

function readCache(ndc: string): CacheEntry | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + ndc);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    if (Date.now() - entry.ts > CACHE_TTL_MS) {
      localStorage.removeItem(CACHE_PREFIX + ndc);
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

function writeCache(ndc: string, result: NDCLookupResult | null) {
  if (typeof localStorage === "undefined") return;
  try {
    const entry: CacheEntry = { result, ts: Date.now() };
    localStorage.setItem(CACHE_PREFIX + ndc, JSON.stringify(entry));
  } catch {
    // Quota exceeded or storage disabled — silently skip
  }
}

/** Clear all cached NDC lookups (useful from a debug/admin UI). */
export function clearNDCCache() {
  if (typeof localStorage === "undefined") return;
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(CACHE_PREFIX)) toRemove.push(key);
  }
  toRemove.forEach((k) => localStorage.removeItem(k));
}

/**
 * Look up an NDC number using the openFDA Drug API.
 * Returns null if not found. Results (including null) are cached for 30 days.
 */
export async function lookupNDC(ndc: string): Promise<NDCLookupResult | null> {
  // Cache hit (positive or negative)
  const cached = readCache(ndc);
  if (cached) return cached.result;

  const queries = buildNdcQueries(ndc);

  // Try openFDA drug/ndc endpoint first
  for (const q of queries) {
    try {
      const url = `https://api.fda.gov/drug/ndc.json?search=(product_ndc:"${encodeURIComponent(q)}"+OR+package_ndc:"${encodeURIComponent(q)}")&limit=1`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      const result = data?.results?.[0];
      if (result) {
        const out: NDCLookupResult = {
          brandName: result.brand_name || result.generic_name || "",
          genericName: result.generic_name || "",
          strength: cleanStrength(result.active_ingredients?.[0]?.strength || ""),
          dosageForm: mapDosageForm(result.dosage_form),
          manufacturer: result.labeler_name || "",
          category: mapCategory(result.pharm_class),
        };
        writeCache(ndc, out);
        return out;
      }
    } catch {
      // continue to next query variant
    }
  }

  // Fallback: try openFDA drug/label endpoint
  for (const q of queries) {
    try {
      const url = `https://api.fda.gov/drug/label.json?search=(openfda.package_ndc:"${encodeURIComponent(q)}"+OR+openfda.product_ndc:"${encodeURIComponent(q)}")&limit=1`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      const result = data?.results?.[0];
      const openfda = result?.openfda;
      if (openfda) {
        const out: NDCLookupResult = {
          brandName: openfda.brand_name?.[0] || openfda.generic_name?.[0] || "",
          genericName: openfda.generic_name?.[0] || "",
          strength: openfda.substance_name?.[0] || "",
          dosageForm: mapDosageForm(openfda.dosage_form?.[0]),
          manufacturer: openfda.manufacturer_name?.[0] || "",
          category: mapCategory(openfda.pharm_class_epc),
        };
        writeCache(ndc, out);
        return out;
      }
    } catch {
      // continue
    }
  }

  // Cache the negative result so we don't keep hitting the API
  writeCache(ndc, null);
  return null;
}
