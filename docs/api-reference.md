# Function Health API Reference

This documents the reverse-engineered Function Health API used by this project. Function Health does not publish an official API — these endpoints were discovered by inspecting the [my.functionhealth.com](https://my.functionhealth.com/) web app.

> **Credit:** The original reverse-engineering was done by [Inigo Beitia Arevalo](https://github.com/bogini/function-health-exporter).

## Base URL

```
https://production-member-app-mid-lhuqotpy2a-ue.a.run.app/api/v1
```

The backend runs on Google Cloud Run.

## Authentication

Function Health uses **Firebase Authentication** (Google Identity Platform).

### Login

```
POST /login
Content-Type: application/json

{ "email": "user@example.com", "password": "..." }
```

Returns:
```json
{
  "idToken": "eyJhbGciOi...",
  "refreshToken": "AMf-vBx...",
  "expiresIn": "3600",
  "localId": "abc123",
  "email": "user@example.com"
}
```

- `idToken` is a Firebase JWT (typically valid for 1 hour)
- `refreshToken` is a long-lived token for obtaining new id tokens
- `expiresIn` is in seconds (string, not number)

### Token Refresh

```
POST https://securetoken.googleapis.com/v1/token?key=AIzaSyDnxHI-7Xh7JtQrYzRv8n8wJNl3jH5jKl0
Content-Type: application/json

{ "grant_type": "refresh_token", "refresh_token": "AMf-vBx..." }
```

Returns:
```json
{
  "access_token": "eyJhbGciOi...",
  "expires_in": "3600",
  "refresh_token": "AMf-vBx..."
}
```

Note: `access_token` (not `id_token`) is the field name in the refresh response. The `refresh_token` may be rotated.

### Request Headers

All API requests require:
```
Authorization: Bearer <idToken>
Content-Type: application/json
Accept: application/json, text/plain, */*
User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ...
fe-app-version: 0.84.0
x-backend-skip-cache: true
referer: https://my.functionhealth.com/
```

The `fe-app-version` header is checked by the backend. If omitted or too old, some endpoints may return errors. Update this value by inspecting the live web app's network requests.

## Endpoints

### GET /user

Returns the authenticated user's profile.

```json
{
  "id": "uuid",
  "patientIdentifier": "P001",
  "fname": "John",
  "lname": "Doe",
  "preferredName": "",
  "biologicalSex": "Male",
  "dob": "1990-01-15",
  "pronouns": "",
  "canScheduleInBetaStates": false,
  "patientContactInfo": {
    "email": "john@example.com",
    "phoneNumber": "555-1234",
    "streetAddress": "123 Main St",
    "city": "San Francisco",
    "state": "CA",
    "zip": "94102"
  },
  "dateJoined": "2025-06-01",
  "intake_status": true,
  "patientMembership": "annual"
}
```

### GET /biomarkers

Returns the full list of biomarker definitions (not results — just metadata).

```json
[
  {
    "id": "uuid",
    "name": "Vitamin D, 25-OH",
    "questBiomarkerCode": "17306",
    "categories": [
      { "id": "uuid", "categoryName": "Bone Health" }
    ],
    "sexDetails": [
      {
        "id": "uuid",
        "sex": "All",
        "oneLineDescription": "Measures vitamin D levels...",
        "optimalRangeHigh": "80",
        "optimalRangeLow": "40",
        "questRefRangeHigh": "100",
        "questRefRangeLow": "30"
      }
    ],
    "status": null
  }
]
```

- `sexDetails` contains optimal and reference ranges, potentially different for Male/Female/All
- `categories` can contain multiple entries (a biomarker can belong to multiple categories)
- `questBiomarkerCode` references the Quest Diagnostics lab code

### GET /categories

Returns biomarker categories with their associated biomarkers (full biomarker objects nested).

```json
[
  {
    "id": "uuid",
    "categoryName": "Heart",
    "description": "Cardiovascular health markers",
    "biomarkers": [ /* full Biomarker objects */ ]
  }
]
```

### GET /results

**Important:** This endpoint returns PDF requisition data, NOT the structured lab results you'd expect. Do NOT use this for extracting biomarker values.

### GET /results-report

**This is the primary source of lab result data.** Returns a structured report with all biomarker results.

```json
{
  "data": {
    "biomarkerResultsRecord": [
      {
        "biomarker": {
          "id": "uuid",
          "name": "Vitamin D, 25-OH",
          "whyItMatters": "Vitamin D is essential for...",
          "sexDetails": [
            {
              "oneLineDescription": "Measures vitamin D levels...",
              "optimalRangeHigh": "80",
              "optimalRangeLow": "40"
            }
          ]
        },
        "currentResult": {
          "id": "uuid",
          "dateOfService": "2026-01-20",
          "calculatedResult": "45.2",
          "displayResult": "45.2",
          "inRange": true,
          "requisitionId": "req-uuid"
        },
        "outOfRangeType": "",
        "units": "ng/mL",
        "optimalRange": "40-80",
        "rangeString": "30-100"
      }
    ]
  }
}
```

Key fields in `currentResult`:
- `id` — unique result identifier
- `dateOfService` — the actual lab visit date (YYYY-MM-DD, sometimes with time suffix)
- `calculatedResult` — raw numeric/string value from the lab
- `displayResult` — formatted display value (usually same as calculated, but may differ for qualitative results like "Positive"/"Negative")
- `inRange` — boolean, whether the result is within Function Health's optimal range
- `requisitionId` — groups results from the same test round (all visits for one annual/mid-year test share this ID)

Key fields in the wrapper record:
- `outOfRangeType` — e.g., "HIGH", "LOW", or empty
- `units` — e.g., "ng/mL", "mg/dL"
- `optimalRange` — display string like "40-80"
- `rangeString` — reference range string like "30-100"

### GET /recommendations

Returns personalized health recommendations.

```json
[
  {
    "id": "uuid",
    "category": "Nutrition",
    "title": "Increase Vitamin D intake",
    "description": "Consider supplementing with..."
  }
]
```

Returns 404 for accounts with no recommendations (handled gracefully).

### GET /biological-calculations/biological-age

Returns biological age calculation.

```json
{
  "biologicalAge": 32,
  "chronologicalAge": 35
}
```

Returns 404 if not enough data for calculation.

### GET /biological-calculations/bmi

Returns BMI data.

```json
{
  "bmi": 23.5,
  "weight": 170,
  "height": 72
}
```

Returns 404 if not available.

### GET /notes

Returns clinician notes.

```json
[
  {
    "id": "uuid",
    "content": "Your vitamin D levels have improved...",
    "createdAt": "2026-02-01T10:00:00Z"
  }
]
```

### GET /requisitions?pending=true

Returns pending (in-progress) requisitions.

```json
[
  {
    "id": "req-uuid",
    "status": "pending",
    "dateOfService": "2026-03-01"
  }
]
```

### GET /requisitions?pending=false

Returns completed requisitions. Used for lightweight new-results detection (compare count against stored count without fetching all data).

### GET /pending-schedules

Returns upcoming scheduled lab visits.

```json
[
  {
    "id": "uuid",
    "scheduledDate": "2026-04-15"
  }
]
```

## Data Model

### Test Rounds and Requisitions

Function Health's testing model:
- **Annual Test**: ~100+ biomarkers, requires 1-3 lab visits over 2-4 weeks
- **Mid-Year Test**: ~60+ biomarkers, also 1-3 visits

All lab visits for one test share a single `requisitionId`. Results arrive in batches as each visit's bloodwork is processed (typically over ~2 weeks).

Example timeline for one Annual Test:
```
requisitionId: "req-abc123"
  Visit 1 (Jan 20): 68 results — CBC, metabolic panel, lipids, etc.
  Visit 2 (Jan 29): 45 results — hormones, vitamins, specialty markers
  Total: 113 results across 2 visits
```

### Result Values

- Most results are numeric strings: `"45.2"`, `"130"`, `"0.8"`
- Some are qualitative: `"Positive"`, `"Negative"`, `"CLEAR"`, `"ABNORMAL"`
- Some use inequality notation: `"<0.2"`, `">100"`
- `displayResult` and `calculatedResult` are usually identical but can differ

### Biomarker Ranges

Each biomarker has two range concepts:
- **Optimal range** (`optimalRangeLow`/`optimalRangeHigh`): Function Health's recommended range (often tighter than lab reference)
- **Reference range** (`questRefRangeLow`/`questRefRangeHigh`): Standard Quest Diagnostics lab reference range

The `inRange` boolean on results refers to Function Health's optimal range, not the lab reference range.

## Rate Limiting

The API does not return explicit rate limit headers, but aggressive parallel requests can trigger errors. This project serializes requests with 250ms spacing and uses exponential backoff on 5xx errors (3 attempts).

## Error Handling

- **401 Unauthorized**: Token expired. Refresh and retry once.
- **404 Not Found**: Resource doesn't exist. Expected for optional endpoints (recommendations, biological age, notes) on new accounts.
- **5xx Server Error**: Transient. Retry with exponential backoff.

## Versioning and Stability

This is a **reverse-engineered, undocumented API**. It can change at any time without notice. Known risks:
- The `fe-app-version` header value may need updating when Function Health deploys new frontend versions
- Endpoint paths or response shapes could change
- Authentication flow could be migrated away from Firebase

The `/results-report` endpoint and `biomarkerResultsRecord` structure have been stable since at least early 2026.
