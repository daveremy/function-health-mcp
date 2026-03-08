#!/usr/bin/env node
import { Command } from "commander";
import { login, loadCredentials } from "./auth.js";
import { FunctionHealthClient } from "./client.js";
import { loadLatest, loadExport, saveExport, listExports, getSyncLog } from "./store.js";
import { diffExports } from "./diff.js";
import { fuzzyMatch, getResultName } from "./utils.js";
import type { ExportData } from "./types.js";

const program = new Command();

program
  .name("function-health")
  .description("Function Health lab results CLI")
  .version("0.1.0");

function requireData(data: ExportData | null): asserts data is ExportData {
  if (!data) {
    console.error("No data. Run: function-health sync");
    process.exit(1);
  }
}

// ── Auth ──

program
  .command("login")
  .description("Authenticate with Function Health")
  .option("-e, --email <email>", "Email address")
  .option("-p, --password <password>", "Password")
  .action(async (opts) => {
    const email = opts.email ?? await prompt("Email: ");
    const password = opts.password ?? await prompt("Password: ");
    try {
      const tokens = await login(email, password);
      console.log(`Logged in as ${tokens.email}`);
    } catch (err) {
      console.error("Login failed:", (err as Error).message);
      process.exit(1);
    }
  });

program
  .command("status")
  .description("Show auth status, last sync, data stats")
  .action(async () => {
    const [creds, syncLog, exports, latest] = await Promise.all([
      loadCredentials(),
      getSyncLog(),
      listExports(),
      loadLatest(),
    ]);

    console.log("Auth:", creds?.email ? `Logged in as ${creds.email}` : "Not authenticated");
    console.log("Last sync:", syncLog.lastSync || "Never");
    console.log("Exports:", exports.length, exports.length > 0 ? `(${exports[0]} to ${exports[exports.length - 1]})` : "");
    if (latest) {
      const inRange = latest.results.filter(r => r.inRange).length;
      console.log(`Latest results: ${latest.results.length} markers (${inRange} in range, ${latest.results.length - inRange} out)`);
    }
  });

// ── Sync ──

program
  .command("sync")
  .description("Pull latest data from Function Health")
  .option("-f, --force", "Re-export even if recent data exists")
  .action(async (opts) => {
    try {
      if (!opts.force) {
        const syncLog = await getSyncLog();
        if (syncLog.lastSync) {
          const sinceLast = Date.now() - new Date(syncLog.lastSync).getTime();
          if (sinceLast < 3600000) {
            console.log(`Last sync was ${Math.round(sinceLast / 60000)} minutes ago. Use --force to re-sync.`);
            return;
          }
        }
      }

      const client = await FunctionHealthClient.create();
      console.log("Syncing data from Function Health...");
      const data = await client.exportAll();
      const exportDate = await saveExport(data);
      console.log(`Export saved: ${exportDate} (${data.results.length} results)`);
    } catch (err) {
      console.error("Sync failed:", (err as Error).message);
      process.exit(1);
    }
  });

program
  .command("check")
  .description("Quick check for new results")
  .action(async () => {
    try {
      const client = await FunctionHealthClient.create();
      const [pending, completed, syncLog] = await Promise.all([
        client.getPendingRequisitions(),
        client.getCompletedRequisitions(),
        getSyncLog(),
      ]);

      console.log(`Pending requisitions: ${pending.length}`);
      console.log(`Completed requisitions: ${completed.length}`);
      console.log(`Last sync: ${syncLog.lastSync || "Never"}`);
    } catch (err) {
      console.error("Check failed:", (err as Error).message);
      process.exit(1);
    }
  });

// ── Query ──

program
  .command("results")
  .description("Query lab results")
  .option("-b, --biomarker <name>", "Filter by biomarker name")
  .option("-c, --category <name>", "Filter by category")
  .option("-s, --status <status>", "Filter: in_range, out_of_range, all")
  .action(async (opts) => {
    const data = await loadLatest();
    requireData(data);

    let results = data.results;

    if (opts.biomarker) {
      results = results.filter(r => {
        const name = getResultName(r);
        return name ? fuzzyMatch(opts.biomarker, name) : false;
      });
    }

    if (opts.status === "in_range") results = results.filter(r => r.inRange);
    else if (opts.status === "out_of_range") results = results.filter(r => !r.inRange);

    console.log(JSON.stringify(results.map(r => ({
      name: getResultName(r),
      value: r.displayResult || r.calculatedResult,
      inRange: r.inRange,
      date: r.dateOfService,
    })), null, 2));
  });

