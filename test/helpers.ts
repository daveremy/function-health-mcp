import type { ExportData, HealthResult, BiomarkerDetail, RoundMeta } from "../src/types.js";

/** Convert groupByRound array output to a Map for easier test assertions.
 *  Throws if duplicate keys exist (use roundsToArray for collision tests). */
export function roundsToMap(rounds: Array<[string, ExportData]>): Map<string, ExportData> {
  const map = new Map<string, ExportData>();
  for (const [key, data] of rounds) {
    if (map.has(key)) throw new Error(`Duplicate round key: ${key}`);
    map.set(key, data);
  }
  return map;
}

/** Create a minimal HealthResult for testing */
export function makeResult(overrides: Partial<HealthResult> = {}): HealthResult {
  return {
    id: "r1",
    biomarkerName: "Vitamin D",
    dateOfService: "2026-01-20",
    calculatedResult: "30",
    displayResult: "30",
    inRange: true,
    requisitionId: "req1",
    ...overrides,
  };
}

/** Create a minimal BiomarkerDetail for testing */
export function makeDetail(name: string): BiomarkerDetail {
  return {
    id: `detail-${name}`,
    name,
    oneLineDescription: "",
    whyItMatters: "",
    recommendations: "",
    causesDescription: "",
    symptomsDescription: "",
    foodsToEatDescription: "",
    foodsToAvoidDescription: "",
    supplementsDescription: "",
    selfCareDescription: "",
    additionalTestsDescription: "",
    followUpDescription: "",
    resourcesCited: "",
    sexFilter: "",
    fullData: null,
  };
}

/** Create a minimal RoundMeta for testing */
export function makeRoundMeta(overrides: Partial<RoundMeta> = {}): RoundMeta {
  return {
    requisitionId: "req1",
    visitDates: ["2026-01-20"],
    resultCount: 1,
    lastUpdated: "2026-01-20T00:00:00Z",
    ...overrides,
  };
}

/** Create a minimal ExportData for testing */
export function makeExport(overrides: Partial<ExportData> = {}): ExportData {
  return {
    profile: null,
    results: [],
    biomarkers: [],
    categories: [],
    biomarkerDetails: [],
    recommendations: [],
    report: null,
    biologicalAge: null,
    bmi: null,
    notes: [],
    requisitions: [],
    pendingSchedules: [],
    ...overrides,
  };
}
