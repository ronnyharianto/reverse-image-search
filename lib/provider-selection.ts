/**
 * Persistence for the last-used reverse-search provider selection.
 *
 * The home page's provider picker starts from the scan defaults (Wikimedia
 * Commons only); the user's last explicit selection is remembered in
 * localStorage and restored on the next visit, so a user who runs every scan
 * with SerpAPI enabled does not have to re-tick it each time.
 *
 * Kept as a tiny pure-ish module so the merge logic is unit-testable without
 * a browser environment (vitest runs in Node).
 */

const STORAGE_KEY = "copyright-scanner:providers";

/** All provider ids the picker can show, in stable order. */
const KNOWN_PROVIDER_IDS = ["commons", "serpapi", "google-vision", "custom"] as const;

/**
 * Merge a stored selection with the freshly loaded provider catalog.
 *
 * - Keeps only ids that are both stored and in the catalog.
 * - A provider enabled in storage but now unconfigured (env var removed) is
 *   dropped — it cannot run, and showing it checked would mislead.
 * - Defaults are re-applied when the stored selection contains nothing valid
 *   (first visit, cleared storage, or everything filtered out), so the picker
 *   never starts empty.
 */
export function mergeStoredSelection(
  stored: readonly string[] | undefined,
  catalog: readonly { id: string; configured: boolean; defaultEnabled: boolean }[],
): string[] {
  const storedSet = new Set(
    (stored ?? []).filter((id): id is (typeof KNOWN_PROVIDER_IDS)[number] =>
      (KNOWN_PROVIDER_IDS as readonly string[]).includes(id),
    ),
  );

  const merged = catalog
    .filter((provider) => storedSet.has(provider.id as (typeof KNOWN_PROVIDER_IDS)[number]))
    .filter((provider) => provider.configured)
    .map((provider) => provider.id);

  if (merged.length === 0) {
    return catalog.filter((provider) => provider.configured && provider.defaultEnabled).map((p) => p.id);
  }

  return merged;
}

/** Read the last-used selection, or undefined when absent/corrupt. */
export function loadStoredSelection(): string[] | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return undefined;
  }
}

/** Persist the selection; failures (quota, privacy mode) are non-fatal. */
export function saveStoredSelection(ids: readonly string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // Non-fatal: the picker simply falls back to defaults next time.
  }
}
