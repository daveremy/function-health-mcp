// Authentication
export interface AuthTokens {
  idToken: string;
  refreshToken: string;
  expiresIn: number;
  localId: string;
  email: string;
  loginTime: number;
}

export interface SavedCredentials {
  email?: string;
  idToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  localId?: string;
  loginTime?: number;
}

// User profile
export interface UserProfile {
  id: string;
  patientIdentifier: string;
  fname: string;
  lname: string;
  preferredName: string;
  biologicalSex: string;
  dob: string;
  pronouns: string;
  canScheduleInBetaStates: boolean;
  patientContactInfo: {
    email: string;
    phoneNumber: string;
    streetAddress: string;
    city: string;
    state: string;
    zip: string;
  };
  dateJoined: string;
  intake_status: boolean;
  patientMembership: string;
}

// Lab results (extracted from report's biomarkerResultsRecord)
export interface HealthResult {
  id: string;
  biomarkerName: string;
  dateOfService: string;
  calculatedResult: string;
  displayResult: string;
  inRange: boolean;
  requisitionId: string;
  outOfRangeType?: string;
  units?: string;
  optimalRange?: string;
  rangeString?: string;
  [key: string]: unknown;
}

// Biomarker definitions
export interface SexDetails {
  id: string;
  sex: string;
  oneLineDescription: string;
  optimalRangeHigh: string;
  optimalRangeLow: string;
  questRefRangeHigh: string;
  questRefRangeLow: string;
}

export interface Biomarker {
  id: string;
  name: string;
  questBiomarkerCode: string;
  categories: Array<{ id: string; categoryName: string }>;
  sexDetails: SexDetails[];
  status: string | null;
}

// Categories
export interface Category {
  id: string;
  categoryName: string;
  description: string;
  biomarkers: Biomarker[];
}

// Detailed biomarker info (from /biomarker-data/{sexDetailsId})
export interface BiomarkerDetail {
  id: string;
  name: string;
  oneLineDescription: string;
  whyItMatters: string;
  recommendations: string;
  causesDescription: string;
  symptomsDescription: string;
  foodsToEatDescription: string;
  foodsToAvoidDescription: string;
  supplementsDescription: string;
  selfCareDescription: string;
  additionalTestsDescription: string;
  followUpDescription: string;
  resourcesCited: string;
  sexFilter: string;
  fullData: Record<string, unknown> | null;
}

// API response types (loosely structured from upstream API)
export interface Recommendation {
  id: string;
  category?: string;
  title?: string;
  description?: string;
  [key: string]: unknown;
}

export interface BiologicalAge {
  biologicalAge?: number;
  chronologicalAge?: number;
  [key: string]: unknown;
}

export interface BMI {
  bmi?: number;
  weight?: number;
  height?: number;
  [key: string]: unknown;
}

export interface Requisition {
  id: string;
  status?: string;
  dateOfService?: string;
  [key: string]: unknown;
}

export interface Note {
  id: string;
  content?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export interface Schedule {
  id: string;
  scheduledDate?: string;
  [key: string]: unknown;
}

// Complete export data
export interface ExportData {
  profile: UserProfile | null;
  results: HealthResult[];
  biomarkers: Biomarker[];
  categories: Category[];
  biomarkerDetails: BiomarkerDetail[];
  recommendations: Recommendation[];
  report: Record<string, unknown> | null;
  biologicalAge: BiologicalAge | null;
  bmi: BMI | null;
  notes: Note[];
  requisitions: Requisition[];
  pendingSchedules: Schedule[];
}

// API error types
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly endpoint: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// Sync metadata
export interface SyncLog {
  lastSync: string;
  exports: Array<{
    date: string;
    resultCount: number;
    timestamp: string;
  }>;
}

// Diff types
export interface BiomarkerChange {
  biomarkerName: string;
  category: string;
  previousValue: string | null;
  currentValue: string;
  previousInRange: boolean | null;
  currentInRange: boolean;
  changeType: "improved" | "worsened" | "new" | "unchanged" | "changed";
  percentChange: number | null;
}

export interface DiffResult {
  fromDate: string;
  toDate: string;
  newBiomarkers: BiomarkerChange[];
  improved: BiomarkerChange[];
  worsened: BiomarkerChange[];
  significantlyChanged: BiomarkerChange[];
  unchanged: BiomarkerChange[];
  summary: {
    totalCompared: number;
    newCount: number;
    improvedCount: number;
    worsenedCount: number;
    significantChangeCount: number;
    unchangedCount: number;
  };
}
