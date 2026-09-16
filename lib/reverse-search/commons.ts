import type { MatchSource } from "@/types/scanner";
import type { ImageInput, ProviderResult, ReverseImageSearchProvider } from "@/lib/reverse-search/provider";
import { SequentialRequestQueue } from "@/lib/reverse-search/request-queue";

/**
 * Wikimedia Commons provider — a genuine reverse image lookup.
 *
 * MediaWiki's `list=allimages&aisha1=...` API returns all files on
 * Wikimedia Commons whose content SHA-1 equals the queried hash.
 * This is a real reverse image search over a large public corpus
 * (~100M files), not a filename/URL text search. Coverage is limited
 * to Commons; a NO_MATCH therefore does not mean the image is
 * copyright-free.
 *
 * Free, no API key, per Wikimedia API policy we send a descriptive
 * User-Agent and keep the request rate low.
 */

const API_ENDPOINT = "https://commons.wikimedia.org/w/api.php";
const REQUEST_TIMEOUT_MS = 15_000;
export const MIN_REQUEST_INTERVAL_MS = 250; // ≤ 4 requests/second

interface MediaWikiAllImagesItem {
  title?: string;
  name?: string;
  url?: string;
  descriptionurl?: string;
  mime?: string;
  size?: number;
  sha1?: string;
}

interface MediaWikiResponse {
  query?: {
    allimages?: MediaWikiAllImagesItem[];
  };
  error?: { info?: string; code?: string };
}

/**
 * Sequential request queue shared by all Commons lookups, across scans and
 * provider instances: exactly one API request in flight at a time, with at
 * least MIN_REQUEST_INTERVAL_MS between consecutive request starts. This
 * replaces an earlier timestamp-based limiter that could fire concurrent
 * requests on the same tick under the image workers' concurrency.
 */
const commonsRequestQueue = new SequentialRequestQueue(MIN_REQUEST_INTERVAL_MS);

export class WikimediaCommonsProvider implements ReverseImageSearchProvider {
  readonly id = "commons";
  readonly displayName = "Wikimedia Commons";
  readonly description =
    "Exact-content hash lookup (SHA-1) across Wikimedia Commons via the public MediaWiki API. Free, no API key.";

  async search(image: ImageInput): Promise<ProviderResult> {
    try {
      const response = await fetchWithRetry(image.sha1.toLowerCase());
      if (!response.ok) {
        return {
          searched: false,
          status: "FAILED",
          remark: `Wikimedia Commons request failed (HTTP ${response.status}).`,
        };
      }

      const payload = (await response.json()) as MediaWikiResponse;
      if (payload.error) {
        return {
          searched: false,
          status: "FAILED",
          remark: `Wikimedia Commons API error: ${payload.error.info ?? payload.error.code ?? "unknown"}`,
        };
      }

      const items = (payload.query?.allimages ?? []).filter(
        (item) => !item.mime || item.mime.startsWith("image/"),
      );

      if (items.length === 0) {
        return {
          searched: true,
          status: "NO_MATCH",
          remark: "No matching image on Wikimedia Commons.",
          matches: [],
        };
      }

      const matches: MatchSource[] = items.map((item) => ({
        sourceName: `Wikimedia Commons — ${item.title ?? item.name ?? "file"}`,
        sourceUrl: item.descriptionurl ?? item.url ?? "https://commons.wikimedia.org",
        providerId: this.id,
      }));

      return {
        searched: true,
        status: "MATCH_FOUND",
        remark:
          items.length === 1
            ? "Matching image found on Wikimedia Commons."
            : `${items.length} matching files found on Wikimedia Commons.`,
        matches,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        searched: false,
        status: "FAILED",
        remark: `Wikimedia Commons lookup failed: ${message.slice(0, 150)}`,
      };
    }
  }
}

/**
 * Fetch the Commons API through the shared sequential request queue with up
 * to 3 attempts, honoring Retry-After on 429s. Returns the last Response on
 * final failure.
 */
async function fetchWithRetry(sha1: string, maxAttempts = 3): Promise<Response> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    list: "allimages",
    aisha1: sha1,
    aiprop: "url|mime|size|sha1",
    ailimit: "5",
  });
  const requestUrl = `${API_ENDPOINT}?${params.toString()}`;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await commonsRequestQueue.run(() =>
      fetch(requestUrl, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          "User-Agent": "CopyrightImageScanner/0.1 (local copyright screening tool)",
          Accept: "application/json",
        },
      }),
    );
    if (response.ok) return response;
    if (response.status !== 429 || attempt === maxAttempts) return response;
    const retryAfter = Number(response.headers.get("retry-after") ?? "0");
    const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * attempt;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new Error("unreachable");
}
