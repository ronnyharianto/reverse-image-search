/**
 * Shared types for the Copyright Image Scanner.
 *
 * Terminology note: this is a copyright-RISK SCREENING tool. Statuses and
 * remarks must never state a definitive legal conclusion.
 */

export type ImageStatus =
  | "PROCESSING"
  | "NO_MATCH"
  | "MATCH_FOUND"
  | "REQUIRES_REVIEW"
  | "FAILED";

export type ScanState = "RUNNING" | "COMPLETED" | "STOPPED" | "FAILED";

/** Kind of domain hosting a reverse-search match (screening aid, not legal). */
export type MatchCategory = "COMMERCIAL_STOCK" | "FREE_MEDIA" | "SOCIAL_PLATFORM" | "OTHER_SOURCE";

/** One source returned by a reverse image search provider. */
export interface MatchSource {
  /** Human-readable source name, e.g. "Wikimedia Commons". */
  sourceName: string;
  /** Absolute URL of the matching source page. */
  sourceUrl: string;
  /** Similarity in percent when the provider reports one. */
  similarity?: number;
  /** Provider that produced this match, e.g. "commons" or "custom". */
  providerId: string;
  /** Domain category of the source (free media, commercial stock, …). */
  category?: MatchCategory;
}

/** One page occurrence of an image (identical files can appear on many pages). */
export interface ImageOccurrence {
  pageUrl: string;
  imageUrl: string;
}

/** How one configured provider fared for one image (shown in the detail panel). */
export interface ProviderSearchOutcome {
  /** Provider id, e.g. "commons". */
  providerId: string;
  /** True when the provider completed a real search (regardless of match count). */
  searched: boolean;
  status: "NO_MATCH" | "MATCH_FOUND" | "FAILED";
  /** Matches contributed by this provider. */
  matchCount: number;
  /** Short provider remark, e.g. error detail. */
  remark: string;
}

/** A single image occurrence row shown in the result list. */
export interface ImageScanResult {
  id: string;
  /** Page URL where this occurrence was found. */
  pageUrl: string;
  /** Absolute image URL (after normalization). */
  imageUrl: string;
  status: ImageStatus;
  /** Short explanation; must not contain legal conclusions. */
  remark: string;
  /** Local API URL of the generated thumbnail, when available. */
  previewUrl?: string;
  /** Sources returned by reverse image search, when any. */
  reverseSearchResults?: MatchSource[];
  /** Per-provider search outcomes for this image, in the order providers ran. */
  providerOutcomes?: ProviderSearchOutcome[];
  /** All pages where the identical image file was found. */
  occurrences: ImageOccurrence[];
  width?: number;
  height?: number;
  byteSize?: number;
  mimeType?: string;
  /** SHA-256 of the image bytes; the duplicate-detection key. */
  sha256?: string;
}

export interface ScanProgress {
  scanId: string;
  targetUrl: string;
  state: ScanState;
  pagesScanned: number;
  imagesFound: number;
  imagesProcessed: number;
  currentPage?: string;
  currentImage?: string;
  startedAt: string;
  finishedAt?: string;
  /** Reverse-search providers selected for this scan, in run order. */
  providers?: string[];
}

export interface ScanSnapshot {
  progress: ScanProgress;
  results: ImageScanResult[];
}

/** Events pushed to the client over the SSE stream. */
export type ScanEvent =
  | { type: "progress"; progress: ScanProgress }
  | { type: "result"; result: ImageScanResult }
  | { type: "done"; progress: ScanProgress }
  | { type: "error"; message: string };

/**
 * True when at least one provider of this row failed its lookup (e.g. a
 * network or quota error), so the reverse search can be retried for it.
 * Rows without per-provider outcomes (download/validation failures) are not
 * retryable — there is no provider result to refresh.
 */
export function hasFailedProviderLookup(result: ImageScanResult): boolean {
  return (result.providerOutcomes ?? []).some((outcome) => !outcome.searched);
}

/** Display labels for statuses — screening wording only. */
export const STATUS_LABELS: Record<ImageStatus, string> = {
  PROCESSING: "Processing",
  NO_MATCH: "No Match",
  MATCH_FOUND: "Match Found",
  REQUIRES_REVIEW: "Requires Review",
  FAILED: "Failed",
};

/** Tailwind classes for status badges. */
export const STATUS_STYLES: Record<ImageStatus, string> = {
  PROCESSING: "bg-blue-100 text-blue-800 border-blue-200",
  NO_MATCH: "bg-emerald-100 text-emerald-800 border-emerald-200",
  MATCH_FOUND: "bg-amber-100 text-amber-900 border-amber-200",
  REQUIRES_REVIEW: "bg-violet-100 text-violet-800 border-violet-200",
  FAILED: "bg-red-100 text-red-800 border-red-200",
};

/** Friendly display names for reverse-search provider ids. */
export const PROVIDER_LABELS: Record<string, string> = {
  commons: "Wikimedia Commons",
  serpapi: "Google Lens (SerpAPI)",
  "google-vision": "Google Cloud Vision",
  custom: "Custom endpoint",
};

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB per image
export const DOWNLOAD_TIMEOUT_MS = 15_000;
export const PAGE_TIMEOUT_MS = 20_000;
export const MAX_PAGES = 100;
export const MAX_CRAWL_DEPTH = 3;
export const PAGE_CONCURRENCY = 3;
export const IMAGE_CONCURRENCY = 5;
