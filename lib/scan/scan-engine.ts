import { randomUUID } from "node:crypto";
import type { ScanState } from "@/types/scanner";
import { IMAGE_CONCURRENCY, MAX_PAGES, MAX_CRAWL_DEPTH, PAGE_CONCURRENCY } from "@/types/scanner";
import { crawlSite } from "@/lib/crawler/crawler";
import { processImageTask, type ImageTask } from "@/lib/scan/image-processor";
import { getProviders } from "@/lib/reverse-search";
import { createScanEntry, getScanEntry, publishEvent, type ScanEntry } from "@/lib/scan/scan-store";

/**
 * Scan engine orchestrator.
 *
 * Runs the crawl and the per-image pipeline concurrently:
 * the crawler discovers pages and pushes image tasks into a per-scan queue;
 * IMAGE_CONCURRENCY workers process them one by one so results stream to
 * the UI while the scan is still running (PRD §3).
 */

interface QueuedImage {
  task: ImageTask;
}

function isStopRequested(entry: ScanEntry): boolean {
  return entry.stopRequested;
}

function finishScan(entry: ScanEntry, state: ScanState): void {
  entry.progress.state = state;
  entry.progress.finishedAt = new Date().toISOString();
  entry.progress.currentPage = undefined;
  entry.progress.currentImage = undefined;
  publishEvent(entry, { type: "done", progress: { ...entry.progress } });
  entry.finish?.();
}

async function imageWorker(
  entry: ScanEntry,
  queue: QueuedImage[],
  providers: ReturnType<typeof getProviders>,
  isCrawlDone: () => boolean,
): Promise<void> {
  for (;;) {
    if (isStopRequested(entry)) return;
    const item = queue.shift();
    if (!item) {
      // Stay alive while the crawler may still enqueue more images.
      if (isCrawlDone()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
      continue;
    }
    try {
      await processImageTask(entry, item.task, providers);
    } catch (error) {
      // processImageTask handles its own failures; this is a last resort
      console.error("[scan] image worker error:", error);
    }
  }
}

export async function startScan(targetUrl: string): Promise<string> {
  const scanId = randomUUID();
  const entry = createScanEntry(scanId, targetUrl);
  const providers = getProviders();

  // Fire-and-forget: API returns the scanId immediately, progress streams via SSE.
  void runScan(entry, providers).catch((error) => {
    console.error("[scan] fatal scan error:", error);
    if (entry.progress.state === "RUNNING") {
      finishScan(entry, "FAILED");
    }
  });

  return scanId;
}

async function runScan(entry: ScanEntry, providers: ReturnType<typeof getProviders>): Promise<void> {
  const queue: QueuedImage[] = [];
  let crawlError: string | null = null;

  try {
    const crawlerPromise = crawlSite({
      startUrl: entry.progress.targetUrl,
      maxPages: MAX_PAGES,
      maxDepth: MAX_CRAWL_DEPTH,
      concurrency: PAGE_CONCURRENCY,
      shouldStop: () => isStopRequested(entry),
      onPageStart: (pageUrl) => {
        if (isStopRequested(entry)) return;
        entry.progress.currentPage = pageUrl;
        publishEvent(entry, { type: "progress", progress: { ...entry.progress } });
      },
      onPageScanned: (pageUrl, imageUrls) => {
        if (isStopRequested(entry)) return;
        entry.progress.pagesScanned += 1;
        entry.progress.imagesFound += imageUrls.length;
        for (const imageUrl of imageUrls) {
          queue.push({ task: { pageUrl, imageUrl } });
        }
        publishEvent(entry, { type: "progress", progress: { ...entry.progress } });
      },
      onPageError: (pageUrl, message) => {
        console.warn(`[scan] page failed: ${pageUrl}: ${message}`);
      },
    }).catch((error: unknown) => {
      crawlError = error instanceof Error ? error.message : String(error);
    });

    let crawlDone = false;
    const isCrawlDone = () => crawlDone || isStopRequested(entry);
    const workers = Array.from({ length: IMAGE_CONCURRENCY }, () => imageWorker(entry, queue, providers, isCrawlDone));

    // Wait for crawl completion; workers keep draining the queue meanwhile
    await crawlerPromise;
    crawlDone = true;
    await Promise.all(workers);

    if (isStopRequested(entry)) {
      finishScan(entry, "STOPPED");
    } else if (crawlError) {
      entry.progress.currentPage = undefined;
      finishScan(entry, "FAILED");
      publishEvent(entry, { type: "error", message: crawlError });
    } else {
      finishScan(entry, "COMPLETED");
    }
  } catch (error) {
    console.error("[scan] runScan error:", error);
    if (entry.progress.state === "RUNNING") {
      finishScan(entry, "FAILED");
    }
  }
}

export function requestStop(scanId: string): boolean {
  const entry = getScanEntry(scanId);
  if (!entry) return false;
  entry.stopRequested = true;
  // The flag is checked by crawlSite and between each image task.
  return true;
}
