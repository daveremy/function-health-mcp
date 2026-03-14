#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { FunctionHealthClient } from "./client.js";
import { loadCredentials, getValidTokens } from "./auth.js";
import { loadLatest, loadExport, loadExportResults, saveRoundExport, listExports, getSyncLog, updateRequisitionCount, loadRoundMeta, migrateToRounds, loadAllExportsAggregated, loadChangeNotifications, clearChangeNotifications } from "./store.js";
import { diffExports, detectAndSaveChanges } from "./diff.js";
import { fuzzyMatch, getResultName, getResultValue, buildCategoryMap, buildOutOfRangeSet, filterResults, resolveSexFilter, resolveSexDetails, findMatchingResults, validateDate, SYNC_COOLDOWN_MS } from "./utils.js";
import { VERSION } from "./version.js";
import type { ExportData } from "./types.js";

const MAX_HISTORY_CONCURRENCY = 10;
const ENV_CREDS_TIP = "Tip: Set FH_EMAIL and FH_PASSWORD environment variables for automatic re-authentication when tokens expire.";

const server = new McpServer({ name: "function-health", version: VERSION });

function text(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function noData() {
  return text({ error: "No data available. Run fh_sync first." });
}

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: true };

/** Wrap a tool handler with error catching so failures don't crash the MCP server */
function safeTool<T>(fn: (args: T) => Promise<ToolResult>): (args: T) => Promise<ToolResult> {
  return async (args: T) => {
    try {
      return await fn(args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: message }, null, 2) }], isError: true as const };
    }
  };
}

// ── Auth Tools ──

async function checkAuth(): Promise<{ authenticated: boolean; tokenValid: boolean; email: string | null }> {
  const creds = await loadCredentials();
  const authenticated = !!(creds?.idToken && creds?.refreshToken);
  let tokenValid = false;
  if (authenticated) {
    try { await getValidTokens(); tokenValid = true; } catch { /* expired */ }
  }
  return { authenticated, tokenValid, email: creds?.email ?? null };
}

server.registerTool("fh_login", {
  title: "Login",
  description: "Check authentication status. If not authenticated, instructs the user to run the CLI login command.",
  inputSchema: z.object({}),
}, safeTool(async () => {
  const auth = await checkAuth();
  if (auth.authenticated && auth.tokenValid) {
    return text({
      authenticated: true,
      email: auth.email,
      message: "Already authenticated. You can run fh_sync to pull your data.",
    });
  }

  const hasEnvCreds = !!(process.env.FH_EMAIL && process.env.FH_PASSWORD);
  return text({
    authenticated: false,
    message: "Not authenticated. Please run this command in your terminal to log in:\n\n  npx -y -p function-health-mcp function-health login\n\nThis keeps your password secure (hidden input). Once logged in, return here and run fh_sync."
      + (!hasEnvCreds ? `\n\n${ENV_CREDS_TIP}` : ""),
  });
}));

server.registerTool("fh_status", {
  title: "Auth & Data Status",
  description: "Check authentication status, data availability, and sync history. Use this to determine if the user needs to login or sync.",
  inputSchema: z.object({}),
}, safeTool(async () => {
  const auth = await checkAuth();
  const syncLog = await getSyncLog();
  const data = await loadLatest();
  const exports = await listExports();

  // Load round info for each export (parallel)
  const rounds = await Promise.all(exports.map(async (date) => {
    const meta = await loadRoundMeta(date);
    return {
      date,
      visitDates: meta?.visitDates ?? [date],
      resultCount: meta?.resultCount ?? 0,
    };
  }));

  const hasEnvCreds = !!(process.env.FH_EMAIL && process.env.FH_PASSWORD);
  const authHint = (auth.authenticated && !auth.tokenValid)
    ? (hasEnvCreds
      ? "Token expired. Auto-login via FH_EMAIL/FH_PASSWORD was attempted but failed. Check that your credentials are correct, or run: npx -y -p function-health-mcp function-health login"
      : `Token expired. Run: npx -y -p function-health-mcp function-health login\n\n${ENV_CREDS_TIP}`)
    : undefined;

  return text({
    ...auth,
    ...(authHint ? { authHint } : {}),
    lastSync: syncLog.lastSync || null,
    roundCount: exports.length,
    rounds,
    hasData: !!data,
    resultCount: data?.results.length ?? 0,
  });
}));

// ── Core Query Tools ──

