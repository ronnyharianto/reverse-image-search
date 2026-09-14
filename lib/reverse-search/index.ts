import type { MatchSource } from "@/types/scanner";
import type { ProviderResult, ReverseImageSearchProvider } from "@/lib/reverse-search/provider";
import { WikimediaCommonsProvider } from "@/lib/reverse-search/commons";
import { getCustomProviderConfig, CustomProvider } from "@/lib/reverse-search/custom";

/**
 * Provider registry.
 *
 * v1 ships with:
 * - "commons": Wikimedia Commons SHA-1 hash lookup (free, always on).
 * - "custom":  optional BYO-key endpoint, enabled via REVERSE_SEARCH_CUSTOM_URL.
 *
 * If no provider is configured, results are REQUIRES_REVIEW — never a fake
 * match (PRD §14).
 */

export interface ProviderSet {
  commons: ReverseImageSearchProvider;
  custom?: ReverseImageSearchProvider;
}

export function getProviders(): ProviderSet {
  const customConfig = getCustomProviderConfig();
  return {
    commons: new WikimediaCommonsProvider(),
    custom: customConfig ? new CustomProvider(customConfig) : undefined,
  };
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
