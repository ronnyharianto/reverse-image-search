import type { ImageScanResult, ScanEvent, ScanProgress } from "@/types/scanner";

/**
 * In-memory scan registry.
 *
 * Scans live in a global map (survives Next.js dev HMR). All access is
 * synchronous single-threaded Node code — no locking required.
 */

export interface ScanEntry {
  progress: ScanProgress;
  /** Result rows in discovery order. */
  results: ImageScanResult[];
  /** Dedup: normalized image URL → result index. */
  urlToResultIndex: Map<string, number>;
  /** Dedup: SHA-256 → result index (exact duplicate images). */
  shaToResultIndex: Map<string, number>;
  /** Current SHA-256 whose reverse-search result is reusable. */
  pendingSha?: string;
  /** Cancellation flag checked between work items. */
  stopRequested: boolean;
  /** Resolve function of the engine's completion promise. */
  finish?: () => void;
  /** Subscribers for SSE streaming. */
  subscribers: Set<(event: ScanEvent) => void>;
}

const globalForScans = globalThis as unknown as {
  __copyrightScannerScans?: Map<string, ScanEntry>;
};

const scans: Map<string, ScanEntry> = globalForScans.__copyrightScannerScans ?? new Map();
globalForScans.__copyrightScannerScans = scans;

export function createScanEntry(scanId: string, targetUrl: string): ScanEntry {
  const progress: ScanProgress = {
    scanId,
    targetUrl,
    state: "RUNNING",
    pagesScanned: 0,
    imagesFound: 0,
    imagesProcessed: 0,
    startedAt: new Date().toISOString(),
  };
  const entry: ScanEntry = {
    progress,
    results: [],
    urlToResultIndex: new Map(),
    shaToResultIndex: new Map(),
    stopRequested: false,
    subscribers: new Set(),
  };
  scans.set(scanId, entry);
  return entry;
}

export function getScanEntry(scanId: string): ScanEntry | undefined {
  return scans.get(scanId);
}

/** Register an SSE subscriber; returns its unsubscribe function. */
export function subscribeToScan(entry: ScanEntry, listener: (event: ScanEvent) => void): () => void {
  entry.subscribers.add(listener);
  return () => {
    entry.subscribers.delete(listener);
  };
}

export function publishEvent(entry: ScanEntry, event: ScanEvent): void {
  for (const subscriber of entry.subscribers) {
    try {
      subscriber(event);
    } catch {
      // A dead SSE connection must never break the scan.
    }
  }
}

/** Bounded store: drop the oldest finished scans; never drop running ones. */
export function pruneScans(max = 20): void {
  if (scans.size <= max) return;
  for (const [id, entry] of scans) {
    if (scans.size <= max) break;
    if (entry.progress.state !== "RUNNING") {
      scans.delete(id);
    }
  }
}
