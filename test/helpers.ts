import type { ExportData, HealthResult, BiomarkerDetail } from "../src/types.js";

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
