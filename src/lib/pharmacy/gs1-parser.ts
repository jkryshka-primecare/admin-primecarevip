/**
 * GS1 DataMatrix / 2D barcode parser.
 *
 * Pharmaceutical 2D Data Matrix barcodes encode data using GS1
 * Application Identifiers (AIs). Common AIs:
 *
 *   (01) – GTIN (14 digits, contains NDC)
 *   (10) – Lot / Batch number
 *   (17) – Expiration date (YYMMDD)
 *   (21) – Serial number
 *   (30) – Quantity
 *
 * The Group Separator character (GS, ASCII 29 / \x1D) delimits
 * variable-length fields. Some scanners substitute GS with other
 * characters or omit it entirely.
 */

export interface GS1ParsedData {
  gtin: string | null;
  ndc: string | null;
  lot: string | null;
  expiry: string | null;      // ISO date string YYYY-MM-DD
  serialNumber: string | null;
  quantity: number | null;
  raw: string;
}

// FNC1 / Group Separator variants scanners may emit
const GS = String.fromCharCode(29); // ASCII GS
const GS_REGEX = /[\x1d\x1e]|\{GS\}|\[GS\]/g;

/**
 * Fixed-length AIs: we know exactly how many digits follow.
 * Variable-length AIs are terminated by GS or end-of-string.
 */
const FIXED_LENGTH_AIS: Record<string, number> = {
  "01": 14, // GTIN
  "02": 14, // GTIN of contained items
  "17": 6,  // Expiration YYMMDD
  "11": 6,  // Production date
  "13": 6,  // Packaging date
  "15": 6,  // Best before date
  "16": 6,  // Sell by date
};

const VARIABLE_AIS = ["10", "21", "30", "240", "241", "250", "251"];

/**
 * Parse a GS1 element string (from a 2D Data Matrix barcode).
 */
export function parseGS1(raw: string): GS1ParsedData {
  const result: GS1ParsedData = {
    gtin: null,
    ndc: null,
    lot: null,
    expiry: null,
    serialNumber: null,
    quantity: null,
    raw,
  };

  // Normalize: replace GS variants with a single delimiter
  let data = raw.replace(GS_REGEX, GS);

  // Strip leading FNC1 / ]d2 / ]C1 symbology identifiers
  data = data.replace(/^(\]d2|\]C1|\]e0|\]Q3)/, "");

  let pos = 0;

  while (pos < data.length) {
    // Skip GS characters
    if (data[pos] === GS[0]) {
      pos++;
      continue;
    }

    // Try to match a known AI
    let matched = false;

    // Check 3-digit AIs first, then 2-digit
    for (const aiLen of [3, 2]) {
      if (pos + aiLen > data.length) continue;
      const ai = data.substring(pos, pos + aiLen);
      const valueStart = pos + aiLen;

      if (FIXED_LENGTH_AIS[ai] !== undefined) {
        const len = FIXED_LENGTH_AIS[ai];
        const value = data.substring(valueStart, valueStart + len);
        applyAI(result, ai, value);
        pos = valueStart + len;
        matched = true;
        break;
      }

      if (VARIABLE_AIS.includes(ai)) {
        const gsIdx = data.indexOf(GS[0], valueStart);
        const end = gsIdx === -1 ? data.length : gsIdx;
        const value = data.substring(valueStart, end);
        applyAI(result, ai, value);
        pos = end;
        matched = true;
        break;
      }
    }

    if (!matched) {
      // Unknown AI or plain barcode — skip to next GS or end
      const gsIdx = data.indexOf(GS[0], pos + 1);
      pos = gsIdx === -1 ? data.length : gsIdx;
    }
  }

  return result;
}

function applyAI(result: GS1ParsedData, ai: string, value: string) {
  switch (ai) {
    case "01":
      result.gtin = value;
      result.ndc = gtinToNdc(value);
      break;
    case "10":
      result.lot = value;
      break;
    case "17":
      result.expiry = parseGS1Date(value);
      break;
    case "21":
      result.serialNumber = value;
      break;
    case "30":
      result.quantity = parseInt(value, 10) || null;
      break;
  }
}

/**
 * Convert a 14-digit GTIN to an 11-digit NDC.
 *
 * GTIN-14 for pharmaceuticals:
 *   Indicator (1) + NDC 5-4-2 format (11 digits) + check digit (1)
 *   → We strip indicator & check digit, then format as 5-4-2.
 *
 * Also handles GTIN-12 (UPC-A) embedded NDCs:
 *   NDC in positions 1-10 of a 12-digit code (strip leading 0 + check digit).
 */
function gtinToNdc(gtin: string): string {
  const digits = gtin.replace(/\D/g, "");

  if (digits.length === 14) {
    // Strip indicator digit (pos 0) and check digit (pos 13)
    const ndc11 = digits.substring(1, 12);
    // Format as 5-4-2
    return `${ndc11.substring(0, 5)}-${ndc11.substring(5, 9)}-${ndc11.substring(9, 11)}`;
  }

  if (digits.length === 12) {
    // UPC-A: strip check digit, take 10 digits starting at pos 1
    const ndc10 = digits.substring(1, 11);
    // Format as 4-4-2
    return `${ndc10.substring(0, 4)}-${ndc10.substring(4, 8)}-${ndc10.substring(8, 10)}`;
  }

  // Return as-is if we can't parse
  return gtin;
}

/**
 * Parse GS1 date (YYMMDD) to ISO string (YYYY-MM-DD).
 * Day "00" means last day of month.
 */
function parseGS1Date(yymmdd: string): string | null {
  if (yymmdd.length !== 6) return null;

  const yy = parseInt(yymmdd.substring(0, 2), 10);
  const mm = parseInt(yymmdd.substring(2, 4), 10);
  let dd = parseInt(yymmdd.substring(4, 6), 10);

  // GS1 convention: years 00-49 → 2000s, 50-99 → 1900s
  const year = yy <= 49 ? 2000 + yy : 1900 + yy;

  // Day "00" = last day of month
  if (dd === 0) {
    dd = new Date(year, mm, 0).getDate();
  }

  const m = String(mm).padStart(2, "0");
  const d = String(dd).padStart(2, "0");

  return `${year}-${m}-${d}`;
}

/**
 * Detect whether a scanned string looks like a GS1 DataMatrix barcode.
 */
export function isGS1Barcode(data: string): boolean {
  // Starts with symbology identifier
  if (/^(\]d2|\]C1|\]e0|\]Q3)/.test(data)) return true;
  // Starts with AI (01) which is the GTIN
  if (/^01\d{14}/.test(data)) return true;
  // Contains a GS character
  if (GS_REGEX.test(data)) return true;
  // Long numeric string that could be GTIN + additional AIs
  if (/^\d{16,}/.test(data)) return true;
  return false;
}
