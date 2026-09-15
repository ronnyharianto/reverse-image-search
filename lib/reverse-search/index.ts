import type { MatchSource, ProviderSearchOutcome } from "@/types/scanner";
import type { ProviderResult, ReverseImageSearchProvider } from "@/lib/reverse-search/provider";
import { WikimediaCommonsProvider } from "@/lib/reverse-search/commons";
import { SerpApiProvider } from "@/lib/reverse-search/serpapi";
import { GoogleVisionProvider } from "@/lib/reverse-search/google-vision";
import { getCustomProviderConfig, CustomProvider } from "@/lib/reverse-search/custom";

/**
 * Provider registry.
 *
 * Providers:
 * - "commons":      Wikimedia Commons SHA-1 hash lookup (free, always available).
 * - "serpapi":      Google Lens via SerpAPI (opt-in, SERPAPI_API_KEY).
 * - "google-vision": Google Cloud Vision Web Detection (opt-in, GOOGLE_VISION_API_KEY).
 * - "custom":       BYO-key endpoint (opt-in, REVERSE_SEARCH_CUSTOM_URL).
 *
 * A scan selects which providers run via `getProviders(enabledIds)`. Providers
 * whose credentials are not configured can never be enabled — the UI shows
 * them as "Not configured" (see getProviderCatalog).
 */

export interface ProviderSet {
  commons?: ReverseImageSearchProvider;
  serpapi?: ReverseImageSearchProvider;
  googleVision?: ReverseImageSearchProvider;
  custom?: ReverseImageSearchProvider;
}

/** Everything the UI needs to render the provider picker. */
export interface ProviderCatalogItem {
  id: string;
  displayName: string;
  description: string;
  /** True when the required credentials/env config are present. */
  configured: boolean;
  /** Env vars or config needed to enable this provider. */
  requires: string[];
}

const COMMONS_ID = "commons";
const SERPAPI_ID = "serpapi";
const GOOGLE_VISION_ID = "google-vision";
const CUSTOM_ID = "custom";

export const PROVIDER_IDS = [COMMONS_ID, SERPAPI_ID, GOOGLE_VISION_ID, CUSTOM_ID] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}

/** Which opt-in providers currently have credentials configured. */
export function getConfiguredProviderIds(): Set<ProviderId> {
  const configured = new Set<ProviderId>([COMMONS_ID]);
  if (process.env.SERPAPI_API_KEY?.trim()) configured.add(SERPAPI_ID);
  if (process.env.GOOGLE_VISION_API_KEY?.trim()) configured.add(GOOGLE_VISION_ID);
  if (getCustomProviderConfig()) configured.add(CUSTOM_ID);
  return configured;
}

/** Static catalog for the UI: all providers with their configuration state. */
export function getProviderCatalog(): ProviderCatalogItem[] {
  const configured = getConfiguredProviderIds();
  return [
    {
      id: COMMONS_ID,
      displayName: "Wikimedia Commons",
      description: "Exact-content SHA-1 lookup over Wikimedia Commons. Free, no key required.",
      configured: configured.has(COMMONS_ID),
      requires: [],
    },
    {
      id: SERPAPI_ID,
      displayName: "Google Lens (SerpAPI)",
      description: "Web-wide reverse image search via Google Lens. ~250 free searches/month.",
      configured: configured.has(SERPAPI_ID),
      requires: ["SERPAPI_API_KEY"],
    },
    {
      id: GOOGLE_VISION_ID,
      displayName: "Google Cloud Vision",
      description: "Official Google Web Detection. Uploads image bytes. 1,000 free units/month.",
      configured: configured.has(GOOGLE_VISION_ID),
      requires: ["GOOGLE_VISION_API_KEY"],
    },
    {
      id: CUSTOM_ID,
      displayName: "Custom endpoint",
      description: "Your own reverse-search endpoint (bring your own key).",
      configured: configured.has(CUSTOM_ID),
      requires: ["REVERSE_SEARCH_CUSTOM_URL"],
    },
  ];
}

/**
 * Build the provider set for a scan.
 *
 * `enabledIds` selects which providers run. A provider is only instantiated
 * when it is BOTH enabled AND configured; silently skipping unconfigured
 * providers would misrepresent what was searched — callers should validate
 * against the catalog first (the scan API does).
 */
