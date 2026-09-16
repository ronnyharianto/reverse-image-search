import type { ImageScanResult, ProviderSearchOutcome } from "@/types/scanner";
import type { ImageInput, ProviderResult, ReverseImageSearchProvider } from "@/lib/reverse-search/provider";
import { MAX_IMAGE_BYTES } from "@/types/scanner";
import { resolveAndValidateUrl } from "@/lib/validation/url";
import { downloadImage } from "@/lib/image/downloader";
import { inspectImage } from "@/lib/image/metadata";
import { fingerprintImage } from "@/lib/image/fingerprint";
import { saveThumbnail } from "@/lib/image/thumbnails";
import { getProviders, mergeProviderResults } from "@/lib/reverse-search";
import { categorizeSourceUrl } from "@/lib/match-categorization";
import { getScanEntry, publishEvent, type ScanEntry } from "@/lib/scan/scan-store";
import { updateSavedSnapshotByScanId } from "@/lib/scan/scan-persistence";

/**
 * Retry of a failed reverse-search lookup for one image.
 *
 * The row's successful provider results are kept as-is (no extra API quota is
 * spent on them); only providers that previously failed are executed again.
 * The refreshed row is pushed to live subscribers and, when the scan was
 * auto-saved to data/results/, the JSON file is updated in place.
 */

export type RetryOutcome =
  | { ok: true; result: ImageScanResult; savedFilePath: string | null }
  | { ok: false; error: string };

function cloneResult(result: ImageScanResult): ImageScanResult {
  return {
    ...result,
    occurrences: result.occurrences.map((o) => ({ ...o })),
    reverseSearchResults: result.reverseSearchResults?.map((m) => ({ ...m })),
    providerOutcomes: result.providerOutcomes?.map((o) => ({ ...o })),
  };
}

/** One retry at a time per row, so double clicks cannot double-spend quota. */
const inFlightRetries = new Set<string>();

/**
 * Re-run only the providers that failed for this image; providers that
 * already searched successfully keep their earlier outcome. Mutates `draft`
 * with the new matches, per-provider outcomes and final status/remark
 * (recomputed with the same merge rules as the original scan).
 */
