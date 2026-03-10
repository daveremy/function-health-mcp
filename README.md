# Function Health MCP

An MCP server and CLI for [Function Health](https://www.functionhealth.com/) lab results. Query biomarkers, track changes between visits, and get health recommendations — all from Claude Code or the command line.

## Features

- **13 MCP tools** for querying lab results, biomarker deep dives, change detection, and more
- **CLI** with matching commands for terminal use
- **Offline-first** — query tools read from local storage, only sync/check hit the API
- **Test round model** — automatically groups multi-visit lab results by requisitionId into complete test rounds
- **Change detection** — compare test rounds to see what improved, worsened, or changed significantly
- **Biomarker history** — track any biomarker across all your test rounds
- **Secure** — credentials stored with owner-only permissions (0o600 files, 0o700 directories)

## Quick Start

### Option A: Install as Claude Code Plugin

Install from the plugin marketplace for zero-config MCP setup with skills included:

```
/plugin marketplace add daveremy/function-health-mcp
/plugin install function-health-mcp@function-health-mcp-plugins
```

This automatically configures the MCP server and installs the `/fh-lab-results` skill.

### Option B: Manual MCP Setup

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

Optionally copy the skills for guided slash commands and background context:

```bash
mkdir -p .claude/skills
cp -r node_modules/function-health-mcp/skills/fh-lab-results .claude/skills/
cp -r node_modules/function-health-mcp/skills/fh-usage .claude/skills/
```

### Authenticate

First, authenticate via the CLI (password input is hidden):

```bash
npx -y -p function-health-mcp function-health login
```

Then ask Claude about your lab results:

> "Show me my lab results"
> "Deep dive on my Vitamin D levels"
> "What changed between my last two visits?"

Claude will sync your data and show your results conversationally.

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
| `fh_login` | Check auth status (directs to CLI login if needed) |
| `fh_status` | Check auth status, data availability, and sync history |
| `fh_results` | Query lab results with filters (biomarker, category, status, visit) |
| `fh_biomarker` | Deep dive on a biomarker: value, ranges, history, recommendations |
| `fh_summary` | Health overview: totals, biological age, BMI, out-of-range markers |
| `fh_categories` | List biomarker categories with counts |
| `fh_changes` | Compare two test rounds: improved, worsened, new, significantly changed |
| `fh_sync` | Pull latest data from Function Health API |
| `fh_check` | Lightweight check for new results (no full data fetch) |
| `fh_notifications` | Read or acknowledge change notifications from syncs |
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
function-health changes [--from] [--to]  Compare test rounds
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
    2026-01-20/        One directory per test round (keyed by earliest visit date)
      results.json     All results across all visits in this round
      round-meta.json  Round metadata (requisitionId, visitDates, resultCount)
      biomarkers.json
      categories.json
      ...
```

### Test Round Model

Function Health runs comprehensive lab panels requiring 1-3 lab visits over several weeks. All visits within one test round share the same `requisitionId`. Results are grouped by round so that `fh_summary` shows all 100+ markers and `fh_changes` compares complete rounds, not individual visits.

## Architecture

- **Offline-first**: Query tools (`results`, `biomarker`, `summary`, `categories`, `changes`, `recommendations`, `report`) read from local JSON files. Only `sync` and `check` make API calls.
- **Rate-limited**: API requests are serialized with 250ms spacing to respect Function Health's API.
- **Atomic writes**: Exports use a temp-directory-then-rename pattern to prevent data corruption.
- **Graceful degradation**: Optional API endpoints (recommendations, notes, biological age) don't block the export if they fail.

## Migrating from v0.5.0

In v0.5.1, skills moved from `.claude/skills/lab-results/` to `skills/fh-lab-results/` and a new `skills/fh-usage/` reference skill was added. If you have skills copied into your project, re-copy them from the new paths (see [Manual MCP Setup](#option-b-manual-mcp-setup) above).

## Migrating from v0.3.x

In v0.4.0, exports are grouped by test round (requisitionId) instead of individual visit dates. On first sync, old per-visit exports are automatically migrated — multiple visit directories sharing a requisitionId are merged into a single round directory. No manual action needed.

## Migrating from v0.2.x

In v0.3.0, all MCP tool names were shortened from `function_health_*` to `fh_*` and the skill was renamed from `lab-results` to `fh-lab-results`.

## API Documentation

This project uses a reverse-engineered, undocumented API. See [docs/api-reference.md](docs/api-reference.md) for full endpoint documentation, data model, authentication flow, and known quirks.

## Requirements

- Node.js 18+ (uses native `fetch`)
- A [Function Health](https://www.functionhealth.com/) account with lab results

## Acknowledgments

Inspired by [function-health-exporter](https://github.com/bogini/function-health-exporter) by Inigo Beitia Arevalo, which pioneered the reverse-engineered API approach for exporting Function Health lab data.

## License

MIT — see [LICENSE](LICENSE)
