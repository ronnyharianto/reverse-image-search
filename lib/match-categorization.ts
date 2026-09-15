/**
 * Match-source categorization.
 *
 * Reverse-search matches are grouped by the *kind* of domain that hosts them,
 * because each kind implies a different follow-up action:
 *
 * - FREE_MEDIA       → best case: the source library itself offers a license
 *                      (often free, attribution may be required). Verify the
 *                      exact file page and credit terms.
 * - COMMERCIAL_STOCK → most important to catch: the image is likely being sold,
 *                      so a license must be purchased or the image replaced.
 * - SOCIAL_PLATFORM  → the image was uploaded by a user; the platform hosting
 *                      it is not the rights holder. Not license evidence.
 * - OTHER_SOURCE     → blogs, company sites, … often unlicensed reusers.
 *                      Useful to gauge spread, not to establish freedom.
 *
 * This is a screening aid only. A category never proves anything legal: a
 * free-media hit must still be the *same file* with its terms respected, and
 * a commercial-stock hit is a lead to verify, not a verdict.
 */

/** Categories, ordered by review priority for roll-ups. */
export type MatchCategory = "COMMERCIAL_STOCK" | "FREE_MEDIA" | "SOCIAL_PLATFORM" | "OTHER_SOURCE";

interface CategoryStyle {
  label: string;
  /** Compact badge text for table rows. */
  short: string;
  classes: string;
  /** One-line guidance shown in tooltips/detail panel. */
  hint: string;
}

export const MATCH_CATEGORY_STYLES: Record<MatchCategory, CategoryStyle> = {
  COMMERCIAL_STOCK: {
    label: "Commercial stock",
    short: "Stock",
    classes: "border-red-200 bg-red-50 text-red-700",
    hint: "Likely sold commercially — a license is probably required. Verify and purchase or replace.",
  },
  FREE_MEDIA: {
    label: "Free media library",
    short: "Free",
    classes: "border-emerald-200 bg-emerald-50 text-emerald-700",
    hint: "Known free-license library — verify the exact file page and follow its attribution terms.",
  },
  SOCIAL_PLATFORM: {
    label: "Social platform",
    short: "Social",
    classes: "border-blue-200 bg-blue-50 text-blue-700",
    hint: "User-uploaded on a platform — the platform is not the rights holder; find the original source.",
  },
  OTHER_SOURCE: {
    label: "Other source",
    short: "Other",
    classes: "border-neutral-200 bg-neutral-100 text-neutral-600",
    hint: "Other web page using the image — useful to gauge spread, not license evidence.",
  },
};

/** Roll-up order: highest review priority first. */
export const MATCH_CATEGORY_ORDER: readonly MatchCategory[] = [
  "COMMERCIAL_STOCK",
  "FREE_MEDIA",
  "SOCIAL_PLATFORM",
  "OTHER_SOURCE",
];

/** Domain matchers per category. Hostnames are lowercased before matching. */
const FREE_MEDIA_DOMAINS = [
  "unsplash.com",
  "pixabay.com",
  "pexels.com",
  "freepik.com",
  "commons.wikimedia.org",
  "flickr.com",
  "openverse.org",
  "smithsonianmag.com",
  "si.edu",
  "metmuseum.org",
  "getty.edu",
  "rawpixel.com",
  "publicdomainpictures.net",
  "freeimages.com",
  "stocksnap.io",
  "burst.shopify.com",
  "kaboompics.com",
  "libreshot.com",
  "picjumbo.com",
  "picsum.photos",
  "nasa.gov",
  "blogs.nasa.gov",
  "esa.int",
  "gov",
];

const COMMERCIAL_STOCK_DOMAINS = [
  "gettyimages.com",
  "shutterstock.com",
  "adobe.com",
  "stock.adobe.com",
  "istockphoto.com",
  "alamy.com",
  "dreamstime.com",
  "123rf.com",
  "depositphotos.com",
  "bigstockphoto.com",
  "pond5.com",
  "dissolve.com",
  "agefotostock.com",
  "photodune.net",
  "eyeem.com",
  "crestock.com",
  "canstockphoto.com",
  "mostphotos.com",
  "colourbox.com",
  "zoonar.com",
  "imago-images.de",
  "panthermedia.net",
  "fotolia.com",
];

const SOCIAL_PLATFORM_DOMAINS = [
  "youtube.com",
  "youtu.be",
  "facebook.com",
  "instagram.com",
  "tiktok.com",
  "x.com",
  "twitter.com",
  "linkedin.com",
  "pinterest.com",
  "pin.it",
  "reddit.com",
  "redd.it",
  "tumblr.com",
  "threads.net",
  "vk.com",
  "weibo.com",
  "quora.com",
  "medium.com",
  "substack.com",
  "wikipedia.org",
];

/** Longest-suffix-first list so `stock.adobe.com` wins over `adobe.com`. */
const CATEGORY_RULES: ReadonlyArray<{ category: MatchCategory; domains: readonly string[] }> = [
  { category: "COMMERCIAL_STOCK", domains: sortDomainSuffixes(COMMERCIAL_STOCK_DOMAINS) },
  { category: "FREE_MEDIA", domains: sortDomainSuffixes(FREE_MEDIA_DOMAINS) },
  { category: "SOCIAL_PLATFORM", domains: sortDomainSuffixes(SOCIAL_PLATFORM_DOMAINS) },
];

function sortDomainSuffixes(domains: readonly string[]): readonly string[] {
  return [...domains].sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
}

function stripWww(host: string): string {
  return host.startsWith("www.") ? host.slice(4) : host;
}

/** True when `host` is exactly `domain` or a subdomain of it. */
function hostMatchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** Extract and normalize the hostname of an arbitrary URL; "" when invalid. */
export function extractHost(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return stripWww(parsed.hostname.toLowerCase());
  } catch {
    return "";
  }
}

/** Categorize a match source URL; unknown hosts fall into OTHER_SOURCE. */
export function categorizeSourceUrl(url: string): MatchCategory {
  const host = extractHost(url);
  if (!host) return "OTHER_SOURCE";
  for (const rule of CATEGORY_RULES) {
    if (rule.domains.some((domain) => hostMatchesDomain(host, domain))) {
      return rule.category;
    }
  }
  return "OTHER_SOURCE";
}

/** Convenience: categorize every match of one result, keeping priority order. */
export function summarizeMatchCategories(
  matches: ReadonlyArray<{ sourceUrl: string }>,
): MatchCategory[] {
  const found = new Set<MatchCategory>();
  for (const match of matches) {
    found.add(categorizeSourceUrl(match.sourceUrl));
  }
  return MATCH_CATEGORY_ORDER.filter((category) => found.has(category));
}
