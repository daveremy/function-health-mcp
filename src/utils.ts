import type { Biomarker, ExportData, HealthResult, SexDetails } from "./types.js";

// ── Shared constants ──

export const BASE_URL = "https://production-member-app-mid-lhuqotpy2a-ue.a.run.app/api/v1";

export const FIREBASE_REFRESH_URL = "https://securetoken.googleapis.com/v1/token?key=AIzaSyDnxHI-7Xh7JtQrYzRv8n8wJNl3jH5jKl0";

export const DEFAULT_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  Accept: "application/json, text/plain, */*",
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "fe-app-version": "0.84.0",
  "x-backend-skip-cache": "true",
  referer: "https://my.functionhealth.com/",
};

// ── Date helpers ──

export function formatLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function today(): string {
  return formatLocalDate(new Date());
}

// ── Biomarker helpers ──

/** Fuzzy match a query against a biomarker name. Case-insensitive substring match. */
export function fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase().trim();
  const t = target.toLowerCase();
  return t.includes(q);
}

/** Extract biomarker name from a result object (handles multiple field naming conventions) */
export function getResultName(r: Record<string, unknown>): string | null {
  if (typeof r.biomarkerName === "string") return r.biomarkerName;
  if (typeof r.name === "string") return r.name;
  return null;
}

/** Derive the export date from result data, with configurable fallback */
export function deriveExportDate(data: { results: HealthResult[] }, fallback = "unknown"): string {
  if (data.results.length > 0) {
    let max = "";
    for (const r of data.results) {
      if (r.dateOfService && r.dateOfService > max) max = r.dateOfService;
    }
    if (max) return max.slice(0, 10);
  }
  return fallback;
}

/** Build a map of biomarker name (lowercase) -> category names from export data.
 *  Biomarkers in multiple categories get comma-separated names. */
export function buildCategoryMap(data: { categories: Array<{ categoryName: string; biomarkers: Array<{ name: string }> }> }): Map<string, string> {
  const map = new Map<string, string>();
  for (const cat of data.categories) {
    for (const bm of cat.biomarkers) {
      const key = bm.name.toLowerCase();
      const existing = map.get(key);
      map.set(key, existing ? `${existing}, ${cat.categoryName}` : cat.categoryName);
    }
  }
  return map;
}

/** Resolve sex-appropriate SexDetails for a biomarker based on user's biologicalSex */
export function resolveSexFilter(userSex?: string): string {
  return userSex?.toLowerCase() === "male" ? "Male"
    : userSex?.toLowerCase() === "female" ? "Female"
    : "All";
}

/** Pick the best SexDetails entry for the given sex filter */
export function resolveSexDetails(bm: Biomarker, sexFilter: string): SexDetails | undefined {
  return bm.sexDetails.find(sd => sd.sex === sexFilter)
    ?? bm.sexDetails.find(sd => sd.sex === "All")
    ?? bm.sexDetails[0];
}

/** Sort comparator for dateOfService descending (latest first) */
export function byDateDesc(a: HealthResult, b: HealthResult): number {
  return (b.dateOfService || "").localeCompare(a.dateOfService || "");
}

/** Filter results matching a biomarker name (fuzzy) and return sorted by date descending */
export function findMatchingResults(results: HealthResult[], name: string): HealthResult[] {
  return results
    .filter(r => {
      const rName = getResultName(r);
      return rName ? fuzzyMatch(name, rName) : false;
    })
    .sort(byDateDesc);
}

// ── Misc ──

/** Delay for rate limiting */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
