# Function Health MCP Server — Development Prompt

## What This Is

An MCP (Model Context Protocol) server that wraps the Function Health API to provide lab result querying, change detection, and health monitoring directly to Claude Code and other MCP clients. Open source, MIT licensed.

## Why

Function Health provides 100+ biomarker lab tests. Results come in periodically (every few months). We need:
1. A way to **query** lab results by biomarker, category, date, or status (in-range / out-of-range)
2. A way to **detect new results** — run on a loop, notice when new lab results appear, and alert the user
3. A way to **track changes** between draws — what improved, what worsened, what's new
4. A way to **cross-reference** results with actions (supplements, lifestyle changes) for health coaching

## Prior Art

### function-health-exporter (~/code/function-health-exporter)
An existing CLI tool (TypeScript/Bun) that reverse-engineers the Function Health API. It:
- Authenticates via Firebase JWT (email/password → idToken + refreshToken)
- Exports all data to JSON files (profile, results, biomarkers, categories, recommendations, reports, biological age, BMI, notes, requisitions, individual biomarker details)
- Generates categorized Markdown reports (15+ categories: heart health, thyroid, metabolic, etc.)
- Has retry logic, rate limiting, token refresh

**Key API endpoints** (base: `https://api.functionhealth.com` or similar — check client source):
- `/login` — POST email/password → JWT tokens
- `/user` — GET profile
- `/results` — GET all lab results
- `/biomarkers` — GET biomarker definitions
- `/categories` — GET categories with biomarker mappings
- `/biomarker-data/{sexDetailsId}` — GET detailed biomarker info (sex-specific)
- `/results-report` — GET comprehensive report
- `/biological-calculations/biological-age` — GET bio age
- `/biological-calculations/bmi` — GET BMI
- `/requisitions?pending=true|false` — GET lab orders
- `/recommendations` — GET health recommendations
- `/notes` — GET user notes
- `/pending-schedules` — GET upcoming lab appointments

**Auth details**: Firebase-based. Token stored in `~/.function-health-cli/`. Tokens expire and need refresh via Google's `securetoken.googleapis.com/v1/token` endpoint.

### Oura MCP (~/code/oura-mcp) — Pattern Reference
The Oura MCP server is the architectural pattern to follow:
- TypeScript, `@modelcontextprotocol/sdk`, `zod` for schemas, `commander` for CLI
- Dual-mode: works as both an MCP server (`mcp.ts`) and a standalone CLI (`cli.ts`)
- Shared client (`client.ts`) used by both modes
- Types in `types.ts`, utilities in `utils.ts`
- Build with `tsc`, publish to npm
- MIT license, GitHub repo

### IronCompass MCP — Integration Target
IronCompass is the health data logging system. The Function Health MCP should be designed to work alongside it — e.g., when new results come in, we might want to log key metrics to IronCompass or cross-reference biomarker trends with daily health data.

## Architecture

```
function-health-mcp/
├── src/
│   ├── mcp.ts              # MCP server entry point
│   ├── cli.ts              # Standalone CLI entry point
│   ├── client.ts           # Function Health API client (adapted from exporter)
│   ├── auth.ts             # Firebase auth (login, token refresh, credential storage)
│   ├── types.ts            # TypeScript interfaces for all API responses
│   ├── diff.ts             # Change detection logic (compare two exports)
│   ├── store.ts            # Local data store (JSON files, versioned by export date)
│   └── utils.ts            # Helpers
├── package.json
├── tsconfig.json
├── README.md
├── LICENSE
└── CLAUDE.md               # Claude Code project instructions
```

## MCP Tools to Implement

### Core Query Tools

#### `function_health_results`
Query lab results with filtering.
- **Params**: `biomarker?` (name or partial match), `category?` (e.g., "heart", "thyroid"), `status?` ("in_range" | "out_of_range" | "all"), `visit?` ("latest" | "all" | visit number), `date?` (YYYY-MM-DD)
- **Returns**: Matching results with values, ranges, status, trend vs previous

#### `function_health_biomarker`
Deep dive on a specific biomarker.
- **Params**: `name` (biomarker name, fuzzy match OK)
- **Returns**: Current value, optimal range, history across all visits, trend direction, clinical context (why it matters, recommendations, foods, supplements)

#### `function_health_summary`
High-level health summary.
- **Params**: `visit?` ("latest" | visit number)
- **Returns**: Total markers tested, in-range count, out-of-range count, biological age, BMI, top concerns, top improvements

#### `function_health_categories`
List all biomarker categories with counts.
- **Returns**: Category name, description, number of biomarkers, number out of range

### Change Detection Tools

#### `function_health_changes`
Compare results between visits.
- **Params**: `from_visit?` (defaults to previous), `to_visit?` (defaults to latest)
- **Returns**: New biomarkers tested, improved (moved into range), worsened (moved out of range), significantly changed (>10% delta), unchanged

