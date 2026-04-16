// Shared types & constants for the Hint Sandbox feature.

export type HintScope = "practice" | "partner";

export type HintResource =
  | "patients"
  | "memberships"
  | "invoices"
  | "plans"
  | "practice"
  | "practices"
  | "partner";

export interface HintResponse {
  source: string;
  upstream: string;
  scope: string;
  status: number;
  elapsedMs: number;
  generated: string;
  pagination?: {
    total: number | null;
    headers: Record<string, string>;
  };
  data: unknown;
}

// Resources available per scope. The Practice (provider) API exposes the
// day-to-day clinic resources; the Partner API in Hint's staging sandbox
// only exposes a list of integrated practices and the partner record itself.
export const RESOURCES_BY_SCOPE: Record<
  HintScope,
  { id: HintResource; label: string }[]
> = {
  practice: [
    { id: "patients", label: "Patients" },
    { id: "memberships", label: "Memberships" },
    { id: "invoices", label: "Invoices" },
    { id: "plans", label: "Plans" },
    { id: "practice", label: "Practice" },
  ],
  partner: [
    { id: "practices", label: "Practices" },
    { id: "partner", label: "Partner" },
  ],
};

export const SCOPE_BASE_PATH: Record<HintScope, string> = {
  practice: "api.staging.hint.com/api/provider",
  partner: "api.staging.hint.com/api/partner",
};

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

// Singleton resources — Hint returns a single object, not a list. We don't
// send pagination params to these.
export const SINGLETON_RESOURCES = new Set<HintResource>([
  "practice",
  "partner",
]);

export const PAGINATED_RESOURCES = new Set<HintResource>([
  "patients",
  "memberships",
  "invoices",
  "plans",
  "practices",
]);

// Hint's API supports a `q` text-search param on these list endpoints.
export const SEARCHABLE_RESOURCES = new Set<HintResource>([
  "patients",
  "memberships",
]);

export function extractRecords(
  data: unknown,
  resource?: HintResource,
): Record<string, unknown>[] | null {
  if (!data) return null;
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (typeof data === "object") {
    const obj = data as Record<string, unknown>;
    // Practice/Partner are single resources — render as one row.
    if (resource && SINGLETON_RESOURCES.has(resource)) return [obj];
    // Hint sometimes wraps list responses with { patients: [...] } etc.
    for (const v of Object.values(obj)) {
      if (Array.isArray(v)) return v as Record<string, unknown>[];
    }
    return [obj];
  }
  return null;
}

export function pickColumns(records: Record<string, unknown>[]): string[] {
  if (records.length === 0) return [];
  const first = records[0];
  const preferred = [
    "id",
    "first_name",
    "last_name",
    "email",
    "name",
    "status",
    "amount",
    "amount_cents",
    "created_at",
    "start_date",
    "end_date",
  ];
  const present = preferred.filter((p) => p in first);
  if (present.length >= 3) return present.slice(0, 6);
  return Object.keys(first).slice(0, 6);
}

export function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v).slice(0, 60);
  return String(v);
}
