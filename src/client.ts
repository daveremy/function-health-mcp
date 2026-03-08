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

  private async ensureFreshToken(): Promise<void> {
    if (isTokenExpired(this.tokens)) {
      if (!this.refreshPromise) {
        this.refreshPromise = (async () => {
          this.tokens = await refreshToken(this.tokens);
        })().finally(() => {
          this.refreshPromise = null;
        });
      }
      await this.refreshPromise;
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
      this.tokens = await refreshToken(this.tokens);
      const retry = await fetch(url, {
        headers: { ...DEFAULT_HEADERS, Authorization: `Bearer ${this.tokens.idToken}` },
      });
      if (!retry.ok) {
        throw new ApiError(`API request failed after auth retry: ${retry.status} ${retry.statusText}`, retry.status, endpoint);
      }
      return retry.json() as Promise<T>;
    }

    if (!res.ok) {
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

  /** Fetch detailed info for all biomarkers (sex-specific) */
  async getBiomarkerDetails(biomarkers: Biomarker[], userSex?: string): Promise<BiomarkerDetail[]> {
    const sexFilter = resolveSexFilter(userSex);

    const details: BiomarkerDetail[] = [];

    for (const bm of biomarkers) {
      const match = bm.sexDetails.find(sd => sd.sex === sexFilter)
        ?? bm.sexDetails.find(sd => sd.sex === "All");

      if (!match) {
        details.push(makeBiomarkerDetail(bm, sexFilter, null));
        continue;
      }

      const data = await this.getBiomarkerData(match.id);
      details.push(makeBiomarkerDetail(bm, sexFilter, data));
    }

    return details;
  }

  /** Full data export — enqueues all endpoints concurrently (rate-limited), then biomarker details sequentially */
  async exportAll(): Promise<ExportData> {
    const [profile, results, biomarkers, categories, recommendations, report, biologicalAge, bmi, notes, requisitions, pendingSchedules] = await Promise.all([
      this.getProfile(),
      this.getResults(),
      this.getBiomarkers(),
      this.getCategories(),
      this.getRecommendations(),
      this.getResultsReport(),
      this.getBiologicalAge(),
      this.getBMI(),
      this.getNotes(),
      this.getCompletedRequisitions(),
      this.getPendingSchedules(),
    ]);

    // Fail fast if critical data is missing (likely API failure, not empty account)
    if (results.length === 0 && biomarkers.length === 0) {
      throw new Error("Export failed: API returned no results and no biomarkers. Possible authentication or server issue.");
    }

    const userSex = profile?.biologicalSex;
    const biomarkerDetails = await this.getBiomarkerDetails(biomarkers, userSex);

    return {
      profile, results, biomarkers, categories, biomarkerDetails,
      recommendations, report, biologicalAge, bmi, notes, requisitions, pendingSchedules,
    };
  }
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
