import type { ImageScanResult, ProviderSearchOutcome, ScanProgress } from "@/types/scanner";
import type { ImageInput, ProviderResult, ReverseImageSearchProvider } from "@/lib/reverse-search/provider";
import { MAX_IMAGE_BYTES } from "@/types/scanner";
import { resolveAndValidateUrl } from "@/lib/validation/url";
import { downloadImage } from "@/lib/image/downloader";
import { inspectImage } from "@/lib/image/metadata";
import { fingerprintImage } from "@/lib/image/fingerprint";
import { saveThumbnail } from "@/lib/image/thumbnails";
import { getProviders, mergeProviderResults } from "@/lib/reverse-search";
import { categorizeSourceUrl } from "@/lib/match-categorization";
import { getScanEntry, publishEvent } from "@/lib/scan/scan-store";
import {
  loadSavedSnapshotByScanId,
  replaceSavedSnapshotByScanId,
  updateSavedSnapshotByScanId,
} from "@/lib/scan/scan-persistence";

/**
 * Retry of a failed reverse-search lookup for one image.
 *
 * The row's successful provider results are kept as-is (no extra API quota is
 * spent on them); only providers that previously failed are executed again.
 *
 * Two execution modes:
 *
 * - "live":     the finished scan is still in memory. The refreshed row is
 *               swapped into the live entry, pushed to SSE subscribers, and
 *               the auto-saved JSON (if any) is updated in place.
 * - "snapshot": the live entry is gone (server restart / prune). The retry
 *               runs against the persisted snapshot in data/results/ and the
 *               refreshed row is written back to the snapshot file, so saved
 *               reports stay retryable across restarts.
 */

export type RetryOutcome =
  | { ok: true; result: ImageScanResult; savedFilePath: string | null; mode: "live" | "snapshot" }
  | { ok: false; error: string };

/** Minimal view of a scan the retry pipeline operates on (live or restored). */
interface RetryStore {
  progress: ScanProgress;
  results: ImageScanResult[];
}

function cloneResult(result: ImageScanResult): ImageScanResult {
  return {
    ...result,
    occurrences: result.occurrences.map((o) => ({ ...o })),
    reverseSearchResults: result.reverseSearchResults?.map((m) => ({ ...m })),
    providerOutcomes: result.providerOutcomes?.map((o) => ({ ...o })),
  };
}

/**
 * One retry at a time per row (and mode), so double clicks cannot
 * double-spend provider quota.
 */
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
async function buildImageInput(store: RetryStore, result: ImageScanResult): Promise<ImageInput | { error: string }> {
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
    const thumbFile = await saveThumbnail(store.progress.scanId, fingerprint.sha256, download.data);
    if (thumbFile) result.previewUrl = `/api/images/${store.progress.scanId}/${thumbFile}`;
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

/** Providers for a scan, in run order, rebuilt from the persisted selection. */
function providersForStore(progress: ScanProgress): ReverseImageSearchProvider[] {
  const providerSet = getProviders(progress.providers);
  return Object.values(providerSet).filter(
    (provider): provider is ReverseImageSearchProvider => provider !== undefined,
  );
}

/**
 * Shared retry core for both modes. Mutates `store.results` with the
 * refreshed row. Callers own the mode-specific commit (SSE push, snapshot
 * file write) via the returned draft.
 */
async function performRetry(
  store: RetryStore,
  resultId: string,
  mode: "live" | "snapshot",
  notFoundMessage: string,
): Promise<{ ok: true; draft: ImageScanResult } | { ok: false; error: string }> {
  const index = store.results.findIndex((r) => r.id === resultId);
  if (index < 0) return { ok: false, error: notFoundMessage };

  const inFlightKey = `${mode}:${store.progress.scanId}:${resultId}`;
  if (inFlightRetries.has(inFlightKey)) {
    return { ok: false, error: "A retry for this image is already in progress." };
  }

  const result = store.results[index];
  const draft = cloneResult(result);
  inFlightRetries.add(inFlightKey);

  try {
    const imageInput = await buildImageInput(store, result);
    if ("error" in imageInput) return { ok: false, error: imageInput.error };

    await rerunFailedProviderLookups(imageInput, draft, providersForStore(store.progress));
    store.results[index] = draft;
    return { ok: true, draft };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Retry failed: ${message.slice(0, 150)}` };
  } finally {
    inFlightRetries.delete(inFlightKey);
  }
}

/**
 * Retry the reverse search for one result row.
 *
 * Allowed only after the scan finished: while the scan is RUNNING the image
 * processor owns the rows and concurrent retries would race with it.
 * Falls back to the persisted snapshot (data/results/) when the live entry
 * no longer exists, so saved reports stay retryable after a restart.
 */
export async function retryImageLookup(scanId: string, resultId: string): Promise<RetryOutcome> {
  const entry = getScanEntry(scanId);
  if (entry?.progress.state === "RUNNING") {
    return { ok: false, error: "The scan is still running. Retry once it finishes." };
  }

  if (entry) {
    const outcome = await performRetry(entry, resultId, "live", "Result not found in this scan.");
    if (outcome.ok) {
      publishEvent(entry, { type: "result", result: cloneResult(outcome.draft) });

      // Refresh the auto-saved JSON when this scan has one on disk.
      let savedFilePath: string | null = null;
      try {
        savedFilePath = await updateSavedSnapshotByScanId(scanId, entry.results.map(cloneResult));
      } catch (error) {
        console.error("[retry] snapshot update failed:", error);
      }
      return { ok: true, result: cloneResult(outcome.draft), savedFilePath, mode: "live" };
    }
    // The live entry exists but could not serve this retry (e.g. the result
    // id only exists in the persisted snapshot). Fall through to the
    // snapshot before giving up.
    if (!outcome.ok && outcome.error !== "Result not found in this scan.") {
      return outcome;
    }
  }

  // Snapshot fallback: no live entry (or the row only exists on disk).
  const snapshot = await loadSavedSnapshotByScanId(scanId);
  if (!snapshot) {
    return {
      ok: false,
      error: entry
        ? "Result not found in this scan or its saved result file."
        : "Scan not found (it may have been pruned or the server restarted), and no saved result file exists for it.",
    };
  }

  const restored: RetryStore = { progress: snapshot.progress, results: snapshot.results ?? [] };
  const outcome = await performRetry(restored, resultId, "snapshot", "Result not found in the saved result file.");
  if (!outcome.ok) return outcome;

  // Commit: write the refreshed snapshot back to data/results/.
  const savedFilePath = await replaceSavedSnapshotByScanId(scanId, {
    progress: restored.progress,
    results: restored.results,
  });
  return { ok: true, result: cloneResult(outcome.draft), savedFilePath, mode: "snapshot" };
}
