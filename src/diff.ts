import type { ExportData, BiomarkerChange, DiffResult, HealthResult } from "./types.js";
import { getResultName, deriveExportDate, buildCategoryMap } from "./utils.js";

/** Compare two exports and classify changes */
export function diffExports(from: ExportData, to: ExportData): DiffResult {
  const fromDate = deriveExportDate(from);
  const toDate = deriveExportDate(to);

  const fromMap = buildResultMap(from);
  const toMap = buildResultMap(to);
  const categoryMap = buildCategoryMap(to);

  const newBiomarkers: BiomarkerChange[] = [];
  const improved: BiomarkerChange[] = [];
  const worsened: BiomarkerChange[] = [];
  const significantlyChanged: BiomarkerChange[] = [];
  const unchanged: BiomarkerChange[] = [];

  for (const [name, toEntry] of toMap) {
    const fromEntry = fromMap.get(name);
    const category = categoryMap.get(name.toLowerCase()) ?? "Unknown";

    const change: BiomarkerChange = {
      biomarkerName: name,
      category,
      previousValue: fromEntry?.value ?? null,
      currentValue: toEntry.value,
      previousInRange: fromEntry?.inRange ?? null,
      currentInRange: toEntry.inRange,
      changeType: "unchanged",
      percentChange: null,
    };

    if (!fromEntry) {
      change.changeType = "new";
      newBiomarkers.push(change);
      continue;
    }

    // Calculate percent change if both are numeric
    const fromNum = parseFloat(fromEntry.value);
    const toNum = parseFloat(toEntry.value);
    if (!isNaN(fromNum) && !isNaN(toNum) && fromNum !== 0) {
      change.percentChange = Math.round(((toNum - fromNum) / Math.abs(fromNum)) * 1000) / 10;
    }

    if (!fromEntry.inRange && toEntry.inRange) {
      change.changeType = "improved";
      improved.push(change);
    } else if (fromEntry.inRange && !toEntry.inRange) {
      change.changeType = "worsened";
      worsened.push(change);
    } else if (change.percentChange !== null && Math.abs(change.percentChange) > 10) {
      change.changeType = "changed";
      significantlyChanged.push(change);
    } else {
      unchanged.push(change);
    }
  }

  return {
    fromDate,
    toDate,
    newBiomarkers,
    improved,
    worsened,
    significantlyChanged,
    unchanged,
    summary: {
      totalCompared: toMap.size,
      newCount: newBiomarkers.length,
      improvedCount: improved.length,
      worsenedCount: worsened.length,
      significantChangeCount: significantlyChanged.length,
      unchangedCount: unchanged.length,
    },
  };
}

interface ResultEntry {
  value: string;
  inRange: boolean;
}

function buildResultMap(data: ExportData): Map<string, ResultEntry> {
  const map = new Map<string, ResultEntry>();

  // Build biomarker id -> name lookup for fallback
  const idToName = new Map<string, string>();
  for (const bm of data.biomarkers) {
    idToName.set(bm.id, bm.name);
  }

  for (const result of data.results) {
    const name = findBiomarkerName(result, idToName);
    if (name) {
      map.set(name, {
        value: result.displayResult || result.calculatedResult,
        inRange: result.inRange,
      });
    }
  }

  return map;
}

function findBiomarkerName(result: HealthResult, idToName: Map<string, string>): string | null {
  // Try the common name fields first (shared logic)
  const name = getResultName(result);
  if (name) return name;

  // Fall back to ID-based lookup
  const r = result as Record<string, unknown>;
  if (typeof r.biomarkerId === "string") return idToName.get(r.biomarkerId) ?? null;
  if (typeof r.biomarker_id === "string") return idToName.get(r.biomarker_id) ?? null;
  return null;
}