#### `function_health_sync`
Pull latest data from Function Health API.
- **Params**: `force?` (re-export even if recent data exists)
- **Returns**: Whether new data was found, count of new results, last sync timestamp
- **Behavior**:
  - Authenticate, fetch results, compare with stored data
  - If new results detected, store the new export with timestamp
  - Return a summary of what changed

#### `function_health_check`
Quick check for new results (lightweight — just checks requisition status).
- **Returns**: Pending requisitions, last completed requisition date, whether new results are available since last sync

### Reference Tools

#### `function_health_recommendations`
Get Function Health's recommendations.
- **Params**: `category?` (filter by category)
- **Returns**: Recommendations with associated biomarkers

#### `function_health_report`
Get the full clinician report for a visit.
- **Params**: `visit?` ("latest" | visit number)
- **Returns**: Clinician notes, interpretations

## CLI Commands

Mirror the MCP tools for standalone use:

```bash
# Query
function-health results --biomarker "Vitamin D" --status out_of_range
function-health biomarker "TSH"
function-health summary
function-health categories

# Sync & detect
function-health sync                    # Pull latest, report changes
function-health check                   # Quick check for new results
function-health changes                 # Compare latest vs previous visit
function-health changes --from 1 --to 2 # Compare specific visits

# Auth
function-health login                   # Interactive login
function-health login --email x --password y
function-health status                  # Show auth status, last sync, data stats

# Export (compatibility with existing exporter)
function-health export                  # Full JSON export
function-health export --markdown       # Generate Markdown reports
```

## Data Storage

Store exported data locally for offline querying and change detection:

```
~/.function-health/
├── config.json              # Auth credentials (encrypted or plaintext — match exporter pattern)
├── exports/
│   ├── 2026-02-26/          # One directory per lab visit / export date
│   │   ├── results.json
│   │   ├── biomarkers.json
│   │   ├── profile.json
│   │   └── ...
│   └── 2026-06-15/
│       └── ...
├── latest.json              # Symlink or copy of most recent complete export
└── sync-log.json            # Track sync timestamps and what changed
```

## Loop Integration

This MCP is designed to be polled via Claude Code's `/loop` command:

```
/loop 6h function_health_check
```

When new results are detected:
1. `function_health_check` returns `new_results_available: true`
2. Claude runs `function_health_sync` to pull and store the new data
3. Claude runs `function_health_changes` to summarize what changed
4. Claude presents the summary conversationally: "Your new Function Health results are in! 98 of 105 markers in range. 3 improved since last visit (Vitamin D, TSH, LDL). 2 need attention (ferritin dropped, ApoB slightly elevated). Want to dig in?"

## Development Workflow

### Phase 1: Foundation
1. Initialize project (TypeScript, `@modelcontextprotocol/sdk`, `zod`, `commander`)
2. Port auth from exporter (`auth.ts`) — login, token refresh, credential storage
3. Port API client from exporter (`client.ts`) — all endpoints, retry logic, rate limiting
4. Define types (`types.ts`) — clean interfaces from exporter's types
5. Build local data store (`store.ts`) — save/load exports, versioned by date

### Phase 2: MCP Tools
6. Implement `function_health_sync` — full export + store
7. Implement `function_health_results` — query with filters
8. Implement `function_health_biomarker` — deep dive single marker
9. Implement `function_health_summary` — high-level overview
10. Implement `function_health_categories` — category listing

### Phase 3: Change Detection
11. Implement `diff.ts` — compare two exports, classify changes
12. Implement `function_health_changes` — expose diff via MCP
13. Implement `function_health_check` — lightweight new-results check

### Phase 4: CLI + Polish
14. Build CLI with commander (mirror all MCP tools)
15. Implement `function_health_recommendations` and `function_health_report`
16. Write README with setup instructions
17. Test end-to-end with real data
18. Publish to npm

## Key Design Decisions

- **Bun vs Node**: Use Node + TypeScript (like oura-mcp) for broader compatibility and npm publishing. The exporter uses Bun but MCP servers should be Node-compatible.
- **Auth storage**: Follow exporter's pattern (`~/.function-health/` or `~/.function-health-cli/`). Reuse existing credentials if present.
- **Rate limiting**: Respect Function Health's servers. Default 250ms between requests, exponential backoff on errors.
- **Offline-first**: All query tools work against locally stored data. Only `sync` and `check` hit the API.
- **Fuzzy matching**: Biomarker names should fuzzy-match (e.g., "vitamin d" matches "Vitamin D, 25-Hydroxy").
- **No PII in logs**: Don't log lab values or personal data at info level. Debug only.

## Environment

- Runtime: Node.js 18+ (with TypeScript)
- Build: `tsc`
- Package manager: npm
- MCP SDK: `@modelcontextprotocol/sdk` (latest)
- Schema validation: `zod`
- CLI framework: `commander`
- License: MIT
- Repo: Will be at `github.com/daveremy/function-health-mcp`

## Reference Files

- Exporter source: `~/code/function-health-exporter/src/`
- Oura MCP (pattern): `~/code/oura-mcp/src/`
- Apple Health MCP (pattern): `~/code/apple-health-mcp/src/`
- IronCompass MCP: check npm or local install for API patterns
