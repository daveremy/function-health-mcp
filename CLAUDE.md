# Function Health MCP

MCP server + CLI for querying Function Health lab results, detecting changes between visits, and tracking biomarker trends.

## Project Structure

```
src/
  mcp.ts       - MCP server entry point (stdio transport)
  cli.ts       - CLI entry point (commander)
  client.ts    - Function Health API client
  auth.ts      - Firebase auth (login, token refresh, credential storage)
  types.ts     - TypeScript interfaces
  store.ts     - Local data store (~/.function-health/exports/)
  diff.ts      - Change detection between exports
  utils.ts     - Date formatting, fuzzy match, delay
```

## Build & Run

```bash
npm run build          # TypeScript → dist/
npm run dev            # Run CLI via tsx
node dist/mcp.js       # Run MCP server
node dist/cli.js       # Run CLI
```

## Key Patterns

- **Offline-first**: Query tools read from local store. Only `sync` and `check` hit the API.
- **MCP + CLI dual mode**: Both use the same client and store code.
- **Auth**: Firebase JWT stored in `~/.function-health/credentials.json`. Auto-refreshes.
- **Rate limiting**: 500ms between API requests. Exponential backoff on retries.
- **Fuzzy matching**: Biomarker names are matched case-insensitively with substring matching.

## Data Storage

```
~/.function-health/
  credentials.json     - Auth tokens
  latest.json          - Most recent full export
  sync-log.json        - Sync timestamps
  exports/
    YYYY-MM-DD/        - Versioned exports
```

## MCP Tools

- `fh_login` - Authenticate with Function Health
- `fh_status` - Check auth/data status
- `fh_results` - Query results with filters
- `fh_biomarker` - Deep dive on one biomarker
- `fh_summary` - High-level health overview
- `fh_categories` - Category listing
- `fh_changes` - Compare visits
- `fh_sync` - Pull latest data
- `fh_check` - Quick new-results check
- `fh_recommendations` - Health recommendations
- `fh_report` - Clinician report
- `fh_version` - Check for updates
