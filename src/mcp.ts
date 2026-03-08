#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { FunctionHealthClient } from "./client.js";
import { loadLatest, loadExport, loadExportResults, saveExport, listExports, getSyncLog } from "./store.js";
import { diffExports } from "./diff.js";
import { fuzzyMatch, getResultName, buildCategoryMap, resolveSexFilter, resolveSexDetails, findMatchingResults, validateDate } from "./utils.js";
import type { ExportData } from "./types.js";

const MAX_HISTORY_CONCURRENCY = 10;

const server = new McpServer({ name: "function-health", version: "0.1.0" });

function text(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function noData() {
  return text({ error: "No data available. Run function_health_sync first." });
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

// ── Core Query Tools ──

server.registerTool("function_health_results", {
  title: "Lab Results",
  description: "Query lab results with filtering by biomarker name, category, status (in_range/out_of_range), or visit",
  inputSchema: z.object({
    biomarker: z.string().optional().describe("Biomarker name or partial match (fuzzy)"),
    category: z.string().optional().describe("Category name (e.g. 'heart', 'thyroid')"),
    status: z.enum(["in_range", "out_of_range", "all"]).optional().describe("Filter by range status"),
    visit: z.string().optional().describe("'latest' (default) or a visit date (YYYY-MM-DD)"),
  }),
}, safeTool(async ({ biomarker, category, status, visit }) => {
  const data = await resolveExport(visit);
  if (!data) return noData();

  let results = data.results;

  const categoryLookup = buildCategoryMap(data);

  if (biomarker) {
    results = results.filter(r => {
      const name = getResultName(r);
      return name ? fuzzyMatch(biomarker, name) : false;
    });
  }

  if (category) {
    const catLower = category.toLowerCase();
    results = results.filter(r => {
      const name = getResultName(r);
      if (!name) return false;
      const cat = categoryLookup.get(name.toLowerCase());
      return cat ? cat.toLowerCase().includes(catLower) : false;
    });
  }

  if (status === "in_range") {
    results = results.filter(r => r.inRange);
  } else if (status === "out_of_range") {
    results = results.filter(r => !r.inRange);
  }

  return text({
    count: results.length,
    results: results.map(r => ({
      name: getResultName(r),
      value: r.displayResult || r.calculatedResult,
      inRange: r.inRange,
      dateOfService: r.dateOfService,
    })),
  });
}));

server.registerTool("function_health_biomarker", {
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
        value: result.displayResult || result.calculatedResult,
        inRange: result.inRange,
      });
    }
  }

  return text({
    name: bm.name,
    currentValue: matchingResults[0]?.displayResult || matchingResults[0]?.calculatedResult || null,
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

server.registerTool("function_health_summary", {
  title: "Health Summary",
  description: "High-level health summary: total markers, in/out of range counts, biological age, BMI, top concerns",
  inputSchema: z.object({
    visit: z.string().optional().describe("'latest' (default) or a visit date (YYYY-MM-DD)"),
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
      value: r.displayResult || r.calculatedResult,
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

server.registerTool("function_health_categories", {
  title: "Biomarker Categories",
  description: "List all biomarker categories with counts and out-of-range markers",
  inputSchema: z.object({}),
}, safeTool(async () => {
  const data = await loadLatest();
  if (!data) return noData();

  const outOfRangeNames = new Set<string>();
  for (const r of data.results) {
    if (!r.inRange) {
      const name = getResultName(r);
      if (name) outOfRangeNames.add(name.toLowerCase());
    }
  }

  const categories = data.categories.map(cat => ({
    name: cat.categoryName,
    description: cat.description,
    biomarkerCount: cat.biomarkers.length,
    outOfRange: cat.biomarkers.filter(bm => outOfRangeNames.has(bm.name.toLowerCase())).length,
  }));

  return text(categories);
}));

// ── Change Detection Tools ──

server.registerTool("function_health_changes", {
  title: "Compare Visits",
  description: "Compare results between visits to see what improved, worsened, or changed significantly",
  inputSchema: z.object({
    from_visit: z.string().optional().describe("From visit date YYYY-MM-DD (defaults to previous)"),
    to_visit: z.string().optional().describe("To visit date YYYY-MM-DD (defaults to latest)"),
  }),
}, safeTool(async ({ from_visit, to_visit }) => {
  const exports = await listExports();
  if (exports.length < 2) return text({ error: "Need at least 2 exports to compare. Run function_health_sync." });

  const fromDate = from_visit ?? exports[exports.length - 2];
  const toDate = to_visit ?? exports[exports.length - 1];

  const [fromData, toData] = await Promise.all([
    loadExport(fromDate),
    loadExport(toDate),
  ]);

  if (!fromData || !toData) return text({ error: "Could not load exports for comparison." });

  return text(diffExports(fromData, toData));
}));

server.registerTool("function_health_sync", {
  title: "Sync Data",
  description: "Pull latest data from Function Health API and store locally. Detects new results.",
  inputSchema: z.object({
    force: z.boolean().optional().describe("Re-export even if recent data exists"),
  }),
}, safeTool(async ({ force }) => {
  const syncLog = await getSyncLog();
  const lastSync = syncLog.lastSync;

  if (!force && lastSync) {
    const sinceLast = Date.now() - new Date(lastSync).getTime();
    if (sinceLast < 3600000) {
      return text({
        synced: false,
        message: `Last sync was ${Math.round(sinceLast / 60000)} minutes ago. Use force=true to re-sync.`,
        lastSync,
      });
    }
  }

  const previousResultCount = syncLog.exports.length > 0
    ? syncLog.exports[syncLog.exports.length - 1].resultCount
    : 0;

  const client = await FunctionHealthClient.create();
  const data = await client.exportAll();
  const exportDate = await saveExport(data);

  const newResults = data.results.length - previousResultCount;

  return text({
    synced: true,
    exportDate,
    resultCount: data.results.length,
    newResults: newResults > 0 ? newResults : 0,
    lastSync: new Date().toISOString(),
    hasChanges: newResults > 0,
  });
}));

server.registerTool("function_health_check", {
  title: "Check for New Results",
  description: "Quick check for new results (lightweight — checks requisition status)",
  inputSchema: z.object({}),
}, safeTool(async () => {
  const client = await FunctionHealthClient.create();
  const [pending, completed, schedules, syncLog, results] = await Promise.all([
    client.getPendingRequisitions(),
    client.getCompletedRequisitions(),
    client.getPendingSchedules(),
    getSyncLog(),
    client.getResults(),
  ]);

  const lastSync = syncLog.lastSync;

  let newResultsAvailable = false;
  if (lastSync && syncLog.exports.length > 0) {
    const lastExport = syncLog.exports[syncLog.exports.length - 1];
    newResultsAvailable = results.length > lastExport.resultCount;
  }

  return text({
    pendingRequisitions: pending.length,
    completedRequisitions: completed.length,
    pendingSchedules: schedules.length,
    lastSync: lastSync || "never",
    newResultsAvailable,
  });
}));

// ── Reference Tools ──

server.registerTool("function_health_recommendations", {
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

server.registerTool("function_health_report", {
  title: "Clinician Report",
  description: "Get the full clinician report for a visit",
  inputSchema: z.object({
    visit: z.string().optional().describe("'latest' (default) or a visit date (YYYY-MM-DD)"),
  }),
}, safeTool(async ({ visit }) => {
  const data = await resolveExport(visit);
  if (!data) return noData();

  return text(data.report);
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
