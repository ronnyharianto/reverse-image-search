import type { MatchSource } from "@/types/scanner";
import type { ImageInput, ProviderResult, ReverseImageSearchProvider } from "@/lib/reverse-search/provider";

/**
 * SerpAPI Google Lens provider — true web-wide reverse image search.
 *
 * Searches by the image's public URL (1 quota unit per image). The image must
 * be reachable from SerpAPI's servers, which holds for images crawled from a
 * public website. Results are Google's visual matches; entries flagged
 * `exact_matches` are the strongest copyright-screening signal.
 *
 * Enabled only when SERPAPI_API_KEY is set — the base application requires no
 * paid service (PRD §2), so an unset key simply keeps the provider inactive.
 */

const SEARCH_ENDPOINT = "https://serpapi.com/search";
const REQUEST_TIMEOUT_MS = 25_000;
const MAX_MATCHES = 10;

interface LensVisualMatch {
  title?: unknown;
  link?: unknown;
  source?: unknown;
  exact_matches?: unknown;
  image?: unknown;
}

interface LensResponse {
  error?: unknown;
  visual_matches?: unknown;
  search_metadata?: { status?: unknown };
}

export class SerpApiProvider implements ReverseImageSearchProvider {
  readonly id = "serpapi";
  readonly displayName = "Google Lens (SerpAPI)";
  readonly description =
    "Web-wide reverse image search via Google Lens (SerpAPI). Searches by the image's public URL.";

  constructor(private readonly apiKey: string) {}

  async search(image: ImageInput): Promise<ProviderResult> {
    if (!image.imageUrl) {
      return {
        searched: false,
        status: "FAILED",
        remark: "SerpAPI search skipped: image URL is not available.",
      };
    }

    const params = new URLSearchParams({
      engine: "google_lens",
      url: image.imageUrl,
      api_key: this.apiKey,
    });
    const requestUrl = `${SEARCH_ENDPOINT}?${params.toString()}`;

    try {
      const response = await fetch(requestUrl, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        const detail = response.status === 401 || response.status === 403
          ? " (check SERPAPI_API_KEY)"
          : response.status === 429
            ? " (monthly search quota exhausted)"
            : "";
        return {
          searched: false,
          status: "FAILED",
          remark: `Google Lens request failed (HTTP ${response.status})${detail}.`,
        };
      }

      const payload = (await response.json()) as LensResponse;
      if (typeof payload.error === "string" && payload.error) {
        return { searched: false, status: "FAILED", remark: `Google Lens API error: ${payload.error}` };
      }

      const rawMatches = Array.isArray(payload.visual_matches) ? payload.visual_matches : [];
      const matches = normalizeMatches(rawMatches).slice(0, MAX_MATCHES);

      if (matches.length === 0) {
        return {
          searched: true,
          status: "NO_MATCH",
          remark: "No matching image found on Google Lens.",
          matches: [],
        };
      }

      const exactCount = matches.filter((m) => m.exactMatch).length;
      return {
        searched: true,
        status: "MATCH_FOUND",
        remark:
          exactCount > 0
            ? `Potential match found on Google Lens (${exactCount} exact, ${matches.length} total sources).`
            : `Potential match found on Google Lens (${matches.length} visual match sources).`,
        matches,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        searched: false,
        status: "FAILED",
        remark: `Google Lens lookup failed: ${message.slice(0, 150)}`,
      };
    }
  }
}

interface NormalizedLensMatch extends MatchSource {
  /** Lens reports true when the match is an exact copy of the searched image. */
  exactMatch?: boolean;
}

function normalizeMatches(rawMatches: unknown[]): NormalizedLensMatch[] {
  const matches: NormalizedLensMatch[] = [];
  const seen = new Set<string>();
  for (const raw of rawMatches) {
    if (typeof raw !== "object" || raw === null) continue;
    const item = raw as LensVisualMatch;
    const link = typeof item.link === "string" ? item.link : undefined;
    if (!link || !/^https?:\/\//i.test(link) || seen.has(link)) continue;
    seen.add(link);
    matches.push({
      sourceName: typeof item.source === "string" && item.source
        ? `Google Lens — ${item.source}`
        : "Google Lens",
      sourceUrl: link,
      providerId: "serpapi",
      exactMatch: item.exact_matches === true,
    });
  }
  return matches;
}
