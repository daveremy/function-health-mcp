import { isDeepStrictEqual } from "node:util";
import type { ExportData, BiomarkerChange, DiffResult, MetaChanges, ChangeNotification } from "./types.js";
import { getResultName, getResultValue, deriveExportDate, buildCategoryMap, byDateDesc } from "./utils.js";
import { saveChangeNotification } from "./store.js";

/** Compare two exports and classify changes.
 *  Optional labels override the derived dates (useful when the storage key
 *  differs from the latest dateOfService, e.g. round key = earliest date). */
export function diffExports(from: ExportData, to: ExportData, fromLabel?: string, toLabel?: string): DiffResult {
  const fromDate = fromLabel ?? deriveExportDate(from);
  const toDate = toLabel ?? deriveExportDate(to);

  const fromMap = buildResultMap(from);
  const toMap = buildResultMap(to);
  const categoryMap = buildCategoryMap(to);

  const newBiomarkers: BiomarkerChange[] = [];
  const improved: BiomarkerChange[] = [];
  const worsened: BiomarkerChange[] = [];
  const significantlyChanged: BiomarkerChange[] = [];
  const disappeared: BiomarkerChange[] = [];
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
    } else if (change.percentChange === null && fromEntry.value !== toEntry.value) {
      // Non-numeric value changed (e.g. "CLEAR" → "ABNORMAL")
      change.changeType = "changed";
      significantlyChanged.push(change);
    } else {
      unchanged.push(change);
    }
  }

  // Detect disappeared markers (in fromMap but not in toMap)
  for (const [name, fromEntry] of fromMap) {
    if (!toMap.has(name)) {
      const category = categoryMap.get(name.toLowerCase()) ?? "Unknown";
      disappeared.push({
        biomarkerName: name,
        category,
        previousValue: fromEntry.value,
        currentValue: "",
        previousInRange: fromEntry.inRange,
        currentInRange: false,
        changeType: "disappeared",
        percentChange: null,
      });
    }
  }

  return {
    fromDate,
    toDate,
    newBiomarkers,
    improved,
    worsened,
    significantlyChanged,
    disappeared,
    unchanged,
    summary: {
      totalCompared: toMap.size,
      newCount: newBiomarkers.length,
      improvedCount: improved.length,
      worsenedCount: worsened.length,
      significantChangeCount: significantlyChanged.length,
      disappearedCount: disappeared.length,
      unchangedCount: unchanged.length,
    },
  };
}

interface ResultEntry {
  value: string;
  inRange: boolean;
}

/** Compare non-result metadata between two exports. Only populates fields that changed. */
export function diffMeta(from: ExportData | null, to: ExportData): MetaChanges {
  const changes: MetaChanges = {};

  // Biological age
  const prevAge = from?.biologicalAge?.biologicalAge ?? null;
  const currAge = to.biologicalAge?.biologicalAge ?? null;
  if (prevAge !== currAge) {
    changes.biologicalAge = { previous: prevAge, current: currAge };
  }

  // BMI
  const prevBmi = from?.bmi?.bmi ?? null;
  const currBmi = to.bmi?.bmi ?? null;
  if (prevBmi !== currBmi) {
    changes.bmi = { previous: prevBmi, current: currBmi };
  }

  // Recommendations (compare count and content, order-insensitive)
  const prevRecs = from?.recommendations ?? [];
  const currRecs = to.recommendations ?? [];
  if (prevRecs.length !== currRecs.length) {
    changes.recommendationCountDelta = currRecs.length - prevRecs.length;
  } else if (!isDeepStrictEqual(sortById(prevRecs), sortById(currRecs))) {
    changes.recommendationCountDelta = 0; // count unchanged but content differs
  }

  // Notes (compare count and content, order-insensitive)
  const prevNotes = from?.notes ?? [];
  const currNotes = to.notes ?? [];
  if (currNotes.length > prevNotes.length) {
    changes.newNotes = currNotes.length - prevNotes.length;
  } else if (!isDeepStrictEqual(sortById(prevNotes), sortById(currNotes))) {
    changes.newNotes = 0; // content changed in place
  }

  // Requisitions (compare count and content, order-insensitive)
  const prevReqs = from?.requisitions ?? [];
  const currReqs = to.requisitions ?? [];
  if (currReqs.length > prevReqs.length) {
    changes.newRequisitions = currReqs.length - prevReqs.length;
  } else if (!isDeepStrictEqual(sortById(prevReqs), sortById(currReqs))) {
    changes.newRequisitions = 0; // status/content changed
  }

  // Report (deep comparison)
  if (from && !isDeepStrictEqual(from.report, to.report)) {
    changes.reportChanged = true;
  }

  return changes;
}

/** Build human-readable summary lines from diff results and meta changes.
 *  Returns empty array if nothing changed (no file should be written). */
