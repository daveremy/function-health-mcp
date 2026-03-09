import type {
  AuthTokens,
  Biomarker,
  BiomarkerDetail,
  BiologicalAge,
  BMI,
  Category,
  ExportData,
  HealthResult,
  Note,
  Recommendation,
  Requisition,
  Schedule,
  UserProfile,
} from "./types.js";
import { ApiError } from "./types.js";
import { getValidTokens, refreshToken, isTokenExpired } from "./auth.js";
import { BASE_URL, DEFAULT_HEADERS, delay, resolveSexFilter } from "./utils.js";

const RATE_LIMIT_MS = 250;

const BIOMARKER_DETAIL_STRING_FIELDS = [
  "oneLineDescription", "whyItMatters", "recommendations", "causesDescription",
  "symptomsDescription", "foodsToEatDescription", "foodsToAvoidDescription",
  "supplementsDescription", "selfCareDescription", "additionalTestsDescription",
  "followUpDescription", "resourcesCited",
] as const;

export class FunctionHealthClient {
  private tokens: AuthTokens;
  private refreshPromise: Promise<void> | null = null;
  private requestQueue: Promise<void> = Promise.resolve();

  constructor(tokens: AuthTokens) {
    this.tokens = tokens;
  }

  static async create(): Promise<FunctionHealthClient> {
    const tokens = await getValidTokens();
    return new FunctionHealthClient(tokens);
  }

  /** Refresh tokens with deduplication — concurrent callers share the same refresh */
  private async doRefresh(): Promise<void> {
    if (!this.refreshPromise) {
      this.refreshPromise = (async () => {
        this.tokens = await refreshToken(this.tokens);
      })().finally(() => {
        this.refreshPromise = null;
      });
    }
    await this.refreshPromise;
  }

  private async ensureFreshToken(): Promise<void> {
    if (isTokenExpired(this.tokens)) {
      await this.doRefresh();
    }
  }

  /** Serialize requests through a queue to enforce rate limiting */
  private async request<T>(endpoint: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.requestQueue = this.requestQueue.then(async () => {
        try {
          resolve(await this.doRequest<T>(endpoint));
        } catch (err) {
          reject(err);
        }
        await delay(RATE_LIMIT_MS);
      });
    });
  }

  /** Request that returns null on 404 (resource legitimately missing) but throws on other errors */
  private async requestNullable<T>(endpoint: string): Promise<T | null> {
    try {
      return await this.request<T>(endpoint);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  }

  private async doRequest<T>(endpoint: string): Promise<T> {
    await this.ensureFreshToken();

    const url = `${BASE_URL}${endpoint}`;
    const headers = { ...DEFAULT_HEADERS, Authorization: `Bearer ${this.tokens.idToken}` };

    const res = await fetch(url, { headers });

    if (res.status === 401) {
      await res.body?.cancel();
      await this.doRefresh();
      const retry = await fetch(url, {
        headers: { ...DEFAULT_HEADERS, Authorization: `Bearer ${this.tokens.idToken}` },
      });
      if (!retry.ok) {
        await retry.body?.cancel();
        throw new ApiError(`API request failed after auth retry: ${retry.status} ${retry.statusText}`, retry.status, endpoint);
      }
      return retry.json() as Promise<T>;
    }

    if (!res.ok) {
      await res.body?.cancel();
      throw new ApiError(`API request failed: ${res.status} ${res.statusText}`, res.status, endpoint);
    }
    return res.json() as Promise<T>;
  }

  private async requestArray<T>(endpoint: string): Promise<T[]> {
    try {
      const data = await this.request<T[]>(endpoint);
      return Array.isArray(data) ? data : [];
    } catch (err) {
      // 404 is expected for optional collection endpoints on new accounts
      if (err instanceof ApiError && err.status === 404) return [];
      throw err;
    }
  }

  // Core data endpoints
  async getProfile(): Promise<UserProfile | null> {
    return this.requestNullable<UserProfile>("/user");
  }

  async getResults(): Promise<HealthResult[]> {
    return this.requestArray<HealthResult>("/results");
  }

  async getBiomarkers(): Promise<Biomarker[]> {
    return this.requestArray<Biomarker>("/biomarkers");
  }

  async getCategories(): Promise<Category[]> {
    return this.requestArray<Category>("/categories");
  }

  async getBiomarkerData(sexDetailsId: string): Promise<Record<string, unknown> | null> {
    return this.requestNullable<Record<string, unknown>>(`/biomarker-data/${sexDetailsId}`);
  }

  async getRecommendations(): Promise<Recommendation[]> {
    return this.requestArray<Recommendation>("/recommendations");
  }

  async getResultsReport(): Promise<Record<string, unknown> | null> {
    return this.requestNullable<Record<string, unknown>>("/results-report");
  }

  async getBiologicalAge(): Promise<BiologicalAge | null> {
    return this.requestNullable<BiologicalAge>("/biological-calculations/biological-age");
  }

  async getBMI(): Promise<BMI | null> {
    return this.requestNullable<BMI>("/biological-calculations/bmi");
  }

  async getNotes(): Promise<Note[]> {
    return this.requestArray<Note>("/notes");
  }

  async getPendingRequisitions(): Promise<Requisition[]> {
    return this.requestArray<Requisition>("/requisitions?pending=true");
  }

  async getCompletedRequisitions(): Promise<Requisition[]> {
    return this.requestArray<Requisition>("/requisitions?pending=false");
  }

  async getPendingSchedules(): Promise<Schedule[]> {
    return this.requestArray<Schedule>("/pending-schedules");
  }

  /** Fetch detailed info for all biomarkers (sex-specific).
   *  Requests are enqueued in parallel — the rate-limited queue serializes them. */
  async getBiomarkerDetails(biomarkers: Biomarker[], userSex?: string): Promise<BiomarkerDetail[]> {
    const sexFilter = resolveSexFilter(userSex);

    const promises = biomarkers.map(async (bm) => {
      const match = bm.sexDetails.find(sd => sd.sex === sexFilter)
        ?? bm.sexDetails.find(sd => sd.sex === "All");

      if (!match) return makeBiomarkerDetail(bm, sexFilter, null);

      // Gracefully degrade on per-biomarker failures so one transient error
      // doesn't abort the entire export
      let data: Record<string, unknown> | null = null;
      try {
        data = await this.getBiomarkerData(match.id);
      } catch {
        // Fall through with null — makeBiomarkerDetail handles missing data
      }
      return makeBiomarkerDetail(bm, sexFilter, data);
    });

    return Promise.all(promises);
  }

  /** Full data export — fetches all data in parallel, extracts results from report */
  async exportAll(): Promise<ExportData> {
    // Optional fetch wrapper — degrade to defaults on transient errors
    const optionalFetch = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
      try { return await fn(); } catch { return fallback; }
    };

    // Fetch everything in parallel — report is the primary source of result data
    const [profile, biomarkers, categories, recommendations, report, biologicalAge, bmi, notes, requisitions, pendingSchedules] = await Promise.all([
      this.getProfile(),
      this.getBiomarkers(),
      this.getCategories(),
      optionalFetch(() => this.getRecommendations(), []),
      this.getResultsReport(),
      optionalFetch(() => this.getBiologicalAge(), null),
      optionalFetch(() => this.getBMI(), null),
      optionalFetch(() => this.getNotes(), []),
      optionalFetch(() => this.getCompletedRequisitions(), []),
      optionalFetch(() => this.getPendingSchedules(), []),
    ]);

    if (!report && !profile && biomarkers.length === 0 && categories.length === 0) {
      throw new Error("Export failed: API returned no data. Possible authentication or server issue.");
    }

    // Extract results and biomarker details from the report's biomarkerResultsRecord
    const { results, biomarkerDetails } = extractResultsFromReport(report);

    return {
      profile, results, biomarkers, categories, biomarkerDetails,
      recommendations, report, biologicalAge, bmi, notes, requisitions, pendingSchedules,
    };
  }
}

