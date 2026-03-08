import fs from "fs/promises";
import path from "path";
import os from "os";
import type { ExportData, HealthResult, SyncLog } from "./types.js";
import { deriveExportDate } from "./utils.js";

const DATA_DIR = path.join(os.homedir(), ".function-health");
const EXPORTS_DIR = path.join(DATA_DIR, "exports");
const LATEST_PATH = path.join(DATA_DIR, "latest.json");
const SYNC_LOG_PATH = path.join(DATA_DIR, "sync-log.json");

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/** Save an export, versioned by date */
export async function saveExport(data: ExportData, date?: string): Promise<string> {
  const exportDate = date ?? deriveExportDate(data, new Date().toISOString().slice(0, 10));
  const exportDir = path.join(EXPORTS_DIR, exportDate);
  await ensureDir(exportDir);

  // Write individual files, latest.json, and sync log in parallel
  await Promise.all([
    fs.writeFile(path.join(exportDir, "results.json"), JSON.stringify(data.results, null, 2)),
    fs.writeFile(path.join(exportDir, "biomarkers.json"), JSON.stringify(data.biomarkers, null, 2)),
    fs.writeFile(path.join(exportDir, "categories.json"), JSON.stringify(data.categories, null, 2)),
    fs.writeFile(path.join(exportDir, "biomarker-details.json"), JSON.stringify(data.biomarkerDetails, null, 2)),
    fs.writeFile(path.join(exportDir, "profile.json"), JSON.stringify(data.profile, null, 2)),
    fs.writeFile(path.join(exportDir, "recommendations.json"), JSON.stringify(data.recommendations, null, 2)),
    fs.writeFile(path.join(exportDir, "report.json"), JSON.stringify(data.report, null, 2)),
    fs.writeFile(path.join(exportDir, "biological-age.json"), JSON.stringify(data.biologicalAge, null, 2)),
    fs.writeFile(path.join(exportDir, "bmi.json"), JSON.stringify(data.bmi, null, 2)),
    fs.writeFile(path.join(exportDir, "notes.json"), JSON.stringify(data.notes, null, 2)),
    fs.writeFile(path.join(exportDir, "requisitions.json"), JSON.stringify(data.requisitions, null, 2)),
    fs.writeFile(path.join(exportDir, "pending-schedules.json"), JSON.stringify(data.pendingSchedules, null, 2)),
    fs.writeFile(LATEST_PATH, JSON.stringify(data, null, 2)),
    updateSyncLog(exportDate, data.results.length),
  ]);

  return exportDate;
}

/** Load the most recent export */
export async function loadLatest(): Promise<ExportData | null> {
  try {
    const raw = await fs.readFile(LATEST_PATH, "utf-8");
    return JSON.parse(raw) as ExportData;
  } catch {
    return null;
  }
}

/** Load a specific export by date */
export async function loadExport(date: string): Promise<ExportData | null> {
  const exportDir = path.join(EXPORTS_DIR, date);
  try {
    const [results, biomarkers, categories, biomarkerDetails, profile, recommendations, report, biologicalAge, bmi, notes, requisitions, pendingSchedules] = await Promise.all([
      readJson(path.join(exportDir, "results.json")),
      readJson(path.join(exportDir, "biomarkers.json")),
      readJson(path.join(exportDir, "categories.json")),
      readJson(path.join(exportDir, "biomarker-details.json")),
      readJson(path.join(exportDir, "profile.json")),
      readJson(path.join(exportDir, "recommendations.json")),
      readJson(path.join(exportDir, "report.json")),
      readJson(path.join(exportDir, "biological-age.json")),
      readJson(path.join(exportDir, "bmi.json")),
      readJson(path.join(exportDir, "notes.json")),
      readJson(path.join(exportDir, "requisitions.json")),
      readJson(path.join(exportDir, "pending-schedules.json")),
    ]);

    return {
      profile,
      results: results ?? [],
      biomarkers: biomarkers ?? [],
      categories: categories ?? [],
      biomarkerDetails: biomarkerDetails ?? [],
      recommendations: recommendations ?? [],
      report,
      biologicalAge,
      bmi,
      notes: notes ?? [],
      requisitions: requisitions ?? [],
      pendingSchedules: pendingSchedules ?? [],
    } as ExportData;
  } catch {
    return null;
  }
}

/** Load only results from a specific export (lightweight for history lookups) */
export async function loadExportResults(date: string): Promise<HealthResult[]> {
  try {
    const raw = await fs.readFile(path.join(EXPORTS_DIR, date, "results.json"), "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/** List all export dates (sorted ascending) */
export async function listExports(): Promise<string[]> {
  try {
    await ensureDir(EXPORTS_DIR);
    const entries = await fs.readdir(EXPORTS_DIR);
    return entries.filter(e => /^\d{4}-\d{2}-\d{2}/.test(e)).sort();
  } catch {
    return [];
  }
}

/** Get sync log */
export async function getSyncLog(): Promise<SyncLog> {
  try {
    const raw = await fs.readFile(SYNC_LOG_PATH, "utf-8");
    return JSON.parse(raw) as SyncLog;
  } catch {
    return { lastSync: "", exports: [] };
  }
}

async function updateSyncLog(date: string, resultCount: number): Promise<void> {
  const log = await getSyncLog();
  log.lastSync = new Date().toISOString();

  const existing = log.exports.find(e => e.date === date);
  if (existing) {
    existing.resultCount = resultCount;
    existing.timestamp = log.lastSync;
  } else {
    log.exports.push({ date, resultCount, timestamp: log.lastSync });
  }

  await ensureDir(DATA_DIR);
  await fs.writeFile(SYNC_LOG_PATH, JSON.stringify(log, null, 2));
}

async function readJson(filePath: string): Promise<unknown> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