server.registerTool("fh_results", {
  title: "Lab Results",
  description: "Query lab results with filtering by biomarker name, category, status (in_range/out_of_range), or test round",
  inputSchema: z.object({
    biomarker: z.string().optional().describe("Biomarker name or partial match (fuzzy)"),
    category: z.string().optional().describe("Category name (e.g. 'heart', 'thyroid')"),
    status: z.enum(["in_range", "out_of_range", "all"]).optional().describe("Filter by range status"),
    visit: z.string().optional().describe("'latest' (default) or a test round date (YYYY-MM-DD)"),
  }),
}, safeTool(async ({ biomarker, category, status, visit }) => {
  const data = await resolveExport(visit);
  if (!data) return noData();

  const categoryLookup = category ? buildCategoryMap(data) : undefined;
  const results = filterResults(data.results, { biomarker, category, status }, categoryLookup);

  return text({
    count: results.length,
    results: results.map(r => ({
      name: getResultName(r),
      value: getResultValue(r),
      inRange: r.inRange,
      dateOfService: r.dateOfService,
    })),
  });
}));

server.registerTool("fh_biomarker", {
  title: "Biomarker Deep Dive",
  description: "Get detailed info on a specific biomarker: current value, optimal range, history, clinical context, recommendations",
  inputSchema: z.object({
    name: z.string().describe("Biomarker name (fuzzy match supported)"),
  }),
}, safeTool(async ({ name }) => {
  const data = await loadLatest();
  if (!data) return noData();

  const bm = data.biomarkers.find(b => fuzzyMatch(name, b.name));
  if (!bm) return text({ error: `No biomarker matching "${name}" found.` });

  const matchingResults = findMatchingResults(data.results, bm.name);
  const detail = data.biomarkerDetails.find(d => fuzzyMatch(bm.name, d.name));

  const sexFilter = resolveSexFilter(data.profile?.biologicalSex);
  const sexDetail = resolveSexDetails(bm, sexFilter);

  // History: load results from each export with bounded concurrency
  const exportDates = await listExports();
  const allResults = await loadWithConcurrencyLimit(
    exportDates.map(d => () => loadExportResults(d)),
    MAX_HISTORY_CONCURRENCY,
  );
  const history: Array<{ date: string; value: string; inRange: boolean }> = [];
  for (let i = 0; i < exportDates.length; i++) {
    const matching = findMatchingResults(allResults[i], bm.name);
    if (matching.length > 0) {
      const result = matching[0];
      history.push({
        date: result.dateOfService || exportDates[i],
        value: getResultValue(result),
        inRange: result.inRange,
      });
    }
  }

  return text({
    name: bm.name,
    currentValue: matchingResults[0] ? getResultValue(matchingResults[0]) : null,
    inRange: matchingResults[0]?.inRange ?? null,
    optimalRange: sexDetail ? { low: sexDetail.optimalRangeLow, high: sexDetail.optimalRangeHigh } : null,
    referenceRange: sexDetail ? { low: sexDetail.questRefRangeLow, high: sexDetail.questRefRangeHigh } : null,
    categories: bm.categories.map(c => c.categoryName),
    history,
    detail: detail ? {
      description: detail.oneLineDescription,
      whyItMatters: detail.whyItMatters,
      recommendations: detail.recommendations,
      foods: detail.foodsToEatDescription,
      foodsToAvoid: detail.foodsToAvoidDescription,
      supplements: detail.supplementsDescription,
      selfCare: detail.selfCareDescription,
    } : null,
  });
}));

server.registerTool("fh_summary", {
  title: "Health Summary",
  description: "High-level health summary: total markers, in/out of range counts, biological age, BMI, top concerns",
  inputSchema: z.object({
    visit: z.string().optional().describe("'latest' (default) or a test round date (YYYY-MM-DD)"),
  }),
}, safeTool(async ({ visit }) => {
  const data = await resolveExport(visit);
  if (!data) return noData();

  const total = data.results.length;
  const inRange = data.results.filter(r => r.inRange).length;

  const outOfRangeResults = data.results
    .filter(r => !r.inRange)
    .map(r => ({
      name: getResultName(r),
      value: getResultValue(r),
    }));

  return text({
    totalMarkers: total,
    inRange,
    outOfRange: total - inRange,
    biologicalAge: data.biologicalAge,
    bmi: data.bmi,
    outOfRangeMarkers: outOfRangeResults,
    profile: data.profile ? {
      name: `${data.profile.fname} ${data.profile.lname}`,
      biologicalSex: data.profile.biologicalSex,
      dob: data.profile.dob,
    } : null,
  });
}));

