import { randomUUID } from "node:crypto";
import type { ImageScanResult } from "@/types/scanner";
import type { ImageInput } from "@/lib/reverse-search/provider";
import { MAX_IMAGE_BYTES } from "@/types/scanner";
import { resolveAndValidateUrl } from "@/lib/validation/url";
import { downloadImage } from "@/lib/image/downloader";
import { inspectImage, isSupportedImageBytes } from "@/lib/image/metadata";
import { fingerprintImage } from "@/lib/image/fingerprint";
import { saveThumbnail } from "@/lib/image/thumbnails";
import { getProviders, mergeProviderResults, summarizeProviderOutcomes } from "@/lib/reverse-search";
import { categorizeSourceUrl } from "@/lib/match-categorization";
import type { ReverseImageSearchProvider } from "@/lib/reverse-search/provider";
import type { ScanEntry } from "@/lib/scan/scan-store";
import { publishEvent } from "@/lib/scan/scan-store";

/**
 * Per-image processing pipeline (unique-image counting):
 * the same URL or the same bytes produce ONE result row; every page an image
 * appears on is recorded in that row's occurrences list. A failure anywhere
 * produces a FAILED row and never stops the scan.
 */

function newId(): string {
  return randomUUID();
}

export interface ImageTask {
  pageUrl: string;
  imageUrl: string;
}

