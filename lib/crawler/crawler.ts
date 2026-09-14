import { chromium, type Browser } from "playwright";
import {
  PAGE_TIMEOUT_MS,
  PAGE_CONCURRENCY,
} from "@/types/scanner";
import {
  isSameSite,
  normalizeUrlForComparison,
  resolveAndValidateUrl,
  validateUrlWithDns,
} from "@/lib/validation/url";
import {
  collectImageElementsInPage,
  selectImageUrl,
} from "@/lib/crawler/image-extractor";

export interface CrawlerCallbacks {
  onPageStart(pageUrl: string): void;
  onPageScanned(pageUrl: string, imageUrls: string[]): void;
  onPageError(pageUrl: string, error: string): void;
  shouldStop(): boolean;
}

export interface CrawlerOptions extends CrawlerCallbacks {
  startUrl: string;
  maxPages: number;
  maxDepth: number;
  concurrency?: number;
}

export interface CrawlSummary {
  pagesScanned: number;
  pagesFailed: number;
  uniqueImageUrls: number;
}

interface QueueItem {
  url: string;
  depth: number;
}

/**
 * Breadth-first crawl of the target site.
 *
 * - Stays on the target domain (www-equivalence).
 * - Respects maxPages / maxDepth / concurrency.
 * - Validates every URL (incl. DNS) before fetching.
 * - Emits validated absolute image URLs per page as soon as the page is read,
 *   so the caller can start processing images while crawling continues.
 */
export async function crawlSite(options: CrawlerOptions): Promise<CrawlSummary> {
  const { startUrl, maxPages, maxDepth } = options;
  const concurrency = Math.max(1, Math.min(options.concurrency ?? PAGE_CONCURRENCY, 8));

  const start = await validateUrlWithDns(startUrl);
  if (!start.ok) {
    throw new Error(`Invalid start URL: ${start.error}`);
  }

  const startNormalized = normalizeUrlForComparison(start.url);
  const visited = new Set<string>([startNormalized]);
  const queue: QueueItem[] = [{ url: start.url, depth: 0 }];
  const seenImages = new Set<string>();

  let pagesScanned = 0;
  let pagesFailed = 0;
  let inFlightPages = 0;

  const enqueueCandidate = (href: string, pageUrl: string, depth: number): void => {
    if (visited.size >= maxPages) return;
    const resolved = resolveAndValidateUrl(href, pageUrl);
    if (!resolved.ok) return;
    if (!isSameSite(resolved.url, start.url)) return;
    const normalized = normalizeUrlForComparison(resolved.url);
    if (visited.has(normalized)) return;
    // Reject obvious non-HTML resources as crawl targets
    if (/\.(jpg|jpeg|png|gif|webp|avif|svg|ico|pdf|zip|css|js|mp4|webm|woff2?|ttf|eot)(\?|$)/i.test(normalized)) {
      return;
    }
    visited.add(normalized);
    queue.push({ url: resolved.url, depth });
  };

  const extractImages = async (page: import("playwright").Page, pageUrl: string): Promise<string[]> => {
    const elements = await page.evaluate(collectImageElementsInPage);
    const urls: string[] = [];
    const seenOnPage = new Set<string>();
    for (const element of elements) {
      const selected = selectImageUrl(element, pageUrl);
      if (!selected.ok) continue;
      if (seenOnPage.has(selected.url)) continue;
      seenOnPage.add(selected.url);
      urls.push(selected.url);
    }
    return urls;
  };

  const processPage = async (browser: Browser, item: QueueItem): Promise<void> => {
    const { url: pageUrl } = item;
    if (options.shouldStop()) return;

    // Re-validate with DNS right before navigating (guards rebinding)
    const safe = await validateUrlWithDns(pageUrl);
    if (!safe.ok) {
      options.onPageError(pageUrl, safe.error);
      return;
    }

    options.onPageStart(pageUrl);
    let page: import("playwright").Page | undefined;
    try {
      page = await browser.newPage();
      page.setDefaultTimeout(PAGE_TIMEOUT_MS);
      await page.goto(pageUrl, { waitUntil: "load", timeout: PAGE_TIMEOUT_MS });
      if (options.shouldStop()) return;

      // Give late hydration / lazy scripts a moment to run
      await page.waitForLoadState("domcontentloaded").catch(() => undefined);

      const finalUrl = page.url();
      const imageUrls = await extractImages(page, finalUrl);
      if (options.shouldStop()) return;

      for (const imageUrl of imageUrls) {
        if (!seenImages.has(imageUrl)) seenImages.add(imageUrl);
      }
      pagesScanned += 1;
      options.onPageScanned(finalUrl, imageUrls);

      // Discover links for further crawling
      if (item.depth + 1 <= maxDepth && visited.size < maxPages && !options.shouldStop()) {
        const hrefs = await page.$$eval("a[href]", (anchors) =>
          anchors.map((a) => a.getAttribute("href")).filter((h): h is string => Boolean(h)),
        );
        for (const href of hrefs) {
          enqueueCandidate(href, finalUrl, item.depth + 1);
        }
      }
    } catch (error) {
      pagesFailed += 1;
      const message = error instanceof Error ? error.message : String(error);
      options.onPageError(pageUrl, message.slice(0, 300));
    } finally {
      await page?.close().catch(() => undefined);
    }
  };

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });

    // Shared worker pool over the BFS queue.
    // Termination: a worker that finds the queue empty waits briefly for the
    // in-flight pages to enqueue more links; it exits when nothing is queued
    // AND nothing is in flight.
    const worker = async (): Promise<void> => {
      try {
        while (!options.shouldStop()) {
          const item = queue.shift();
          if (!item) {
            if (inFlightPages === 0) return;
            await new Promise((resolve) => setTimeout(resolve, 100));
            continue;
          }
          inFlightPages += 1;
          try {
            await processPage(browser as Browser, item);
          } finally {
            inFlightPages -= 1;
          }
        }
      } catch (error) {
        // A crashing worker must not take down the whole crawl.
        console.error("[crawler] worker crashed:", error);
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  } finally {
    await browser?.close().catch(() => undefined);
  }

  return { pagesScanned, pagesFailed, uniqueImageUrls: seenImages.size };
}