/** Extract HealthResult[] and BiomarkerDetail[] from the report's biomarkerResultsRecord.
 *  This is the primary source of actual lab values — the /results endpoint returns requisition PDFs. */
function extractResultsFromReport(report: Record<string, unknown> | null): { results: HealthResult[]; biomarkerDetails: BiomarkerDetail[] } {
  const results: HealthResult[] = [];
  const biomarkerDetails: BiomarkerDetail[] = [];

  if (!report) return { results, biomarkerDetails };

  const data = report.data as Record<string, unknown> | undefined;
  if (!data) return { results, biomarkerDetails };

  const records = data.biomarkerResultsRecord as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(records)) return { results, biomarkerDetails };

  for (const record of records) {
    const biomarker = record.biomarker as Record<string, unknown> | undefined;
    const currentResult = record.currentResult as Record<string, unknown> | undefined;
    const biomarkerName = biomarker?.name as string || "";

    // Extract the current result as a HealthResult
    if (currentResult) {
      results.push({
        id: String(currentResult.id || ""),
        biomarkerName,
        dateOfService: String(currentResult.dateOfService || ""),
        calculatedResult: String(currentResult.calculatedResult || ""),
        displayResult: String(currentResult.displayResult || ""),
        inRange: currentResult.inRange === true,
        requisitionId: String(currentResult.requisitionId || ""),
        outOfRangeType: String(record.outOfRangeType || ""),
        units: String(record.units || ""),
        optimalRange: String(record.optimalRange || ""),
        rangeString: String(record.rangeString || ""),
      });
    }

    // Extract biomarker detail from the inline biomarker data
    if (biomarker) {
      const detail: BiomarkerDetail = {
        id: String(biomarker.id || ""),
        name: biomarkerName,
        oneLineDescription: "",
        whyItMatters: String(biomarker.whyItMatters || ""),
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
      const sexDetails = biomarker.sexDetails as Array<Record<string, unknown>> | undefined;
      if (sexDetails && sexDetails[0]) {
        detail.oneLineDescription = String(sexDetails[0].oneLineDescription || "");
      }
      biomarkerDetails.push(detail);
    }
  }

  return { results, biomarkerDetails };
}

function makeBiomarkerDetail(bm: Biomarker, sexFilter: string, data: Record<string, unknown> | null): BiomarkerDetail {
  const detail: BiomarkerDetail = {
    id: bm.id,
    name: bm.name,
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
    sexFilter: sexFilter.toLowerCase(),
    fullData: data,
  };

  if (data) {
    detail.name = String(data.name || bm.name);
    for (const field of BIOMARKER_DETAIL_STRING_FIELDS) {
      detail[field] = String(data[field] || "");
    }
  }

  return detail;
}
