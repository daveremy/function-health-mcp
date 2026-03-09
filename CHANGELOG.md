# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

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
