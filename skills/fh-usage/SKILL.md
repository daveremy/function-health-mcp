---
name: fh-usage
description: Reference guide for Function Health MCP data model, auth flow, and tool patterns
user-invocable: false
---

# Function Health MCP — Usage Reference

Background context for working with Function Health lab data. This skill is loaded automatically to help you use the FH tools effectively.

## Data Model: Test Rounds

Function Health runs comprehensive lab panels requiring 1-3 lab visits over several weeks. All visits within one test round share the same `requisitionId`.

- Results are grouped by round, not individual visit dates
- Each round directory is keyed by the earliest visit date (e.g., `2026-01-20/`)
- `round-meta.json` in each directory contains: requisitionId, visitDates, resultCount
- A complete round typically has 100+ biomarkers across multiple categories

## Offline-First Architecture

Query tools read from `~/.function-health/exports/` — they never hit the API:
- `fh_results`, `fh_biomarker`, `fh_summary`, `fh_categories`, `fh_changes`, `fh_recommendations`, `fh_report`

Only two tools make API calls:
- `fh_sync` — full data pull, writes to local store
- `fh_check` — lightweight requisition count check

## Authentication Flow

Login is CLI-only (password requires hidden terminal input):
```
npx -y -p function-health-mcp function-health login
```

The `fh_login` MCP tool only checks auth status and directs users to the CLI command. Never attempt to collect credentials through the MCP tool.

Credentials are stored at `~/.function-health/credentials.json` (0o600 permissions). Tokens auto-refresh via Firebase JWT. If the refresh token is revoked, the server falls back to re-login using `FH_EMAIL` and `FH_PASSWORD` environment variables (if set). Check `authHint` in `fh_status` output for guidance when auth fails.

## Tool Parameter Patterns

- **Fuzzy biomarker matching**: Names are matched case-insensitively with substring matching. "vitamin d" matches "Vitamin D, 25-Hydroxy".
- **Filter options**: `fh_results` accepts `status` ("in_range" | "out_of_range"), `category`, `biomarker`, and `visit` filters.
- **Optional date params**: `fh_changes` accepts `from` and `to` date strings; defaults to comparing the two most recent rounds.
- **Force sync**: `fh_sync` has a 1-hour cooldown. Pass `force: true` to override.

## Change Notifications

When `fh_sync` detects changes between rounds, it writes notification files to `~/.function-health/changes/`:
- Files are JSON with timestamps, accumulate until acknowledged
- `fh_notifications` reads pending notifications (call without `acknowledge`)
- `fh_notifications` with `acknowledge: true` clears them
- Notifications persist across conversations — missed days don't lose data
- Capped at 100 files (oldest pruned automatically)

## Common Patterns

1. **Always start with `fh_status`** — confirms auth, data availability, and last sync time
2. **Sync before querying if no data** — `fh_status` shows `hasData: false` when exports are empty
3. **Results come from `/results-report`** — the `biomarkerResultsRecord` field, NOT the `/results` endpoint (which returns PDFs)
4. **Compare complete rounds** — `fh_changes` compares all markers across entire rounds, not individual visits
5. **Daily briefing pattern** — check `fh_notifications` first, present changes, then acknowledge