server.registerTool("fh_categories", {
  title: "Biomarker Categories",
  description: "List all biomarker categories with counts and out-of-range markers",
  inputSchema: z.object({}),
}, safeTool(async () => {
  const data = await loadLatest();
  if (!data) return noData();

  const outOfRangeNames = buildOutOfRangeSet(data.results);

  const categories = data.categories.map(cat => ({
    name: cat.categoryName,
    description: cat.description,
    biomarkerCount: cat.biomarkers.length,
    outOfRange: cat.biomarkers.filter(bm => outOfRangeNames.has(bm.name.toLowerCase())).length,
  }));

  return text(categories);
}));

// ── Change Detection Tools ──

server.registerTool("fh_changes", {
  title: "Compare Test Rounds",
  description: "Compare results between test rounds to see what improved, worsened, or changed significantly. Each test round may include multiple lab visits.",
  inputSchema: z.object({
    from_visit: z.string().optional().describe("From test round date YYYY-MM-DD (defaults to previous)"),
    to_visit: z.string().optional().describe("To test round date YYYY-MM-DD (defaults to latest)"),
  }),
}, safeTool(async ({ from_visit, to_visit }) => {
  const exports = await listExports();
  if (exports.length < 2) return text({ error: "Need at least 2 test rounds to compare. Run fh_sync." });

  const fromDate = from_visit ?? exports[exports.length - 2];
  const toDate = to_visit ?? exports[exports.length - 1];

  const [fromData, toData] = await Promise.all([
    loadExport(fromDate),
    loadExport(toDate),
  ]);

  if (!fromData || !toData) return text({ error: "Could not load exports for comparison." });

  return text(diffExports(fromData, toData, fromDate, toDate));
}));

server.registerTool("fh_sync", {
  title: "Sync Data",
  description: "Pull latest data from Function Health API and store locally. Detects new results. First sync takes 30-60 seconds — warn the user to expect a wait.",
  inputSchema: z.object({
    force: z.boolean().optional().describe("Re-export even if recent data exists"),
  }),
}, safeTool(async ({ force }) => {
  const syncLog = await getSyncLog();
  const lastSync = syncLog.lastSync;

  if (!force && lastSync) {
    const sinceLast = Date.now() - new Date(lastSync).getTime();
    if (sinceLast < SYNC_COOLDOWN_MS) {
      return text({
        synced: false,
        message: `Last sync was ${Math.round(sinceLast / 60000)} minutes ago. Use force=true to re-sync.`,
        lastSync,
      });
    }
  }

  // Migrate old per-visit exports to round-based (idempotent)
  await migrateToRounds();

  // Before saving: aggregate all existing rounds for change detection
  const { data: previousData, roundCount: previousRoundCount } = await loadAllExportsAggregated();

  server.server.sendLoggingMessage({ level: "info", data: "Syncing — fetching data from Function Health API..." });
  const client = await FunctionHealthClient.create();
  const data = await client.exportAll();
  const requisitionCount = data.requisitions?.length ?? 0;
  server.server.sendLoggingMessage({ level: "info", data: `Fetched ${data.results.length} results, ${data.biomarkers.length} biomarkers. Saving...` });
  const savedDates = await saveRoundExport(data);
  await updateRequisitionCount(requisitionCount);

  // Change detection: compare fresh API data against previous aggregate
  const summary = await detectAndSaveChanges(previousData, data, savedDates, previousRoundCount);
  const newRounds = savedDates.length - previousRoundCount;

  return text({
    synced: true,
    roundDates: savedDates,
    resultCount: data.results.length,
    newRounds,
    lastSync: new Date().toISOString(),
    hasChanges: summary.length > 0,
    changeSummary: summary.length > 0 ? summary : undefined,
  });
}));