program
  .command("biomarker <name>")
  .description("Deep dive on a specific biomarker")
  .action(async (name) => {
    const data = await loadLatest();
    requireData(data);

    const bm = data.biomarkers.find(b => fuzzyMatch(name, b.name));
    if (!bm) { console.error(`No biomarker matching "${name}"`); process.exit(1); }

    const result = data.results.find(r => {
      const rName = getResultName(r);
      return rName ? fuzzyMatch(bm.name, rName) : false;
    });

    const detail = data.biomarkerDetails.find(d => fuzzyMatch(bm.name, d.name));
    const sexDetail = bm.sexDetails[0];

    console.log(`\n${bm.name}`);
    console.log(`Value: ${result?.displayResult || result?.calculatedResult || "N/A"} (${result?.inRange ? "In Range" : "Out of Range"})`);
    if (sexDetail) {
      console.log(`Optimal: ${sexDetail.optimalRangeLow} - ${sexDetail.optimalRangeHigh}`);
    }
    if (detail) {
      console.log(`\n${detail.oneLineDescription}`);
      if (detail.whyItMatters) console.log(`\nWhy it matters: ${detail.whyItMatters}`);
      if (detail.recommendations) console.log(`\nRecommendations: ${detail.recommendations}`);
    }
  });

program
  .command("summary")
  .description("High-level health summary")
  .action(async () => {
    const data = await loadLatest();
    requireData(data);

    const total = data.results.length;
    const inRange = data.results.filter(r => r.inRange).length;

    console.log(`\nHealth Summary`);
    console.log(`Total markers: ${total}`);
    console.log(`In range: ${inRange} (${total > 0 ? Math.round(inRange / total * 100) : 0}%)`);
    console.log(`Out of range: ${total - inRange}`);

    if (data.biologicalAge) console.log(`Biological age:`, JSON.stringify(data.biologicalAge));
    if (data.bmi) console.log(`BMI:`, JSON.stringify(data.bmi));

    const outOfRange = data.results.filter(r => !r.inRange);
    if (outOfRange.length > 0) {
      console.log(`\nOut of range markers:`);
      for (const r of outOfRange) {
        console.log(`  - ${getResultName(r) || "Unknown"}: ${r.displayResult || r.calculatedResult}`);
      }
    }
  });

program
  .command("categories")
  .description("List biomarker categories")
  .action(async () => {
    const data = await loadLatest();
    requireData(data);

    // Pre-build set of out-of-range names for O(1) lookup
    const outOfRangeNames = new Set<string>();
    for (const r of data.results) {
      if (!r.inRange) {
        const name = getResultName(r);
        if (name) outOfRangeNames.add(name.toLowerCase());
      }
    }

    for (const cat of data.categories) {
      const outCount = cat.biomarkers.filter(bm => outOfRangeNames.has(bm.name.toLowerCase())).length;
      console.log(`${cat.categoryName}: ${cat.biomarkers.length} markers, ${outCount} out of range`);
    }
  });

// ── Changes ──

program
  .command("changes")
  .description("Compare results between visits")
  .option("--from <date>", "From visit date")
  .option("--to <date>", "To visit date")
  .action(async (opts) => {
    const exports = await listExports();
    if (exports.length < 2) { console.error("Need at least 2 exports to compare."); process.exit(1); }

    const fromDate = opts.from ?? exports[exports.length - 2];
    const toDate = opts.to ?? exports[exports.length - 1];

    const [fromData, toData] = await Promise.all([
      loadExport(fromDate),
      loadExport(toDate),
    ]);

    if (!fromData || !toData) { console.error("Could not load exports."); process.exit(1); }

    const diff = diffExports(fromData, toData);
    console.log(JSON.stringify(diff, null, 2));
  });

// ── Export ──

program
  .command("export")
  .description("Full JSON export")
  .option("-m, --markdown", "Generate Markdown reports")
  .option("-o, --output <dir>", "Output directory", "function-health-export")
  .action(async (opts) => {
    try {
      const client = await FunctionHealthClient.create();
      console.log("Exporting data...");
      const data = await client.exportAll();

      const exportDate = await saveExport(data);
      console.log(`Data exported and stored (${exportDate})`);

      if (opts.markdown) {
        console.log("Markdown export not yet implemented.");
      }
    } catch (err) {
      console.error("Export failed:", (err as Error).message);
      process.exit(1);
    }
  });

// ── Helpers ──

async function prompt(message: string): Promise<string> {
  const { createInterface } = await import("readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

program.parse();
