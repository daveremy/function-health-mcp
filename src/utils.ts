import type { ExportData, HealthResult } from "./types.js";

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

/** Build a map of biomarker name (lowercase) -> category name from export data */
export function buildCategoryMap(data: { categories: Array<{ categoryName: string; biomarkers: Array<{ name: string }> }> }): Map<string, string> {
  const map = new Map<string, string>();
  for (const cat of data.categories) {
    for (const bm of cat.biomarkers) {
      map.set(bm.name.toLowerCase(), cat.categoryName);
    }
  }
  return map;
}

// ── Misc ──

/** Delay for rate limiting */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
