import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ImageScanResult, ScanSnapshot } from "@/types/scanner";

/**
 * JSON persistence for finished scans.
 *
 * Scans live in memory (see scan-store) and are lost on server restart. This
 * module adds an explicit, user-triggered "Save result" action that writes a
 * JSON snapshot to data/results/<sanitized-url>.json (relative to the project
 * root). Saved snapshots power:
 *
 * - "View last result" for a target URL that was scanned before, and
 * - the duplicate-scan warning when the user scans the same URL again.
 *
 * The folder is gitignored (see .gitignore) — scan output never reaches Git.
 */

/** Results dir resolved per call (not at import) so tests can redirect cwd. */
export function getResultsDir(): string {
  return path.join(process.cwd(), "data", "results");
}

/** Collapse a target URL to a safe, human-readable file stem. */
export function targetUrlToFileName(targetUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    parsed = new URL("https://invalid.invalid/");
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const stem = `${parsed.pathname === "/" ? "" : parsed.pathname}`
    .replace(/\/+$/, "")
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const suffix = stem ? `-${stem}` : "";
  return `${host}${suffix}`.slice(0, 120) || "scan";
}

function getFilePath(targetUrl: string): string {
  return path.join(getResultsDir(), `${targetUrlToFileName(targetUrl)}.json`);
}

/**
 * Persist a scan snapshot, overwriting any previous snapshot for the same
 * target URL (the newest scan always wins).
 */
export async function saveScanSnapshot(snapshot: ScanSnapshot): Promise<string> {
  const filePath = getFilePath(snapshot.progress.targetUrl);
  await mkdir(getResultsDir(), { recursive: true });
  await writeFile(filePath, JSON.stringify({ savedAt: new Date().toISOString(), snapshot }, null, 2), "utf8");
  return filePath;
}

/** Load the saved snapshot for a target URL, or null when none exists. */
export async function loadScanSnapshot(targetUrl: string): Promise<ScanSnapshot | null> {
  return (await loadScanSnapshotWithTimestamp(targetUrl)).snapshot;
}

/**
 * Load a snapshot together with the `savedAt` timestamp recorded in its file.
 * `savedAt` is null for legacy files that predate timestamping or on read
 * errors; the snapshot itself is still returned when parseable.
 */
export async function loadScanSnapshotWithTimestamp(
  targetUrl: string,
): Promise<{ snapshot: ScanSnapshot | null; savedAt: string | null }> {
  try {
    const raw = await readFile(getFilePath(targetUrl), "utf8");
    const payload = JSON.parse(raw) as { savedAt?: string; snapshot?: ScanSnapshot };
    if (!payload.snapshot?.progress?.scanId) return { snapshot: null, savedAt: null };
    return {
      snapshot: payload.snapshot,
      savedAt: typeof payload.savedAt === "string" ? payload.savedAt : null,
    };
  } catch {
    return { snapshot: null, savedAt: null };
  }
}

/** Delete the saved snapshot for a target URL; false when there was none. */
export async function deleteScanSnapshot(targetUrl: string): Promise<boolean> {
  try {
    await unlink(getFilePath(targetUrl));
    return true;
  } catch {
    return false;
  }
}

/**
 * Find the saved snapshot file whose progress.scanId matches. Saved files
 * are named after the target URL, not the scan id, so the folder must be
 * scanned for a match.
 */
async function findSavedFilePathByScanId(scanId: string): Promise<string | null> {
  let files: string[];
  try {
    files = await readdir(getResultsDir());
  } catch {
    return null;
  }

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const filePath = path.join(getResultsDir(), file);
    try {
      const payload = JSON.parse(await readFile(filePath, "utf8")) as {
        snapshot?: { progress?: { scanId?: string } };
      };
      if (payload.snapshot?.progress?.scanId === scanId) return filePath;
    } catch {
      // Skip unreadable/corrupt files.
    }
  }
  return null;
}

/**
 * Find the saved snapshot belonging to a scan id and return its raw file
 * contents; null when no saved file matches (or the folder is missing).
 */
export async function findSavedSnapshotByScanId(scanId: string): Promise<string | null> {
  const filePath = await findSavedFilePathByScanId(scanId);
  if (!filePath) return null;
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

/**
 * Locate the saved snapshot file that belongs to a scan id and overwrite its
 * results in place. Returns the file path on success, null when no saved file
 * matches (live scans that were never auto-saved keep their retry results in
 * memory only).
 */
export async function updateSavedSnapshotByScanId(
  scanId: string,
  results: ImageScanResult[],
): Promise<string | null> {
  const filePath = await findSavedFilePathByScanId(scanId);
  if (!filePath) return null;

  try {
    const payload = JSON.parse(await readFile(filePath, "utf8")) as {
      savedAt?: string;
      snapshot?: ScanSnapshot;
    };
    if (!payload.snapshot) return null;

    payload.snapshot.results = results;
    payload.savedAt = new Date().toISOString();
    await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
    return filePath;
  } catch {
    return null;
  }
}