export function buildChangeSummary(
  diff: DiffResult | null,
  meta: MetaChanges,
  context?: { totalResults: number; roundCount: number; previousRoundCount?: number },
): string[] {
  const lines: string[] = [];

  // First sync — no diff available
  if (!diff && context) {
    lines.push(`Initial sync: ${context.totalResults} results across ${context.roundCount} round(s)`);
    return lines;
  }

  // Result changes from diffExports
  if (diff) {
    if (diff.summary.newCount > 0) {
      lines.push(`${diff.summary.newCount} new result(s)`);
    }
    if (diff.summary.improvedCount > 0) {
      const names = diff.improved.map(c => c.biomarkerName).join(", ");
      lines.push(`${diff.summary.improvedCount} improved: ${names}`);
    }
    if (diff.summary.worsenedCount > 0) {
      const names = diff.worsened.map(c => c.biomarkerName).join(", ");
      lines.push(`${diff.summary.worsenedCount} worsened: ${names}`);
    }
    if (diff.summary.significantChangeCount > 0) {
      lines.push(`${diff.summary.significantChangeCount} significantly changed`);
    }
    if (diff.summary.disappearedCount > 0) {
      lines.push(`${diff.summary.disappearedCount} disappeared`);
    }
  }

  // Meta changes
  if (meta.biologicalAge) {
    const prev = meta.biologicalAge.previous;
    const curr = meta.biologicalAge.current;
    lines.push(`Biological age: ${prev ?? "N/A"} → ${curr ?? "N/A"}`);
  }
  if (meta.bmi) {
    const prev = meta.bmi.previous;
    const curr = meta.bmi.current;
    lines.push(`BMI: ${prev ?? "N/A"} → ${curr ?? "N/A"}`);
  }
  if (meta.recommendationCountDelta !== undefined) {
    if (meta.recommendationCountDelta === 0) {
      lines.push("Recommendations updated");
    } else {
      const sign = meta.recommendationCountDelta > 0 ? "+" : "";
      lines.push(`Recommendations: ${sign}${meta.recommendationCountDelta}`);
    }
  }
  if (meta.newNotes !== undefined) {
    if (meta.newNotes === 0) {
      lines.push("Notes updated");
    } else {
      lines.push(`${meta.newNotes} new note(s)`);
    }
  }
  if (meta.newRequisitions !== undefined) {
    if (meta.newRequisitions === 0) {
      lines.push("Requisitions updated");
    } else {
      lines.push(`${meta.newRequisitions} new requisition(s)`);
    }
  }
  if (meta.reportChanged) {
    lines.push("Clinician report updated");
  }

  // Detect new rounds even when all biomarker values are stable.
  // A new round with repeat markers may show no diff changes (all "unchanged"),
  // but the user should still be notified that new measurements arrived.
  if (context?.previousRoundCount !== undefined && context.roundCount > context.previousRoundCount) {
    const newRounds = context.roundCount - context.previousRoundCount;
    if (!lines.some(l => l.includes("new result") || l.includes("new round"))) {
      lines.push(`${newRounds} new round(s) added`);
    }
  }

  return lines;
}

/** Detect changes between previous aggregate and fresh API data, save notification if any.
 *  Returns the summary lines (empty if nothing changed).
 *  Note: "disappeared" markers are suppressed because the API's /results-report returns
 *  only current results — comparing against the aggregate of all historical rounds would
 *  produce false disappearances for markers not in the latest panel. Use fh_changes for
 *  accurate round-to-round disappearance tracking. */
export async function detectAndSaveChanges(
  previousData: ExportData | null,
  currentData: ExportData,
  savedDates: string[],
  previousRoundCount?: number,
): Promise<string[]> {
  const previousLabel = previousData ? deriveExportDate(previousData) : undefined;
  const currentLabel = savedDates.length > 0 ? savedDates[savedDates.length - 1] : undefined;
  let resultDiff = previousData ? diffExports(previousData, currentData, previousLabel, currentLabel) : null;

  // Suppress disappeared markers in sync notifications.
  // The API's /results-report returns ALL results it currently knows about, but
  // different test rounds use different panels. The aggregate previousData includes
  // markers from every historical round, so any marker not in the current API response
  // (e.g. a panel-specific marker from an older round) would appear as "disappeared"
  // even though it was never retested. For accurate round-to-round disappearance
  // tracking, use fh_changes which compares specific rounds directly.
  if (resultDiff && resultDiff.disappeared.length > 0) {
    resultDiff = {
      ...resultDiff,
      disappeared: [],
      summary: { ...resultDiff.summary, disappearedCount: 0 },
    };
  }

  const metaChanges = diffMeta(previousData, currentData);
  const context = {
    totalResults: currentData.results.length,
    roundCount: savedDates.length,
    previousRoundCount,
  };
  const summary = buildChangeSummary(resultDiff, metaChanges, context);

  if (summary.length > 0) {
    // Strip unchanged array from persisted diff to reduce file size
    const strippedDiff = resultDiff ? {
      ...resultDiff,
      unchanged: [],
      summary: { ...resultDiff.summary, unchangedCount: 0 },
    } : null;
    const notification: ChangeNotification = {
      timestamp: new Date().toISOString(),
      syncedRounds: savedDates,
      totalResults: currentData.results.length,
      resultDiff: strippedDiff,
      metaChanges,
      summary,
    };
    try {
      await saveChangeNotification(notification);
    } catch {
      // Non-critical — sync data is already saved, don't fail the sync
    }
  }

  return summary;
}

function sortById<T extends { id: string }>(arr: T[]): T[] {
  return [...arr].sort((a, b) => a.id.localeCompare(b.id));
}

function buildResultMap(data: ExportData): Map<string, ResultEntry> {
  const map = new Map<string, ResultEntry>();

  const idToName = new Map<string, string>();
  for (const bm of data.biomarkers) {
    idToName.set(bm.id, bm.name);
  }

  // Sort by dateOfService ascending so the latest result wins when duplicates exist
  const sorted = [...data.results].sort((a, b) => -byDateDesc(a, b));

  for (const result of sorted) {
    const name = getResultName(result, idToName);
    if (name) {
      map.set(name, {
        value: getResultValue(result),
        inRange: result.inRange,
      });
    }
  }

  return map;
}
