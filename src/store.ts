import fs from "fs/promises";
import path from "path";
import os from "os";
import type { ExportData, HealthResult, SyncLog } from "./types.js";
import { deriveExportDate, isValidDateString, writeSecure, isFileNotFound, validateDate } from "./utils.js";

const DATA_DIR = path.join(os.homedir(), ".function-health");
const EXPORTS_DIR = path.join(DATA_DIR, "exports");
const LATEST_PATH = path.join(DATA_DIR, "latest.json");
const SYNC_LOG_PATH = path.join(DATA_DIR, "sync-log.json");

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/** Save an export atomically — writes to a temp directory then renames */
export async function saveExport(data: ExportData, date?: string): Promise<string> {
  const exportDate = validateDate(date ?? deriveExportDate(data, new Date().toISOString().slice(0, 10)));
  const exportDir = path.join(EXPORTS_DIR, exportDate);
  const tmpDir = `${exportDir}.tmp.${Date.now()}`;
  await ensureDir(tmpDir);

  try {
    // Write individual files to temp directory
    await Promise.all([
      writeSecure(path.join(tmpDir, "results.json"), JSON.stringify(data.results, null, 2)),
      writeSecure(path.join(tmpDir, "biomarkers.json"), JSON.stringify(data.biomarkers, null, 2)),
      writeSecure(path.join(tmpDir, "categories.json"), JSON.stringify(data.categories, null, 2)),
      writeSecure(path.join(tmpDir, "biomarker-details.json"), JSON.stringify(data.biomarkerDetails, null, 2)),
      writeSecure(path.join(tmpDir, "profile.json"), JSON.stringify(data.profile, null, 2)),
      writeSecure(path.join(tmpDir, "recommendations.json"), JSON.stringify(data.recommendations, null, 2)),
      writeSecure(path.join(tmpDir, "report.json"), JSON.stringify(data.report, null, 2)),
      writeSecure(path.join(tmpDir, "biological-age.json"), JSON.stringify(data.biologicalAge, null, 2)),
      writeSecure(path.join(tmpDir, "bmi.json"), JSON.stringify(data.bmi, null, 2)),
      writeSecure(path.join(tmpDir, "notes.json"), JSON.stringify(data.notes, null, 2)),
      writeSecure(path.join(tmpDir, "requisitions.json"), JSON.stringify(data.requisitions, null, 2)),
      writeSecure(path.join(tmpDir, "pending-schedules.json"), JSON.stringify(data.pendingSchedules, null, 2)),
    ]);

    // Move temp dir into place — rename old dir first to avoid data loss window
    const backupDir = `${exportDir}.old.${Date.now()}`;
    await fs.rename(exportDir, backupDir).catch(() => {}); // ok if doesn't exist
    await fs.rename(tmpDir, exportDir);
    await fs.rm(backupDir, { recursive: true, force: true }).catch(() => {});

    // Update latest pointer and sync log (non-atomic but non-critical)
    await Promise.all([
      writeSecure(LATEST_PATH, JSON.stringify({ date: exportDate })),
      updateSyncLog(exportDate, data.results.length),
    ]);
  } catch (err) {
    // Clean up temp dir on failure
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }

  return exportDate;
}

/** Load the most recent export (reads pointer file, then loads the export) */
export async function loadLatest(): Promise<ExportData | null> {
  try {
    const raw = await fs.readFile(LATEST_PATH, "utf-8");
    const pointer = JSON.parse(raw);

    // Support both old format (full data) and new format (pointer with date)
    if (typeof pointer?.date === "string") {
      return loadExport(pointer.date);
    }
    // Legacy: latest.json contained full export data
    if (pointer?.results) return pointer as ExportData;
    return null;
  } catch (err: unknown) {
    if (isFileNotFound(err)) return null;
    console.error("Warning: could not read latest export:", (err as Error).message);
    return null;
  }
}

/** Load a specific export by date */
export async function loadExport(date: string): Promise<ExportData | null> {
  const safeDate = validateDate(date);
  const exportDir = path.join(EXPORTS_DIR, safeDate);
  try {
    const [results, biomarkers, categories, biomarkerDetails, profile, recommendations, report, biologicalAge, bmi, notes, requisitions, pendingSchedules] = await Promise.all([
      readJson(path.join(exportDir, "results.json"), true),
      readJson(path.join(exportDir, "biomarkers.json"), true),
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
  } catch (err: unknown) {
    if (isFileNotFound(err)) return null;
    console.error(`Warning: could not load export ${safeDate}:`, (err as Error).message);
    return null;
  }
}

/** Load only results from a specific export (lightweight for history lookups) */
export async function loadExportResults(date: string): Promise<HealthResult[]> {
  const safeDate = validateDate(date);
  try {
    const raw = await fs.readFile(path.join(EXPORTS_DIR, safeDate, "results.json"), "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/** List all export dates (sorted ascending) */
export async function listExports(): Promise<string[]> {
  try {
    const entries = await fs.readdir(EXPORTS_DIR);
    return entries.filter(e => isValidDateString(e)).sort();
  } catch {
    return [];
  }
}

/** Get sync log */
export async function getSyncLog(): Promise<SyncLog> {
  try {
    const raw = await fs.readFile(SYNC_LOG_PATH, "utf-8");
    return JSON.parse(raw) as SyncLog;
  } catch (err: unknown) {
    if (!isFileNotFound(err)) {
      console.error("Warning: could not read sync log:", (err as Error).message);
    }
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
  await writeSecure(SYNC_LOG_PATH, JSON.stringify(log, null, 2));
}

async function readJson(filePath: string, required = false): Promise<unknown> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (err: unknown) {
    if (isFileNotFound(err)) return null;
    // For required files, propagate the error; for optional ones, warn and return null
    if (required) throw new Error(`Corrupt or unreadable file: ${filePath}: ${(err as Error).message}`);
    console.error(`Warning: corrupt or unreadable file: ${filePath}: ${(err as Error).message}`);
    return null;
  }
}
