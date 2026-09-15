import type { MatchSource } from "@/types/scanner";
import type { ImageInput, ProviderResult, ReverseImageSearchProvider } from "@/lib/reverse-search/provider";

/**
 * Google Cloud Vision provider — Web Detection.
 *
 * Uploads the image bytes (base64) to the official Google Vision API and maps
 * `webDetection` to match sources. No public image URL is required, and no
 * Google SDK dependency — plain fetch with API-key auth.
 *
 * Enabled only when GOOGLE_VISION_API_KEY is set; an unset key keeps the
 * provider inactive (base app requires no paid service).
 */

const API_ENDPOINT = "https://vision.googleapis.com/v1/images:annotate";
const REQUEST_TIMEOUT_MS = 25_000;
const MAX_PAGE_MATCHES = 8;
const MAX_IMAGE_MATCHES = 8;

interface VisionUrlItem {
  url?: unknown;
}

interface VisionPageMatch {
  url?: unknown;
  pageTitle?: unknown;
}

interface VisionWebDetection {
  pagesWithMatchingImages?: unknown;
  fullMatchingImages?: unknown;
  partialMatchingImages?: unknown;
}

interface VisionResponse {
  error?: { message?: unknown };
  responses?: Array<{ webDetection?: unknown; error?: { message?: unknown } }>;
}

export class GoogleVisionProvider implements ReverseImageSearchProvider {
  readonly id = "google-vision";
  readonly displayName = "Google Cloud Vision";
  readonly description =
    "Reverse image search via Google Cloud Vision Web Detection. Uploads the image bytes directly.";

  constructor(private readonly apiKey: string) {}

  async search(image: ImageInput): Promise<ProviderResult> {
    try {
      const response = await fetch(`${API_ENDPOINT}?key=${encodeURIComponent(this.apiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: [
            {
              image: { content: image.data.toString("base64") },
              features: [{ type: "WEB_DETECTION", maxResults: 20 }],
            },
          ],
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        const detail =
          response.status === 400
            ? " (invalid image or request)"
            : response.status === 403
              ? " (check GOOGLE_VISION_API_KEY, billing and Vision API enablement)"
              : response.status === 429
                ? " (quota exhausted)"
                : "";
        return {
          searched: false,
          status: "FAILED",
          remark: `Google Vision request failed (HTTP ${response.status})${detail}.`,
        };
      }

      const payload = (await response.json()) as VisionResponse;
      const apiError = payload.error?.message ?? payload.responses?.[0]?.error?.message;
      if (typeof apiError === "string" && apiError) {
        return { searched: false, status: "FAILED", remark: `Google Vision API error: ${apiError}` };
      }

      const webDetection = payload.responses?.[0]?.webDetection;
      if (typeof webDetection !== "object" || webDetection === null) {
        return {
          searched: true,
          status: "NO_MATCH",
          remark: "No matching image found on Google Vision.",
          matches: [],
        };
      }

      const detection = webDetection as VisionWebDetection;
      const pages = takeHttpUrls(detection.pagesWithMatchingImages, MAX_PAGE_MATCHES, (item) => {
        const page = item as VisionPageMatch;
        return {
          url: typeof page.url === "string" ? page.url : undefined,
          name: typeof page.pageTitle === "string" ? page.pageTitle : undefined,
        };
      });

      const fullMatches = takeHttpUrls(detection.fullMatchingImages, MAX_IMAGE_MATCHES, () => ({}));
      const partialMatches = takeHttpUrls(detection.partialMatchingImages, MAX_IMAGE_MATCHES, () => ({}));

      const matches: MatchSource[] = [
        ...pages.map(({ url, name }) => ({
          sourceName: name ? `Google Vision — ${name}` : "Google Vision — page with matching image",
          sourceUrl: url,
          providerId: this.id,
        })),
        ...fullMatches.map(({ url }) => ({
          sourceName: "Google Vision — full image match",
          sourceUrl: url,
          providerId: this.id,
        })),
        ...partialMatches.map(({ url }) => ({
          sourceName: "Google Vision — partial image match",
          sourceUrl: url,
          providerId: this.id,
        })),
      ];

      if (matches.length === 0) {
        return {
          searched: true,
          status: "NO_MATCH",
          remark: "No matching image found on Google Vision.",
          matches: [],
        };
      }

      return {
        searched: true,
        status: "MATCH_FOUND",
        remark: `Potential match found on Google Vision (${pages.length} page${pages.length === 1 ? "" : "s"} with matching images).`,
        matches,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        searched: false,
        status: "FAILED",
        remark: `Google Vision lookup failed: ${message.slice(0, 150)}`,
      };
    }
  }
}

/** Filter Vision arrays to http(s) URLs, capped. */
function takeHttpUrls(
  items: unknown,
  cap: number,
  extra: (item: Record<string, unknown>) => { url?: string; name?: string },
): Array<{ url: string; name?: string }> {
  if (!Array.isArray(items)) return [];
  const out: Array<{ url: string; name?: string }> = [];
  for (const raw of items) {
    if (out.length >= cap) break;
    if (typeof raw !== "object" || raw === null) continue;
    const item = raw as VisionUrlItem;
    const url = typeof item.url === "string" ? item.url : undefined;
    if (!url || !/^https?:\/\//i.test(url)) continue;
    const meta = extra(raw as Record<string, unknown>);
    out.push({ url, name: meta.name });
  }
  return out;
}
