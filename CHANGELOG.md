# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- Auto-recover from revoked Firebase refresh tokens via `FH_EMAIL`/`FH_PASSWORD` environment variable fallback (#18, #19)
- Diagnostic logging on token refresh failures for easier debugging
- `fh_status` now returns `authHint` field with actionable guidance when token is invalid

### Added
- `refreshTokenWithFallback()` with email-match guard to prevent silent account switching
- Env-var fallback wired into both `getValidTokens()` and client `doRefresh()` paths
- `.env` file fallback — reads `FH_EMAIL`/`FH_PASSWORD` from `~/lifeos/.env` or `~/.env` when not in `process.env` (fixes MCP plugin auth without direnv)
- 7 unit tests for `shouldAttemptEnvLogin()`, 6 for `parseDotenv`
- `scripts/release.sh` — automated release script (version bump, build, publish, marketplace update)

## [0.5.3] - 2026-03-13

### Fixed
- Skip writing exports when data is unchanged (#6)
- Use `npx` for plugin MCP server to resolve dependencies

## [0.5.2] - 2026-03-12

### Added
- Claude Code plugin manifest (`.claude-plugin/plugin.json`) with `npx -y function-health-mcp`
- Per-repo marketplace (`.claude-plugin/marketplace.json`)
- Usage reference skill (`skills/fh-usage/`)

## [0.5.0] - 2026-03-11

### Added
- Change detection notifications (#13)
- `fh_notifications` tool — read/clear change notifications from syncs
- `diffMeta()` compares biological age, BMI, recommendations, notes, requisitions, report
- `buildChangeSummary()` produces human-readable change lines
- `loadAllExportsAggregated()` merges all rounds for accurate diff
- Change files capped at 100 (oldest pruned)

## [0.4.0] - 2026-03-09

### Added
- **Test round model** — results are now grouped by `requisitionId` instead of `dateOfService`, correctly merging multiple lab visits within the same test round (#10 follow-up)
- `round-meta.json` stored alongside each export with requisitionId, visit dates, and result count
- Auto-migration from v0.3.x per-visit exports to round-based exports (idempotent, runs on first sync)
- Round info in `fh_status` — shows visit dates and result count per round
- Migration tests and expanded round-grouping test suite

### Changed
- `fh_summary` now shows all results across a test round (e.g. 113 instead of 68)
- `fh_changes` compares test rounds, not individual visit dates — uses round labels for accurate date display
- `fh_check` clarifies that it detects new test rounds only; batch detection requires `fh_sync`
- `fh_sync` runs migration before syncing, then saves round-based exports
- Tool descriptions updated to reference "test round" semantics
- `partitionByVisitDate()` replaced with `groupByRound()` in utils
- `saveMultiVisitExport()` replaced with `saveRoundExport()` in store

### Fixed
- `fh_changes` no longer compares two visits from the same round (zero overlap, nonsensical diff)
- `fh_summary` no longer shows partial results (one visit instead of full round)
- `diffExports` accepts optional labels so round keys (earliest date) display correctly instead of derived latest date

## [0.3.0] - 2026-03-09

### Added
- Per-visit export partitioning — sync now creates separate export directories for each visit date, fixing change detection for users with multiple visits (#10)
- Disappeared marker detection in diff — biomarkers present in the previous visit but missing from the current one are now reported (#5)
- Non-numeric value change detection — qualitative changes like "CLEAR" → "ABNORMAL" are now classified as significant changes instead of silently ignored (#5)
- Requisition count tracking in sync log for accurate new-results detection (#7)
- Test suite with 42 unit tests covering partitioning, diff, and utility functions

### Changed
- `fh_login` no longer accepts email/password — directs users to run `npx function-health-mcp login` in the terminal for secure hidden input (#1)
- `fh_check` now compares completed requisition count against stored requisition count instead of comparing against result count (#7)
- `fh_sync` sums result counts across all exports for new-results detection

### Removed
- Dead code in client.ts: `getBiomarkerDetails()`, `getBiomarkerData()`, `makeBiomarkerDetail()`, and `BIOMARKER_DETAIL_STRING_FIELDS` (#8)
- Password parameters from `fh_login` MCP tool (#1)

### Fixed
- "Need at least 2 exports to compare" error for users with multiple visits stored in a single export directory (#10)
- Unit mismatch in `fh_check` — was comparing requisition count (~3) against biomarker result count (~113) (#7)

## [0.2.0] - 2026-03-08

### Added
- MCP tools renamed from `function_health_*` to `fh_*` for brevity (#4)
- `fh_version` tool — checks installed version against npm and shows update instructions (#2)
- `fh_login` and `fh_status` MCP tools
- `fh_report` tool for clinician reports
- Sync progress logging with duration warning
- Lab results skill (`fh-lab-results`) for guided conversational use
- README, CONTRIBUTING guide, and MCP config examples

### Changed
- Results extraction uses `/results-report` endpoint (biomarkerResultsRecord) instead of `/results` (which returns PDFs)
- Skill renamed from `lab-results` to `fh-lab-results`

### Fixed
- Auth token refresh race condition
- Atomic export saves with backup/restore on failure
- Resilient export loading with graceful degradation
- File permissions enforced via chmod after write
- `latest.json` changed from full data dump to lightweight pointer

## [0.1.2] - 2026-03-08

### Fixed
- Multi-category biomarker mapping
- 5xx response body draining
- Parallelized requisition check

## [0.1.1] - 2026-03-08

### Fixed
- Hardening from codex and gemini code reviews

## [0.1.0] - 2026-03-08

### Added
- Initial release
- MCP server with stdio transport
- CLI with commander
- Firebase authentication with token refresh
- Local data store with versioned exports
- Change detection between visits
- Fuzzy biomarker name matching
- Rate-limited API client with retry logic