export async function processImageTask(
  entry: ScanEntry,
  task: ImageTask,
  providers: ReturnType<typeof getProviders>,
): Promise<void> {
  const { pageUrl, imageUrl } = task;
  const progress = entry.progress;

  // Already have a row for this image URL? Attach this page and stop —
  // the image was already counted as found/processed.
  const existingByUrl = entry.urlToResultIndex.get(imageUrl);
  if (existingByUrl !== undefined) {
    attachOccurrence(entry, existingByUrl, pageUrl, imageUrl);
    return;
  }

  progress.currentImage = imageUrl;
  publishEvent(entry, { type: "progress", progress: { ...progress } });

  try {
    const resolved = resolveAndValidateUrl(imageUrl, pageUrl);
    if (!resolved.ok) {
      emitFailedResult(entry, pageUrl, imageUrl, resolved.error);
      return;
    }
    const finalImageUrl = resolved.url;

    // Redirect-normalized URL already known? Merge into that row.
    if (finalImageUrl !== imageUrl && entry.urlToResultIndex.has(finalImageUrl)) {
      const index = entry.urlToResultIndex.get(finalImageUrl)!;
      entry.urlToResultIndex.set(imageUrl, index);
      attachOccurrence(entry, index, pageUrl, finalImageUrl);
      return;
    }

    const download = await downloadImage(finalImageUrl);
    if (!download.ok) {
      emitFailedResult(entry, pageUrl, finalImageUrl, download.error);
      return;
    }
    if (download.data.length > MAX_IMAGE_BYTES) {
      emitFailedResult(entry, pageUrl, finalImageUrl, "Image exceeds the maximum allowed size.");
      return;
    }

    // Cheap pre-check before hashing: repeated identical-format failures
    // should not create extra work per page.
    const sniffedFormat = isSupportedImageBytes(download.data);
    if (sniffedFormat === null) {
      emitFailedResult(
        entry,
        pageUrl,
        finalImageUrl,
        "Unsupported image format (only JPEG, PNG, WebP, GIF and AVIF are supported).",
      );
      return;
    }

    const fingerprint = await fingerprintImage(download.data);
    const sha256 = fingerprint.sha256;

    // Same bytes already fully processed? Merge into that row.
    const existingIndex = entry.shaToResultIndex.get(sha256);
    if (existingIndex !== undefined) {
      entry.urlToResultIndex.set(imageUrl, existingIndex);
      if (finalImageUrl !== imageUrl) entry.urlToResultIndex.set(finalImageUrl, existingIndex);
      attachOccurrence(entry, existingIndex, pageUrl, finalImageUrl);
      return;
    }

    // Same bytes currently being processed by another worker? Wait for it.
    const pending = entry.pendingShas.get(sha256);
    if (pending) {
      const announced = await pending;
      const target = announced >= 0 ? announced : entry.shaToResultIndex.get(sha256);
      if (target !== undefined) {
        entry.urlToResultIndex.set(imageUrl, target);
        if (finalImageUrl !== imageUrl) entry.urlToResultIndex.set(finalImageUrl, target);
        attachOccurrence(entry, target, pageUrl, finalImageUrl);
        return;
      }
    }

    // Claim this SHA while we search, so identical concurrent bytes merge
    // into one row instead of racing.
    let releaseClaim!: (index: number) => void;
    const claim = new Promise<number>((resolve) => {
      releaseClaim = resolve;
    });
    entry.pendingShas.set(sha256, claim);

    let rowIndex = -1;
    try {
      const inspection = await inspectImage(download.data, download.contentType);
      if (!inspection.ok) {
        rowIndex = emitFailedResult(entry, pageUrl, finalImageUrl, inspection.error);
        return;
      }

      const thumbFile = await saveThumbnail(entry.progress.scanId, sha256, download.data);
      const previewUrl = thumbFile ? `/api/images/${entry.progress.scanId}/${thumbFile}` : undefined;

      const imageInput: ImageInput = {
        data: download.data,
        mimeType: inspection.mimeType,
        sha1: fingerprint.sha1,
        sha256: fingerprint.sha256,
        pageUrl,
        imageUrl: finalImageUrl,
      };

      // Run every enabled provider concurrently and merge the results.
      const providersList: ReverseImageSearchProvider[] = Object.values(providers).filter(
        (provider): provider is ReverseImageSearchProvider => provider !== undefined,
      );
      const providerResults = await Promise.all(providersList.map((provider) => provider.search(imageInput)));
      const merged = mergeProviderResults(...providerResults);
      const providerOutcomes = summarizeProviderOutcomes(providersList, providerResults);
      // Tag each match with its source-domain category (free media, stock, …).
      const matches = merged.matches.map((match) => ({
        ...match,
        category: categorizeSourceUrl(match.sourceUrl),
      }));

      const result: ImageScanResult = {
        id: newId(),
        pageUrl,
        imageUrl: finalImageUrl,
        status: merged.status,
        remark: merged.remark,
        previewUrl,
        reverseSearchResults: matches.length > 0 ? matches : undefined,
        providerOutcomes: providerOutcomes.length > 0 ? providerOutcomes : undefined,
        occurrences: [{ pageUrl, imageUrl: finalImageUrl }],
        width: inspection.width,
        height: inspection.height,
        byteSize: download.data.length,
        mimeType: inspection.mimeType,
        sha256,
      };

      entry.results.push(result);
      rowIndex = entry.results.length - 1;
      entry.shaToResultIndex.set(sha256, rowIndex);
      entry.urlToResultIndex.set(imageUrl, rowIndex);
      if (finalImageUrl !== imageUrl) entry.urlToResultIndex.set(finalImageUrl, rowIndex);

      progress.imagesProcessed += 1;
      publishEvent(entry, { type: "result", result: cloneResult(result) });
      publishEvent(entry, { type: "progress", progress: { ...progress } });
    } finally {
      entry.pendingShas.delete(sha256);
      releaseClaim(rowIndex);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitFailedResult(entry, pageUrl, imageUrl, `Processing failed: ${message.slice(0, 150)}`);
  }
}

/** Add one more (page, image) occurrence to an existing row and push the update. */
function attachOccurrence(entry: ScanEntry, rowIndex: number, pageUrl: string, imageUrl: string): void {
  const row = entry.results[rowIndex];
  if (!row) return;
  const alreadyListed = row.occurrences.some((o) => o.pageUrl === pageUrl && o.imageUrl === imageUrl);
  if (alreadyListed) return;
  row.occurrences.push({ pageUrl, imageUrl });
  publishEvent(entry, { type: "result", result: cloneResult(row) });
}

/** Create a FAILED row; returns its index so callers can keep URL mappings. */
function emitFailedResult(entry: ScanEntry, pageUrl: string, imageUrl: string, remark: string): number {
  const result: ImageScanResult = {
    id: newId(),
    pageUrl,
    imageUrl,
    status: "FAILED",
    remark,
    occurrences: [{ pageUrl, imageUrl }],
  };
  entry.results.push(result);
  entry.progress.imagesProcessed += 1;
  const index = entry.results.length - 1;
  entry.urlToResultIndex.set(imageUrl, index);
  publishEvent(entry, { type: "result", result: cloneResult(result) });
  publishEvent(entry, { type: "progress", progress: { ...entry.progress } });
  return index;
}

function cloneResult(result: ImageScanResult): ImageScanResult {
  return {
    ...result,
    occurrences: result.occurrences.map((o) => ({ ...o })),
    reverseSearchResults: result.reverseSearchResults?.map((m) => ({ ...m })),
    providerOutcomes: result.providerOutcomes?.map((o) => ({ ...o })),
  };
}
