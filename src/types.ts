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

// Lab results
export interface HealthResult {
  id: string;
  dateOfService: string;
  calculatedResult: string;
  displayResult: string;
  inRange: boolean;
  requisitionId: string;
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

// Complete export data
export interface ExportData {
  profile: UserProfile | null;
  results: HealthResult[];
  biomarkers: Biomarker[];
  categories: Category[];
  biomarkerDetails: BiomarkerDetail[];
  recommendations: Record<string, unknown>[];
  report: Record<string, unknown> | null;
  biologicalAge: Record<string, unknown> | null;
  bmi: Record<string, unknown> | null;
  notes: Record<string, unknown>[];
  requisitions: Record<string, unknown>[];
  pendingSchedules: Record<string, unknown>[];
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
