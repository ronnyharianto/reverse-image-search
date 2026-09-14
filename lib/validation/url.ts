import { promises as dnsPromises } from "node:dns";

/**
 * URL validation, normalization and SSRF protection.
 *
 * Every URL entered by the user — and every URL we subsequently fetch
 * (crawl pages, image downloads, redirects) — must pass through here.
 * Only public http/https resources are allowed.
 */

export type UrlValidationResult =
  | { ok: true; url: string; hostname: string }
  | { ok: false; error: string };

/** Host names that always refer to the local machine or internal networks. */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "broadcasthost",
]);

/** Host name suffixes typically used by mDNS / internal networks. */
const BLOCKED_SUFFIXES = [".local", ".localhost", ".internal", ".home.arpa"];

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return true; // unparseable → treat as unsafe
  }
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true; // private / loopback / unspecified
  if (a === 169 && b === 254) return true; // link-local incl. cloud metadata 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true; // private range
  if (a === 192 && b === 168) return true; // private range
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT range
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmark range
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isPrivateIPv6(address: string): boolean {
  const addr = address.toLowerCase();
  if (addr === "::1" || addr === "::") return true; // loopback / unspecified
  if (addr.startsWith("fe8") || addr.startsWith("fe9") || addr.startsWith("fea") || addr.startsWith("feb")) {
    return true; // link-local fe80::/10
  }
  if (addr.startsWith("fc") || addr.startsWith("fd")) return true; // unique local fc00::/7
  if (addr.startsWith("::ffff:")) {
    // IPv4-mapped — validate the embedded IPv4
    return isPrivateIPv4(addr.slice("::ffff:".length));
  }
  if (addr.startsWith("64:ff9b:")) return true; // NAT64 well-known prefix
  if (addr.startsWith("2002:")) {
    // 6to4 — embedded IPv4 is the first 4 hex bytes after the prefix
    const hex = addr.slice("2002:".length).replace(/:/g, "").slice(0, 8);
    const octets: number[] = [];
    for (let i = 0; i + 2 <= hex.length; i += 2) {
      octets.push(parseInt(hex.slice(i, i + 2), 16));
    }
    if (octets.length === 4 && isPrivateIPv4(octets.join("."))) return true;
  }
  return false;
}

function isPrivateIp(ip: string): boolean {
  return ip.includes(":") ? isPrivateIPv6(ip) : isPrivateIPv4(ip);
}

/**
 * Synchronously check a URL string without DNS resolution.
 * Fast guard used for user input and for every URL extracted from pages.
 */
export function validateUrl(rawUrl: string): UrlValidationResult {
  const trimmed = rawUrl.trim();
  if (!trimmed) return { ok: false, error: "URL is empty." };
  if (/[\s<>"']/.test(trimmed)) {
    return { ok: false, error: "URL contains invalid characters." };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "URL is not a valid absolute URL." };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: `Protocol "${parsed.protocol.replace(":", "")}" is not allowed. Only http and https are supported.` };
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname) return { ok: false, error: "URL has no host name." };

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { ok: false, error: `Host "${hostname}" is not allowed.` };
  }
  if (BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    return { ok: false, error: `Host "${hostname}" is not allowed.` };
  }

  // Literal IPv4 (incl. obfuscated decimal/hex forms like 2130706433 or 0x7f.0.0.1)
  if (/^[\d.]+$/.test(hostname) || /^0x[0-9a-f.]+$/i.test(hostname)) {
    if (isPrivateIPv4(hostname)) {
      return { ok: false, error: "IP address is not allowed." };
    }
  } else if (hostname.includes(":")) {
    // Literal IPv6 — WHATWG URL keeps the surrounding brackets in .hostname
    const bareHost = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
    if (isPrivateIPv6(bareHost)) {
      return { ok: false, error: "IP address is not allowed." };
    }
  }

  return { ok: true, url: parsed.toString(), hostname };
}

/**
 * Full check including DNS resolution. Returns the first resolved IP so the
 * crawler can re-verify redirects. Guards against DNS-rebinding to private
 * ranges and against hostnames pointing at loopback/private addresses.
 */
export async function validateUrlWithDns(rawUrl: string): Promise<UrlValidationResult & { resolvedIps?: string[] }> {
  const base = validateUrl(rawUrl);
  if (!base.ok) return base;

  const { hostname } = base;
  const isLiteralIp = /^[\d.]+$/.test(hostname) || hostname.includes(":");
  const lookupTarget = isLiteralIp ? hostname.replace(/^\[|\]$/g, "") : hostname;

  let addresses: { address: string; family: number }[];
  try {
    addresses = isLiteralIp
      ? [{ address: lookupTarget, family: hostname.includes(":") ? 6 : 4 }]
      : await dnsPromises.lookup(hostname, { all: true, verbatim: true });
  } catch {
    return { ok: false, error: `Could not resolve host "${hostname}".` };
  }

  if (addresses.length === 0) {
    return { ok: false, error: `Host "${hostname}" has no IP addresses.` };
  }

  for (const { address } of addresses) {
    if (isPrivateIp(address)) {
      return { ok: false, error: `Host "${hostname}" resolves to a private/internal address and is not allowed.` };
    }
  }

  return { ...base, resolvedIps: addresses.map((a) => a.address) };
}

/**
 * Resolve a possibly-relative URL found on a page against that page's URL,
 * then validate the result. Data:/javascript:/blob: URLs are rejected.
 */
export function resolveAndValidateUrl(href: string, pageUrl: string): UrlValidationResult {
  const trimmed = href.trim();
  if (!trimmed) return { ok: false, error: "Empty URL." };
  if (/^(data|blob|javascript|file|ftp):/i.test(trimmed)) {
    return { ok: false, error: `URL scheme is not allowed.` };
  }
  let absolute: string;
  try {
    absolute = new URL(trimmed, pageUrl).toString();
  } catch {
    return { ok: false, error: "URL could not be resolved against the page URL." };
  }
  return validateUrl(absolute);
}

/** Normalize a URL for duplicate detection: sort query params, drop hash, strip default ports, unify host case. */
export function normalizeUrlForComparison(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase();
    if ((parsed.protocol === "http:" && parsed.port === "80") || (parsed.protocol === "https:" && parsed.port === "443")) {
      parsed.port = "";
    }
    // Normalize empty path to "/"
    if (parsed.pathname === "") parsed.pathname = "/";
    // Sort search params for stable comparison
    const entries = [...parsed.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
    const search = new URLSearchParams(entries);
    search.sort();
    parsed.search = entries.length > 0 ? search.toString() : "";
    return parsed.toString();
  } catch {
    return url;
  }
}

/** True when candidateUrl points at the same site as targetUrl (host + optional www equivalence). */
export function isSameSite(candidateUrl: string, targetUrl: string): boolean {
  try {
    const candidate = new URL(candidateUrl);
    const target = new URL(targetUrl);
    const normalizeHost = (host: string) => host.toLowerCase().replace(/^www\./, "");
    if (candidate.protocol !== "http:" && candidate.protocol !== "https:") return false;
    return normalizeHost(candidate.hostname) === normalizeHost(target.hostname);
  } catch {
    return false;
  }
}

/**
 * Async guard for redirect targets: validates the URL and, when the host is a
 * hostname (not a literal IP), resolves DNS to block private-address targets.
 */
export async function isUrlSafeToFetch(url: string): Promise<boolean> {
  const result = await validateUrlWithDns(url);
  return result.ok;
}
