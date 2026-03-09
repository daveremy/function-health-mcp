# Contributing

Thanks for your interest in contributing to function-health-mcp!

## Development Setup

```bash
git clone https://github.com/daveremy/function-health-mcp.git
cd function-health-mcp
npm install
npm run build
```

Use `npm run dev -- <command>` to run CLI commands without building (uses tsx).

## Project Structure

```
src/
  mcp.ts       MCP server entry point (stdio transport, 12 tools)
  cli.ts       CLI entry point (commander, 10 commands)
  client.ts    Function Health API client (rate-limited, token-managed)
  auth.ts      Firebase JWT authentication
  store.ts     Local data store (~/.function-health/exports/), round-based storage
  diff.ts      Change detection between test rounds
  types.ts     TypeScript interfaces
  utils.ts     Shared helpers (groupByRound, fuzzyMatch, date utils)
  version.ts   Version constant
test/
  round.test.ts      groupByRound tests (13 tests)
  diff.test.ts       diffExports tests (14 tests)
  migration.test.ts  Migration and extraction helpers (8 tests)
  utils.test.ts      Utility function tests (25 tests)
  helpers.ts         Test factories (makeResult, makeExport, etc.)
docs/
  api-reference.md   Reverse-engineered Function Health API documentation
```

## Key Concepts

### Test Round Model

Function Health runs comprehensive lab panels requiring 1-3 lab visits over several weeks. All visits within one test round share a `requisitionId`. Results are grouped by round and stored in directories keyed by earliest visit date. See [docs/api-reference.md](docs/api-reference.md) for API details.

### Offline-First Architecture

Query tools (results, biomarker, summary, categories, changes, recommendations, report) read from local JSON files. Only `sync` and `check` make API calls.

## Making Changes

1. Fork the repo and create a branch
2. Make your changes in `src/`
3. Run `npm run build` to verify TypeScript compiles
4. Run `npm test` to verify all tests pass (60 tests via node:test + tsx)
5. Test manually with the CLI (`./dist/cli.js`) or MCP server
6. Submit a pull request

## Code Style

- TypeScript strict mode
- ES2022 target, NodeNext modules
- Prefer small, focused functions in `utils.ts` for shared logic
- Error handling: use `ApiError` for HTTP errors, `safeTool` wrapper for MCP handlers
- File I/O: use `writeSecure` for sensitive data, `validateDate` for user-provided dates
- Tests: use node:test + assert/strict, test factories from `test/helpers.ts`

## Reporting Issues

Open an issue at https://github.com/daveremy/function-health-mcp/issues with:
- What you expected vs what happened
- Steps to reproduce
- Node.js version and OS
