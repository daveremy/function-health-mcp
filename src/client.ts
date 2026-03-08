import type {
  AuthTokens,
  Biomarker,
  BiomarkerDetail,
  Category,
  ExportData,
  HealthResult,
  UserProfile,
} from "./types.js";
import { getValidTokens, refreshToken, isTokenExpired } from "./auth.js";
import { BASE_URL, DEFAULT_HEADERS, delay } from "./utils.js";

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
  private lastRequestTime = 0;

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

  /** Rate-limited request with automatic token refresh on 401 */
  private async request<T>(endpoint: string): Promise<T | null> {
    await this.ensureFreshToken();

    // Sequential rate limiting: wait until RATE_LIMIT_MS since last request
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < RATE_LIMIT_MS) {
      await delay(RATE_LIMIT_MS - elapsed);
    }
    this.lastRequestTime = Date.now();

    const url = `${BASE_URL}${endpoint}`;
    const headers = { ...DEFAULT_HEADERS, Authorization: `Bearer ${this.tokens.idToken}` };

    const res = await fetch(url, { headers });

    if (res.status === 401) {
      this.tokens = await refreshToken(this.tokens);
      const retry = await fetch(url, {
        headers: { ...DEFAULT_HEADERS, Authorization: `Bearer ${this.tokens.idToken}` },
      });
      if (!retry.ok) return null;
      return retry.json() as Promise<T>;
    }

    if (!res.ok) return null;
    return res.json() as Promise<T>;
  }

  private async requestArray<T>(endpoint: string): Promise<T[]> {
    const data = await this.request<T[]>(endpoint);
    return Array.isArray(data) ? data : [];
  }

  // Core data endpoints
  async getProfile(): Promise<UserProfile | null> {
    return this.request<UserProfile>("/user");
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
    return this.request<Record<string, unknown>>(`/biomarker-data/${sexDetailsId}`);
  }

  async getRecommendations(): Promise<Record<string, unknown>[]> {
    return this.requestArray<Record<string, unknown>>("/recommendations");
  }

  async getResultsReport(): Promise<Record<string, unknown> | null> {
    return this.request<Record<string, unknown>>("/results-report");
  }

  async getBiologicalAge(): Promise<Record<string, unknown> | null> {
    return this.request<Record<string, unknown>>("/biological-calculations/biological-age");
  }

  async getBMI(): Promise<Record<string, unknown> | null> {
    return this.request<Record<string, unknown>>("/biological-calculations/bmi");
  }

  async getNotes(): Promise<Record<string, unknown>[]> {
    return this.requestArray<Record<string, unknown>>("/notes");
  }

  async getPendingRequisitions(): Promise<Record<string, unknown>[]> {
    return this.requestArray<Record<string, unknown>>("/requisitions?pending=true");
  }

  async getCompletedRequisitions(): Promise<Record<string, unknown>[]> {
    return this.requestArray<Record<string, unknown>>("/requisitions?pending=false");
  }

  async getPendingSchedules(): Promise<Record<string, unknown>[]> {
    return this.requestArray<Record<string, unknown>>("/pending-schedules");
  }

  /** Fetch detailed info for all biomarkers (sex-specific) */
  async getBiomarkerDetails(biomarkers: Biomarker[], userSex?: string): Promise<BiomarkerDetail[]> {
    const sexFilter = userSex?.toLowerCase() === "male" ? "Male"
      : userSex?.toLowerCase() === "female" ? "Female"
      : "All";

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

  /** Full data export — fetches independent endpoints in parallel, then biomarker details sequentially */
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
