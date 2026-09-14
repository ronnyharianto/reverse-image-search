import type { MatchSource } from "@/types/scanner";
import type { ImageInput, ProviderResult, ReverseImageSearchProvider } from "@/lib/reverse-search/provider";

/**
 * Bring-your-own-key provider.
 *
 * Enabled only when REVERSE_SEARCH_CUSTOM_URL is set in the environment
 * (.env.local). POSTs the image identity to a user-provided endpoint and
 * expects a JSON array (or `{ results: [...] }`) of matches:
 *
 *   [{ "sourceName": "...", "sourceUrl": "https://...", "similarity": 95 }]
 *
 * The URL may contain {sha1} / {sha256} placeholders that are substituted
 * before the request. Authentication is sent via the header configured in
 * REVERSE_SEARCH_CUSTOM_AUTH_HEADER (default: Authorization) with the value
 * of REVERSE_SEARCH_CUSTOM_API_KEY.
 *
 * The basic application does not require this provider (PRD §2); without
 * configuration it simply stays inactive.
 */

const REQUEST_TIMEOUT_MS = 20_000;

export interface CustomProviderConfig {
  urlTemplate: string;
  apiKey?: string;
  authHeader: string;
}

export function getCustomProviderConfig(): CustomProviderConfig | null {
  const urlTemplate = process.env.REVERSE_SEARCH_CUSTOM_URL?.trim();
  if (!urlTemplate) return null;
  return {
    urlTemplate,
    apiKey: process.env.REVERSE_SEARCH_CUSTOM_API_KEY?.trim() || undefined,
    authHeader: process.env.REVERSE_SEARCH_CUSTOM_AUTH_HEADER?.trim() || "Authorization",
  };
}

interface RawMatch {
  sourceName?: unknown;
  name?: unknown;
  sourceUrl?: unknown;
  url?: unknown;
  similarity?: unknown;
}

function normalizeMatches(payload: unknown): MatchSource[] {
  const list: unknown[] = Array.isArray(payload)
    ? payload
    : typeof payload === "object" && payload !== null && Array.isArray((payload as { results?: unknown }).results)
      ? ((payload as { results: unknown[] }).results)
      : [];

  const matches: MatchSource[] = [];
  for (const raw of list) {
    if (typeof raw !== "object" || raw === null) continue;
    const item = raw as RawMatch;
    const sourceUrl = typeof item.sourceUrl === "string" ? item.sourceUrl : typeof item.url === "string" ? item.url : undefined;
    if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) continue;
    matches.push({
      sourceName: typeof item.sourceName === "string" ? item.sourceName : typeof item.name === "string" ? item.name : "Source",
      sourceUrl,
      similarity: typeof item.similarity === "number" ? item.similarity : undefined,
      providerId: "custom",
    });
  }
  return matches;
}

export class CustomProvider implements ReverseImageSearchProvider {
  readonly id = "custom";
  readonly displayName = "Custom Provider";
  readonly description = "Reverse image search via a user-configured endpoint (REVERSE_SEARCH_CUSTOM_URL).";

  constructor(private readonly config: CustomProviderConfig) {}

  async search(image: ImageInput): Promise<ProviderResult> {
    try {
      const url = this.config.urlTemplate
        .replaceAll("{sha1}", image.sha1)
        .replaceAll("{sha256}", image.sha256);

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
      };
      if (this.config.apiKey) {
        headers[this.config.authHeader] = this.config.apiKey;
      }

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ sha1: image.sha1, sha256: image.sha256, mimeType: image.mimeType }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        return {
          searched: false,
          status: "FAILED",
          remark: `Custom provider request failed (HTTP ${response.status}).`,
        };
      }

      const matches = normalizeMatches(await response.json());
      if (matches.length === 0) {
        return { searched: true, status: "NO_MATCH", remark: "Custom provider found no matches.", matches: [] };
      }
      return {
        searched: true,
        status: "MATCH_FOUND",
        remark: `${matches.length} potential match source(s) returned.`,
        matches,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { searched: false, status: "FAILED", remark: `Custom provider failed: ${message.slice(0, 150)}` };
    }
  }
}