server.registerTool("fh_check", {
  title: "Check for New Results",
  description: "Quick check for new results (lightweight — checks requisition status)",
  inputSchema: z.object({}),
}, safeTool(async () => {
  const client = await FunctionHealthClient.create();
  const [pending, completed, schedules, syncLog] = await Promise.all([
    client.getPendingRequisitions(),
    client.getCompletedRequisitions(),
    client.getPendingSchedules(),
    getSyncLog(),
  ]);

  const lastSync = syncLog.lastSync;

  // Compare completed requisition count against stored count to detect new results
  const storedRequisitionCount = syncLog.requisitionCount;
  const newResultsAvailable = storedRequisitionCount !== undefined
    ? completed.length > storedRequisitionCount
    : null; // null = unknown, suggest syncing

  return text({
    pendingRequisitions: pending.length,
    completedRequisitions: completed.length,
    pendingSchedules: schedules.length,
    lastSync: lastSync || "never",
    newResultsAvailable,
    note: "This checks for new test rounds only. To detect new batches within a round, run fh_sync.",
  });
}));

// ── Notification Tools ──

server.registerTool("fh_notifications", {
  title: "Change Notifications",
  description: "Read pending change notifications from syncs. Notifications accumulate until acknowledged. Use acknowledge=true to clear after reading.",
  inputSchema: z.object({
    acknowledge: z.boolean().optional().describe("Clear notifications after reading"),
  }),
}, safeTool(async ({ acknowledge }) => {
  const { notifications, files } = await loadChangeNotifications();
  let acknowledged = 0;
  if (acknowledge && files.length > 0) {
    acknowledged = await clearChangeNotifications(files);
  }
  return text({
    count: notifications.length,
    notifications,
    acknowledged,
  });
}));

// ── Reference Tools ──

server.registerTool("fh_recommendations", {
  title: "Recommendations",
  description: "Get Function Health's health recommendations, optionally filtered by category",
  inputSchema: z.object({
    category: z.string().optional().describe("Filter by category name"),
  }),
}, safeTool(async ({ category }) => {
  const data = await loadLatest();
  if (!data) return noData();

  let recs = data.recommendations;
  if (category) {
    const catLower = category.toLowerCase();
    recs = recs.filter(r => {
      return typeof r.category === "string" && r.category.toLowerCase().includes(catLower);
    });
  }

  return text(recs);
}));

server.registerTool("fh_report", {
  title: "Clinician Report",
  description: "Get the full clinician report for a test round",
  inputSchema: z.object({
    visit: z.string().optional().describe("'latest' (default) or a test round date (YYYY-MM-DD)"),
  }),
}, safeTool(async ({ visit }) => {
  const data = await resolveExport(visit);
  if (!data) return noData();

  return text(data.report);
}));

// ── Version Tool ──

/** Compare two semver strings numerically (e.g. "0.2.0" vs "0.3.1") */
function isNewerVersion(current: string, latest: string): boolean {
  const c = current.split(".").map(Number);
  const l = latest.split(".").map(Number);
  for (let i = 0; i < Math.max(c.length, l.length); i++) {
    const cv = c[i] ?? 0;
    const lv = l[i] ?? 0;
    if (lv > cv) return true;
    if (lv < cv) return false;
  }
  return false;
}

server.registerTool("fh_version", {
  title: "Version Check",
  description: "Check the installed version and whether an update is available on npm",
  inputSchema: z.object({}),
}, safeTool(async () => {
  let latest: string | null = null;
  let updateAvailable = false;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch("https://registry.npmjs.org/function-health-mcp/latest", {
      signal: controller.signal,
      headers: { "User-Agent": `function-health-mcp/${VERSION}` },
    });
    if (res.ok) {
      const data = await res.json() as Record<string, unknown>;
      clearTimeout(timeout);
      if (typeof data.version === "string") {
        latest = data.version;
        updateAvailable = isNewerVersion(VERSION, latest);
      }
    } else {
      clearTimeout(timeout);
    }
  } catch {
    // Network error — degrade gracefully
  }

  return text({
    current: VERSION,
    latest: latest ?? "unknown",
    updateAvailable,
    ...(updateAvailable && latest ? {
      updateInstructions: "If using npx, clear the cache: rm -rf ~/.npm/_npx/**/function-health-mcp. If installed globally: npm install -g function-health-mcp@latest",
    } : {}),
  });
}));

// ── Helpers ──

async function resolveExport(visit?: string): Promise<ExportData | null> {
  if (!visit || visit === "latest") return loadLatest();
  return loadExport(validateDate(visit));
}

/** Run async tasks with bounded concurrency */
async function loadWithConcurrencyLimit<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;

  async function worker() {
    while (next < tasks.length) {
      const idx = next++;
      results[idx] = await tasks[idx]();
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));
  return results;
}

// ── Start ──

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Function Health MCP server error:", err);
  process.exit(1);
});
