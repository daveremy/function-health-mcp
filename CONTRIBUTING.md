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
  mcp.ts       MCP server entry point (stdio transport, 9 tools)
  cli.ts       CLI entry point (commander, 10 commands)
  client.ts    Function Health API client (rate-limited, token-managed)
  auth.ts      Firebase JWT authentication
  store.ts     Local data store (~/.function-health/exports/)
  diff.ts      Change detection between exports
  types.ts     TypeScript interfaces
  utils.ts     Shared helpers
```

## Making Changes

1. Fork the repo and create a branch
2. Make your changes in `src/`
3. Run `npm run build` to verify TypeScript compiles
4. Test manually with the CLI (`./dist/cli.js`) or MCP server
5. Submit a pull request

## Code Style

- TypeScript strict mode
- ES2022 target, NodeNext modules
- Prefer small, focused functions in `utils.ts` for shared logic
- Error handling: use `ApiError` for HTTP errors, `safeTool` wrapper for MCP handlers
- File I/O: use `writeSecure` for sensitive data, `validateDate` for user-provided dates

## Reporting Issues

Open an issue at https://github.com/daveremy/function-health-mcp/issues with:
- What you expected vs what happened
- Steps to reproduce
- Node.js version and OS
