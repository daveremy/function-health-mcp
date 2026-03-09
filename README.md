# Function Health MCP

An MCP server and CLI for [Function Health](https://www.functionhealth.com/) lab results. Query biomarkers, track changes between visits, and get health recommendations — all from Claude Code or the command line.

## Features

- **12 MCP tools** for querying lab results, biomarker deep dives, change detection, and more
- **CLI** with matching commands for terminal use
- **Offline-first** — query tools read from local storage, only sync/check hit the API
- **Change detection** — compare visits to see what improved, worsened, or changed significantly
- **Biomarker history** — track any biomarker across all your visits
- **Secure** — credentials stored with owner-only permissions (0o600 files, 0o700 directories)

## Quick Start

### 1. Add to Claude Code

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "function-health": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "function-health-mcp"]
    }
  }
}
```

### 2. Start using it

Just ask Claude about your lab results. On first use, Claude will walk you through authentication — no CLI needed:

> "Show me my lab results"
> "Deep dive on my Vitamin D levels"
> "What changed between my last two visits?"

Claude will ask for your Function Health email and password, authenticate, sync your data, and show your results — all conversationally.

### 3. Install the skill (optional)

Copy the skill into your project for a guided `/fh-lab-results` slash command:

```bash
cp -r node_modules/function-health-mcp/.claude/skills/lab-results your-project/.claude/skills/
```

### Alternative: Install from source

```bash
git clone https://github.com/daveremy/function-health-mcp.git
cd function-health-mcp
npm install && npm run build
```

Then use the CLI directly:

```bash
./dist/cli.js login
./dist/cli.js sync
./dist/cli.js summary
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `fh_login` | Authenticate with Function Health (email + password) |
| `fh_status` | Check auth status, data availability, and sync history |
| `fh_results` | Query lab results with filters (biomarker, category, status, visit) |
| `fh_biomarker` | Deep dive on a biomarker: value, ranges, history, recommendations |
| `fh_summary` | Health overview: totals, biological age, BMI, out-of-range markers |
| `fh_categories` | List biomarker categories with counts |
| `fh_changes` | Compare two visits: improved, worsened, new, significantly changed |
| `fh_sync` | Pull latest data from Function Health API |
| `fh_check` | Lightweight check for new results (no full data fetch) |
| `fh_recommendations` | Health recommendations, optionally filtered by category |
| `fh_report` | Full clinician report for a visit |
| `fh_version` | Check installed version and whether an update is available |

## CLI Commands

```
function-health login                  Authenticate with Function Health
function-health status                 Show auth status and data stats
function-health sync [--force]         Pull latest data
function-health check                  Quick check for new results
function-health results [options]      Query lab results
function-health biomarker <name>       Deep dive on a biomarker
function-health summary                Health summary
function-health categories             List categories
function-health changes [--from] [--to]  Compare visits
function-health export [--markdown]    Full JSON export
```

## Periodic Monitoring with `/loop`

Use Claude Code's `/loop` command to check for new results automatically:

```
/loop 6h /fh-lab-results check
```

This checks every 6 hours. When new results are detected, it syncs and summarizes what changed.

## Data Storage

All data is stored locally at `~/.function-health/`:

```
~/.function-health/
  credentials.json     Auth tokens (0o600)
  latest.json          Pointer to most recent export
  sync-log.json        Sync history
  exports/
    2026-02-26/        Versioned exports (one directory per visit)
      results.json
      biomarkers.json
      categories.json
      ...
```

## Architecture

- **Offline-first**: Query tools (`results`, `biomarker`, `summary`, `categories`, `changes`, `recommendations`, `report`) read from local JSON files. Only `sync` and `check` make API calls.
- **Rate-limited**: API requests are serialized with 250ms spacing to respect Function Health's API.
- **Atomic writes**: Exports use a temp-directory-then-rename pattern to prevent data corruption.
- **Graceful degradation**: Optional API endpoints (recommendations, notes, biological age) don't block the export if they fail.

## Migrating from v0.2.x

In v0.3.0, all MCP tool names were shortened from `function_health_*` to `fh_*` and the skill was renamed from `lab-results` to `fh-lab-results`. If you have the skill copied into your project, re-copy it to get the updated tool references.

## Requirements

- Node.js 18+ (uses native `fetch`)
- A [Function Health](https://www.functionhealth.com/) account with lab results

## License

MIT — see [LICENSE](LICENSE)