export async function rerunFailedProviderLookups(
  imageInput: ImageInput,
  draft: ImageScanResult,
  providers: ReverseImageSearchProvider[],
): Promise<void> {
  const previousOutcomes = draft.providerOutcomes ?? [];
  const previousById = new Map(previousOutcomes.map((outcome) => [outcome.providerId, outcome]));

  const staleProviders = providers.filter(
    (provider) => previousById.get(provider.id)?.searched !== true,
  );
  if (staleProviders.length === 0) return;

  const rerunResults = await Promise.all(staleProviders.map((provider) => provider.search(imageInput)));
  const rerunById = new Map<string, ProviderResult>();
  staleProviders.forEach((provider, index) => rerunById.set(provider.id, rerunResults[index]));

  // Per-provider outcomes: rerun results replace their failed entries,
  // successful previous outcomes pass through untouched.
  const mergedOutcomes: ProviderSearchOutcome[] = providers.flatMap((provider): ProviderSearchOutcome[] => {
    const rerun = rerunById.get(provider.id);
    if (rerun) {
      return [
        rerun.searched
          ? {
              providerId: provider.id,
              searched: true,
              status: rerun.status,
              matchCount: rerun.matches.length,
              remark: rerun.remark,
            }
          : { providerId: provider.id, searched: false, status: "FAILED", matchCount: 0, remark: rerun.remark },
      ];
    }
    const previous = previousById.get(provider.id);
    return previous ? [previous] : [];
  });
  draft.providerOutcomes = mergedOutcomes;

  // Matches: keep existing ones, prepend whatever the rerun just found.
  const rerunMatches = rerunResults
    .filter((r): r is Extract<ProviderResult, { searched: true }> => r.searched && r.status === "MATCH_FOUND")
    .flatMap((r) => r.matches)
    .filter((match) => /^https?:\/\//i.test(match.sourceUrl))
    .map((match) => ({ ...match, category: categorizeSourceUrl(match.sourceUrl) }));
  if (rerunMatches.length > 0) {
    const existing = draft.reverseSearchResults ?? [];
    const seen = new Set(rerunMatches.map((m) => m.sourceUrl));
    draft.reverseSearchResults = [...rerunMatches, ...existing.filter((m) => !seen.has(m.sourceUrl))];
  }

  // Final status/remark: merge across ALL providers (successful previous
  // stubs + rerun results) exactly like the original scan pipeline did.
  const allResults = providers
    .map((provider): ProviderResult | undefined => {
      const rerun = rerunById.get(provider.id);
      if (rerun) return rerun;
      const previous = previousById.get(provider.id);
      if (!previous?.searched || previous.status === "FAILED") return undefined;
      return { searched: true, status: previous.status, remark: previous.remark, matches: [] };
    })
    .filter((r): r is ProviderResult => r !== undefined);
  const merged = mergeProviderResults(...allResults);
  draft.status = merged.status;
  draft.remark = merged.remark;
}

/** Re-download and validate the image so providers can search it again. */
async function buildImageInput(entry: ScanEntry, result: ImageScanResult): Promise<ImageInput | { error: string }> {
  const resolved = resolveAndValidateUrl(result.imageUrl, result.pageUrl);
  if (!resolved.ok) return { error: `Image URL rejected: ${resolved.error}` };

  const download = await downloadImage(resolved.url);
  if (!download.ok) return { error: download.error };
  if (download.data.length > MAX_IMAGE_BYTES) return { error: "Image exceeds the maximum allowed size." };

  const inspection = await inspectImage(download.data, download.contentType);
  if (!inspection.ok) return { error: inspection.error };

  const fingerprint = await fingerprintImage(download.data);
  if (result.sha256 && fingerprint.sha256 !== result.sha256) {
    return { error: "The image at this URL changed since the scan; retry aborted." };
  }

  if (!result.previewUrl) {
    const thumbFile = await saveThumbnail(entry.progress.scanId, fingerprint.sha256, download.data);
    if (thumbFile) result.previewUrl = `/api/images/${entry.progress.scanId}/${thumbFile}`;
  }

  return {
    data: download.data,
    mimeType: inspection.mimeType,
    sha1: fingerprint.sha1,
    sha256: fingerprint.sha256,
    pageUrl: result.pageUrl,
    imageUrl: resolved.url,
  };
}

/**
 * Retry the reverse search for one result row.
 *
 * Allowed only after the scan finished: while the scan is RUNNING the image
 * processor owns the rows and concurrent retries would race with it.
 */
export async function retryImageLookup(scanId: string, resultId: string): Promise<RetryOutcome> {
  const entry = getScanEntry(scanId);
  if (!entry) {
    return { ok: false, error: "Scan not found (it may have been pruned or the server restarted)." };
  }
  if (entry.progress.state === "RUNNING") {
    return { ok: false, error: "The scan is still running. Retry once it finishes." };
  }

  const index = entry.results.findIndex((r) => r.id === resultId);
  if (index < 0) return { ok: false, error: "Result not found in this scan." };

  const inFlightKey = `${scanId}:${resultId}`;
  if (inFlightRetries.has(inFlightKey)) {
    return { ok: false, error: "A retry for this image is already in progress." };
  }

  const result = entry.results[index];
  const draft = cloneResult(result);
  inFlightRetries.add(inFlightKey);

  try {
    const imageInput = await buildImageInput(entry, result);
    if ("error" in imageInput) return { ok: false, error: imageInput.error };

    // Providers for this scan, in run order — rebuilt from the persisted
    // selection so the retried search behaves like the original scan.
    // An empty set (e.g. a provider was unconfigured since the scan) is a
    // no-op: the row is committed unchanged and the snapshot is refreshed.
    const providerSet = getProviders(entry.progress.providers);
    const providers = Object.values(providerSet).filter(
      (provider): provider is ReverseImageSearchProvider => provider !== undefined,
    );

    await rerunFailedProviderLookups(imageInput, draft, providers);

    // Commit: swap the refreshed row into the live entry.
    entry.results[index] = draft;
    publishEvent(entry, { type: "result", result: cloneResult(draft) });

    // Refresh the auto-saved JSON when this scan has one on disk.
    let savedFilePath: string | null = null;
    try {
      savedFilePath = await updateSavedSnapshotByScanId(scanId, entry.results.map(cloneResult));
    } catch (error) {
      console.error("[retry] snapshot update failed:", error);
    }

    return { ok: true, result: cloneResult(draft), savedFilePath };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Retry failed: ${message.slice(0, 150)}` };
  } finally {
    inFlightRetries.delete(inFlightKey);
  }
}
