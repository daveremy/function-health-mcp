import fs from "fs/promises";
import path from "path";
import os from "os";
import type { ExportData, HealthResult, RoundMeta, SyncLog } from "./types.js";
import { deriveExportDate, isValidDateString, writeSecure, isFileNotFound, validateDate, DIR_MODE, groupByRound, extractRequisitionId, extractVisitDates, today } from "./utils.js";

const DATA_DIR = path.join(os.homedir(), ".function-health");
const EXPORTS_DIR = path.join(DATA_DIR, "exports");
const LATEST_PATH = path.join(DATA_DIR, "latest.json");
const SYNC_LOG_PATH = path.join(DATA_DIR, "sync-log.json");

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: DIR_MODE });
}

/** Save an export atomically — writes to a temp directory then renames */
export async function saveExport(data: ExportData, date?: string): Promise<string> {
  const exportDate = validateDate(date ?? deriveExportDate(data, today()));
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
    try {
      await fs.rename(tmpDir, exportDir);
    } catch (renameErr) {
      // Restore backup if the final rename fails
      await fs.rename(backupDir, exportDir).catch(() => {});
      throw renameErr;
    }
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

/** Save an export grouped by test round (requisitionId).
 *  Merges results sharing a requisitionId into a single directory keyed by earliest visit date.
 *  Writes round-meta.json alongside export files. Returns sorted list of saved round dates. */
export async function saveRoundExport(data: ExportData): Promise<string[]> {
  const rounds = groupByRound(data);
  const usedDates = new Set<string>();
  const dates: string[] = [];

  for (const [dateKey, roundData] of rounds) {
    // Resolve date collision: if two rounds share the same earliest date,
    // check round-meta.json on disk. If a different requisitionId owns that dir,
    // find the next available date by incrementing the day.
    let resolvedDate = dateKey;
    if (usedDates.has(resolvedDate)) {
      resolvedDate = nextAvailableDate(resolvedDate, usedDates);
    }
    usedDates.add(resolvedDate);

    await saveExport(roundData, resolvedDate);

    const meta = buildRoundMeta(roundData.results);
    const metaPath = path.join(EXPORTS_DIR, resolvedDate, "round-meta.json");
    await writeSecure(metaPath, JSON.stringify(meta, null, 2));

    dates.push(resolvedDate);
  }

  const sorted = dates.sort();

  // Point latest.json to the most recent round
  if (sorted.length > 0) {
    await writeSecure(LATEST_PATH, JSON.stringify({ date: sorted[sorted.length - 1] }));
  }

  return sorted;
}

/** Find the next available date by incrementing the day until no collision */
function nextAvailableDate(date: string, used: Set<string>): string {
  const d = new Date(date + "T00:00:00Z");
  do {
    d.setUTCDate(d.getUTCDate() + 1);
    const candidate = d.toISOString().slice(0, 10);
    if (!used.has(candidate)) return candidate;
  } while (true);
}

/** Build a RoundMeta from a set of results */
function buildRoundMeta(results: HealthResult[]): RoundMeta {
  return {
    requisitionId: extractRequisitionId(results),
    visitDates: extractVisitDates(results),
    resultCount: results.length,
    lastUpdated: new Date().toISOString(),
  };
}

/** Load round metadata for a given export date */
export async function loadRoundMeta(date: string): Promise<RoundMeta | null> {
  try {
    const metaPath = path.join(EXPORTS_DIR, date, "round-meta.json");
    const raw = await fs.readFile(metaPath, "utf-8");
    return JSON.parse(raw) as RoundMeta;
  } catch {
    return null;
  }
}

/** Migrate old per-visit exports to round-based exports.
 *  Idempotent: detects un-migrated directories (no round-meta.json),
 *  groups by requisitionId, merges into earliest-date directories. */
export async function migrateToRounds(): Promise<void> {
  const allDates = await listExports();
  if (allDates.length === 0) return;

  // Parallel load: results + round-meta for all directories
  const dirData = await Promise.all(allDates.map(async (date) => {
    const [meta, results] = await Promise.all([loadRoundMeta(date), loadExportResults(date)]);
    return { date, results, meta, fullData: null as ExportData | null };
  }));

  // Fast path: if all directories already have round-meta, nothing to migrate
  if (dirData.every(d => d.meta !== null)) return;

  // Group directories by requisitionId
  const groups = new Map<string, typeof dirData>();
  for (const dir of dirData) {
    const reqId = dir.meta?.requisitionId || extractRequisitionId(dir.results);
    if (!reqId) {
      if (!dir.meta) {
        const meta = buildRoundMeta(dir.results);
        const metaPath = path.join(EXPORTS_DIR, dir.date, "round-meta.json");
        await writeSecure(metaPath, JSON.stringify(meta, null, 2));
      }
      continue;
    }
    const list = groups.get(reqId);
    if (list) list.push(dir);
    else groups.set(reqId, [dir]);
  }

  let latestChanged = false;
  const latestPointer = await readLatestPointer();

  for (const [reqId, dirs] of groups) {
    if (dirs.length === 1 && dirs[0].meta) continue;

    // Load full data for directories that need merging (parallel)
    await Promise.all(dirs.map(async (dir) => {
      dir.fullData = await loadExport(dir.date);
    }));

    const targetDate = dirs.map(d => d.date).sort()[0];

    // Merge results (deduplicate by id)
    const resultMap = new Map<string, HealthResult>();
    for (const dir of dirs) {
      for (const r of dir.results) {
        resultMap.set(r.id, r);
      }
    }

    // Merge biomarkerDetails (deduplicate by name)
    const detailMap = new Map<string, unknown>();
    for (const dir of dirs) {
      if (dir.fullData) {
        for (const d of dir.fullData.biomarkerDetails) {
          detailMap.set(d.name.toLowerCase(), d);
        }
      }
    }

    const richest = dirs.reduce((a, b) => (a.results.length >= b.results.length ? a : b));
    if (!richest.fullData) {
      console.error(`Warning: could not load export for ${richest.date}, skipping migration of requisition ${reqId}`);
      continue;
    }
    const mergedData: ExportData = {
      ...richest.fullData,
      results: [...resultMap.values()],
      biomarkerDetails: [...detailMap.values()] as ExportData["biomarkerDetails"],
    };

    await saveExport(mergedData, targetDate);

    const meta: RoundMeta = { ...buildRoundMeta(mergedData.results), requisitionId: reqId };
    const metaPath = path.join(EXPORTS_DIR, targetDate, "round-meta.json");
    await writeSecure(metaPath, JSON.stringify(meta, null, 2));

    for (const dir of dirs) {
      if (dir.date !== targetDate) {
        const dirPath = path.join(EXPORTS_DIR, dir.date);
        const backupPath = `${dirPath}.migrated.${Date.now()}`;
        try {
          await fs.rename(dirPath, backupPath);
          await fs.rm(backupPath, { recursive: true, force: true });
        } catch {
          // Best-effort cleanup — directory may already be gone
        }
        if (latestPointer === dir.date) latestChanged = true;
      }
    }
  }

  if (latestChanged) {
    const remaining = await listExports();
    if (remaining.length > 0) {
      await writeSecure(LATEST_PATH, JSON.stringify({ date: remaining[remaining.length - 1] }));
    }
  }

  await rebuildSyncLog();
}

/** Update the requisition count in the sync log (separate from per-export tracking) */
export async function updateRequisitionCount(count: number): Promise<void> {
  const log = await getSyncLog();
  log.requisitionCount = count;
  await ensureDir(DATA_DIR);
  await writeSecure(SYNC_LOG_PATH, JSON.stringify(log, null, 2));
}

/** Load the most recent export (reads pointer file, then loads the export) */
export async function loadLatest(): Promise<ExportData | null> {
  const pointer = await readLatestPointer();
  if (pointer) return loadExport(pointer);

  // Legacy fallback: latest.json might contain full export data
  try {
    const raw = await fs.readFile(LATEST_PATH, "utf-8");
    const data = JSON.parse(raw);
    if (data?.results) return data as ExportData;
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

async function readLatestPointer(): Promise<string | null> {
  try {
    const raw = await fs.readFile(LATEST_PATH, "utf-8");
    const pointer = JSON.parse(raw);
    return typeof pointer?.date === "string" ? pointer.date : null;
  } catch {
    return null;
  }
}

async function rebuildSyncLog(): Promise<void> {
  const dates = await listExports();
  const log = await getSyncLog();
  const now = new Date().toISOString();

  const entries = await Promise.all(dates.map(async (date) => {
    const meta = await loadRoundMeta(date);
    return {
      date,
      requisitionId: meta?.requisitionId,
      resultCount: meta?.resultCount ?? 0,
      timestamp: meta?.lastUpdated ?? log.lastSync ?? now,
    };
  }));

  log.exports = entries;
  await ensureDir(DATA_DIR);
  await writeSecure(SYNC_LOG_PATH, JSON.stringify(log, null, 2));
}

async function readJson(filePath: string, required = false): Promise<unknown> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (err: unknown) {
    if (required) throw new Error(`Missing or corrupt file: ${filePath}: ${(err as Error).message}`);
    if (isFileNotFound(err)) return null;
    console.error(`Warning: corrupt or unreadable file: ${filePath}: ${(err as Error).message}`);
    return null;
  }
}
