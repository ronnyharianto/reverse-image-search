import { resolveAndValidateUrl, type UrlValidationResult } from "@/lib/validation/url";

/**
 * Image extraction.
 *
 * `collectImageElementsInPage` runs inside the browser (Playwright) and only
 * reads DOM attributes into plain objects. All actual logic — srcset parsing,
 * candidate selection, URL resolution and validation — lives in pure Node
 * functions below so it can be unit-tested without a browser.
 */

/** Plain snapshot of an <img>/<source> element's interesting attributes. */
export interface ImageElementInfo {
  src?: string;
  dataSrc?: string;
  dataLazySrc?: string;
  dataOriginal?: string;
  srcset?: string;
}

export interface SrcsetCandidate {
  url: string;
  width?: number;
  density?: number;
}

/** Parse a srcset attribute value into candidates. Tolerant of odd whitespace. */
export function parseSrcset(srcset: string): SrcsetCandidate[] {
  const candidates: SrcsetCandidate[] = [];
  for (const part of srcset.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [url, ...descriptors] = trimmed.split(/\s+/);
    if (!url) continue;
    const candidate: SrcsetCandidate = { url };
    for (const descriptor of descriptors) {
      const widthMatch = /^(\d+)w$/.exec(descriptor);
      const densityMatch = /^(\d+(?:\.\d+)?)x$/.exec(descriptor);
      if (widthMatch) candidate.width = Number(widthMatch[1]);
      if (densityMatch) candidate.density = Number(densityMatch[1]);
    }
    candidates.push(candidate);
  }
  return candidates;
}

/** Pick the highest-resolution candidate from a srcset value. */
export function pickBestSrcsetCandidate(srcset: string): string | null {
  const candidates = parseSrcset(srcset);
  if (candidates.length === 0) return null;
  const withWidth = candidates.filter((c) => c.width !== undefined);
  if (withWidth.length > 0) {
    return withWidth.reduce((best, c) => ((c.width ?? 0) > (best.width ?? 0) ? c : best)).url;
  }
  const withDensity = candidates.filter((c) => c.density !== undefined);
  if (withDensity.length > 0) {
    return withDensity.reduce((best, c) => ((c.density ?? 0) > (best.density ?? 0) ? c : best)).url;
  }
  return candidates[0].url;
}

/**
 * Select the best image URL from one element's attributes.
 * Priority: lazy-load attributes first (they usually hold the full-size
 * image when present), then the best srcset candidate, then src.
 * Returns the first candidate that passes URL validation.
 */
export function selectImageUrl(info: ImageElementInfo, pageUrl: string): UrlValidationResult {
  const orderedCandidates = [
    info.dataSrc,
    info.dataLazySrc,
    info.dataOriginal,
    info.srcset ? pickBestSrcsetCandidate(info.srcset) : null,
    info.src,
  ].filter((candidate): candidate is string => Boolean(candidate && candidate.trim()));

  let lastError: string | null = null;
  for (const candidate of orderedCandidates) {
    const result = resolveAndValidateUrl(candidate, pageUrl);
    if (result.ok) return result;
    lastError = result.error;
  }
  return { ok: false, error: lastError ?? "No usable image URL on element." };
}

/**
 * Runs inside the browser via page.evaluate. Must stay fully self-contained:
 * no imports, no references to module scope, no closures over outer variables.
 */
export function collectImageElementsInPage(): ImageElementInfo[] {
  const elements: ImageElementInfo[] = [];
  const seen = new WeakSet<Element>();

  const record = (el: Element) => {
    if (seen.has(el)) return;
    seen.add(el);
    const attr = (name: string) => {
      const value = el.getAttribute(name);
      return value === null || value.trim() === "" ? undefined : value.trim();
    };
    elements.push({
      src: attr("src"),
      dataSrc: attr("data-src"),
      dataLazySrc: attr("data-lazy-src"),
      dataOriginal: attr("data-original"),
      srcset: attr("srcset"),
    });
  };

  for (const el of Array.from(document.querySelectorAll("img"))) record(el);
  for (const el of Array.from(document.querySelectorAll("picture source"))) record(el);

  return elements;
}
