import { randomUUID } from "node:crypto";
import type { ImageScanResult } from "@/types/scanner";
import type { ImageInput } from "@/lib/reverse-search/provider";
import { MAX_IMAGE_BYTES } from "@/types/scanner";
import { resolveAndValidateUrl } from "@/lib/validation/url";
import { downloadImage } from "@/lib/image/downloader";
import { inspectImage } from "@/lib/image/metadata";
import { fingerprintImage } from "@/lib/image/fingerprint";
import { saveThumbnail } from "@/lib/image/thumbnails";
import { getProviders, mergeProviderResults } from "@/lib/reverse-search";
import type { ScanEntry } from "@/lib/scan/scan-store";
import { publishEvent } from "@/lib/scan/scan-store";

/**
 * Per-image processing pipeline:
 * discover → dedup → download → validate → fingerprint → reverse search
 * → result row → push to UI. A failure anywhere produces a FAILED row and
 * never stops the scan.
 */

function processError(remark: string): ImageScanResult {
  return {
    id: randomUUID(),
    pageUrl: "",
    imageUrl: "",
    status: "FAILED",
    remark,
    occurrences: [],
  };
}

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
  progress.currentImage = imageUrl;
  publishEvent(entry, { type: "progress", progress: { ...progress } });

  try {
    const resolved = resolveAndValidateUrl(imageUrl, pageUrl);
    if (!resolved.ok) {
      emitFailedResult(entry, pageUrl, imageUrl, resolved.error);
      return;
    }
    const finalImageUrl = resolved.url;

    // ---- Download ----
    const download = await downloadImage(finalImageUrl);
    if (!download.ok) {
      emitFailedResult(entry, pageUrl, finalImageUrl, download.error);
      return;
    }
    if (download.data.length > MAX_IMAGE_BYTES) {
      emitFailedResult(entry, pageUrl, finalImageUrl, "Image exceeds the maximum allowed size.");
      return;
    }

    // ---- Validate ----
    const inspection = await inspectImage(download.data, download.contentType);
    if (!inspection.ok) {
      emitFailedResult(entry, pageUrl, finalImageUrl, inspection.error);
      return;
    }

    // ---- Fingerprint ----
    const fingerprint = await fingerprintImage(download.data);
    const sha256 = fingerprint.sha256;

    // ---- Exact duplicate: reuse prior search result ----
    const existingIndex = entry.shaToResultIndex.get(sha256);
    if (existingIndex !== undefined) {
      const existing = entry.results[existingIndex];
      existing.occurrences.push({ pageUrl, imageUrl: finalImageUrl });
      // Only emit the updated row once per occurrence
      publishEvent(entry, { type: "result", result: cloneResult(existing) });
      progress.imagesProcessed += 1;
      publishEvent(entry, { type: "progress", progress: { ...progress } });
      return;
    }

    // ---- Thumbnail ----
    const thumbFile = await saveThumbnail(entry.progress.scanId, sha256, download.data);
    const previewUrl = thumbFile ? `/api/images/${entry.progress.scanId}/${thumbFile}` : undefined;

    // ---- Reverse search (real providers only) ----
    const imageInput: ImageInput = {
      data: download.data,
      mimeType: inspection.mimeType,
      sha1: fingerprint.sha1,
      sha256: fingerprint.sha256,
      pageUrl,
    };

    const [commons, custom] = await Promise.all([
      providers.commons.search(imageInput),
      providers.custom ? providers.custom.search(imageInput) : Promise.resolve(null),
    ]);

    const merged = mergeProviderResults(
      commons,
      custom ?? undefined,
    );

    const result: ImageScanResult = {
      id: newId(),
      pageUrl,
      imageUrl: finalImageUrl,
      status: merged.status,
      remark: merged.remark,
      previewUrl,
      reverseSearchResults: merged.matches.length > 0 ? merged.matches : undefined,
      occurrences: [{ pageUrl, imageUrl: finalImageUrl }],
      width: inspection.width,
      height: inspection.height,
      byteSize: download.data.length,
      mimeType: inspection.mimeType,
      sha256,
    };

    entry.results.push(result);
    entry.shaToResultIndex.set(sha256, entry.results.length - 1);
    entry.urlToResultIndex.set(normalizeKey(finalImageUrl), entry.results.length - 1);

    progress.imagesProcessed += 1;
    publishEvent(entry, { type: "result", result: cloneResult(result) });
    publishEvent(entry, { type: "progress", progress: { ...progress } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitFailedResult(entry, pageUrl, imageUrl, `Processing failed: ${message.slice(0, 150)}`);
  }
}

function emitFailedResult(entry: ScanEntry, pageUrl: string, imageUrl: string, remark: string): void {
  const result = processError("");
  result.pageUrl = pageUrl;
  result.imageUrl = imageUrl;
  result.remark = remark;
  result.occurrences = [{ pageUrl, imageUrl }];
  entry.results.push(result);
  entry.progress.imagesProcessed += 1;
  publishEvent(entry, { type: "result", result: cloneResult(result) });
  publishEvent(entry, { type: "progress", progress: { ...entry.progress } });
}

function normalizeKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function cloneResult(result: ImageScanResult): ImageScanResult {
  return {
    ...result,
    occurrences: result.occurrences.map((o) => ({ ...o })),
    reverseSearchResults: result.reverseSearchResults?.map((m) => ({ ...m })),
  };
}