export function getProviders(enabledIds?: readonly string[]): ProviderSet {
  const configured = getConfiguredProviderIds();
  const enabled = new Set(
    (enabledIds ?? []).filter(isProviderId).filter((id) => configured.has(id)),
  );

  // Default (no explicit selection): every configured provider runs.
  if (enabledIds === undefined) {
    return buildAllConfiguredProviders(configured);
  }

  return {
    commons: enabled.has(COMMONS_ID) ? new WikimediaCommonsProvider() : undefined,
    serpapi: enabled.has(SERPAPI_ID) ? new SerpApiProvider(process.env.SERPAPI_API_KEY!.trim()) : undefined,
    googleVision: enabled.has(GOOGLE_VISION_ID)
      ? new GoogleVisionProvider(process.env.GOOGLE_VISION_API_KEY!.trim())
      : undefined,
    custom: enabled.has(CUSTOM_ID) && getCustomProviderConfig()
      ? new CustomProvider(getCustomProviderConfig()!)
      : undefined,
  };
}

function buildAllConfiguredProviders(configured: Set<ProviderId>): ProviderSet {
  return {
    commons: configured.has(COMMONS_ID) ? new WikimediaCommonsProvider() : undefined,
    serpapi: configured.has(SERPAPI_ID)
      ? new SerpApiProvider(process.env.SERPAPI_API_KEY!.trim())
      : undefined,
    googleVision: configured.has(GOOGLE_VISION_ID)
      ? new GoogleVisionProvider(process.env.GOOGLE_VISION_API_KEY!.trim())
      : undefined,
    custom: getCustomProviderConfig() ? new CustomProvider(getCustomProviderConfig()!) : undefined,
  };
}

/**
 * Summarize what each provider did for one image, for the detail panel.
 * Results are paired with provider ids by position.
 */
export function summarizeProviderOutcomes(
  providers: readonly ReverseImageSearchProvider[],
  results: readonly (ProviderResult | undefined)[],
): ProviderSearchOutcome[] {
  const outcomes: ProviderSearchOutcome[] = [];
  for (let index = 0; index < providers.length; index += 1) {
    const provider = providers[index];
    const result = results[index];
    if (!provider || result === undefined) continue;
    if (result.searched) {
      outcomes.push({
        providerId: provider.id,
        searched: true,
        status: result.status,
        matchCount: result.matches.length,
        remark: result.remark,
      });
    } else {
      outcomes.push({
        providerId: provider.id,
        searched: false,
        status: "FAILED",
        matchCount: 0,
        remark: result.remark,
      });
    }
  }
  return outcomes;
}

/** Guards against unsafe URLs from external providers reaching the UI as links. */
function sanitizeMatches(matches: MatchSource[]): MatchSource[] {
  return matches.filter((match) => /^https?:\/\//i.test(match.sourceUrl));
}

/**
 * Merge provider results into one status/remark/match list.
 * - MATCH_FOUND wins over NO_MATCH.
 * - FAILED results only surface when every provider failed.
 * - If no provider ran at all → REQUIRES_REVIEW (honest, non-faked).
 */
export function mergeProviderResults(...results: (ProviderResult | undefined)[]): {
  status: "NO_MATCH" | "MATCH_FOUND" | "REQUIRES_REVIEW" | "FAILED";
  remark: string;
  matches: MatchSource[];
} {
  const executed = results.filter((r): r is ProviderResult => r !== undefined && r.searched);
  const failed = results.filter((r): r is ProviderResult => r !== undefined && !r.searched);

  if (executed.length === 0 && failed.length === 0) {
    return {
      status: "REQUIRES_REVIEW",
      remark: "No reverse image search provider is configured. Manual verification required.",
      matches: [],
    };
  }

  type SuccessfulSearch = Extract<ProviderResult, { searched: true }>;
  const matchResults = executed.filter(
    (r): r is SuccessfulSearch => r.searched && r.status === "MATCH_FOUND",
  );
  const matches = sanitizeMatches(matchResults.flatMap((r) => r.matches));

  if (matchResults.length > 0) {
    const parts: string[] = [];
    parts.push("Potential match found");
    if (matches.length > 1) parts.push(`(${matches.length} sources)`);
    if (failed.length > 0) parts.push("— some providers failed");
    return { status: "MATCH_FOUND", remark: `${parts.join(" ")}. Manual verification required.`, matches };
  }

  if (executed.length > 0) {
    // At least one provider genuinely searched and found nothing
    const remarks = executed.map((r) => r.remark);
    const suffix = failed.length > 0 ? " Some providers failed." : "";
    return { status: "NO_MATCH", remark: `${remarks[remarks.length - 1]}${suffix}`, matches: [] };
  }

  return {
    status: "FAILED",
    remark: failed[failed.length - 1].remark,
    matches: [],
  };
}
