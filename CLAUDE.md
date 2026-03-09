# Function Health MCP

MCP server + CLI for querying Function Health lab results, detecting changes between test rounds, and tracking biomarker trends.

## Project Structure

```
src/
  mcp.ts       - MCP server entry point (stdio transport, 12 tools)
  cli.ts       - CLI entry point (commander, 10 commands)
  client.ts    - Function Health API client (rate-limited, token-managed)
  auth.ts      - Firebase auth (login, token refresh, credential storage)
  types.ts     - TypeScript interfaces
  store.ts     - Local data store (~/.function-health/exports/), round-based storage
  diff.ts      - Change detection between test rounds
  utils.ts     - groupByRound, fuzzy match, date helpers, file helpers
  version.ts   - Version constant
test/
  round.test.ts      - groupByRound tests
  diff.test.ts       - diffExports tests
  migration.test.ts  - Migration and extraction helpers
  utils.test.ts      - Utility function tests
  helpers.ts         - Test factories (makeResult, makeExport, etc.)
docs/
  api-reference.md   - Reverse-engineered Function Health API documentation
```

## Build & Run

```bash
npm run build          # TypeScript → dist/
npm run dev            # Run CLI via tsx
npm test               # Run 60 unit tests via node:test + tsx
node dist/mcp.js       # Run MCP server
node dist/cli.js       # Run CLI
```

## Key Patterns

- **Offline-first**: Query tools read from local store. Only `sync` and `check` hit the API.
- **Test round model**: Results grouped by `requisitionId` into complete test rounds. Each round = 1-3 lab visits over several weeks, stored in one directory keyed by earliest visit date. See `docs/api-reference.md`.
- **MCP + CLI dual mode**: Both use the same client and store code.
- **Auth**: Firebase JWT stored in `~/.function-health/credentials.json`. Auto-refreshes.
- **Rate limiting**: 250ms between API requests. Exponential backoff on retries.
- **Fuzzy matching**: Biomarker names are matched case-insensitively with substring matching.
- **Results source**: Lab values come from `/results-report` → `biomarkerResultsRecord`, NOT `/results` (which returns PDFs).

## Data Storage

```
~/.function-health/
  credentials.json     - Auth tokens (0o600)
  latest.json          - Pointer to most recent export
  sync-log.json        - Sync history and requisition tracking
  exports/
    YYYY-MM-DD/        - One directory per test round (keyed by earliest visit date)
      results.json     - All results across all visits in this round
      round-meta.json  - Round metadata (requisitionId, visitDates, resultCount)
      biomarkers.json  - Biomarker definitions
      categories.json  - Category definitions with nested biomarkers
      biomarker-details.json  - Detailed biomarker info (descriptions, recommendations)
      profile.json     - User profile
      recommendations.json
      report.json      - Full results report (raw API response)
      biological-age.json
      bmi.json
      notes.json
      requisitions.json
      pending-schedules.json
```

## MCP Tools

- `fh_login` - Check auth status (directs to CLI for actual login)
- `fh_status` - Auth status, sync history, round info
- `fh_results` - Query results with filters (biomarker, category, status, visit)
- `fh_biomarker` - Deep dive: value, ranges, history, recommendations
- `fh_summary` - Health overview: totals, biological age, BMI, out-of-range
- `fh_categories` - Category listing with out-of-range counts
- `fh_changes` - Compare two test rounds: improved, worsened, new, changed
- `fh_sync` - Pull latest data (auto-migrates old exports to round model)
- `fh_check` - Lightweight new-results check (requisition count only)
- `fh_recommendations` - Health recommendations, optionally by category
- `fh_report` - Full clinician report
- `fh_version` - Check for updates
