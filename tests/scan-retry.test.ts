import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rm, mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { ImageInput, ProviderResult, ReverseImageSearchProvider } from "@/lib/reverse-search/provider";
import type { ImageScanResult } from "@/types/scanner";

const mocks = vi.hoisted(() => ({
  downloadImage: vi.fn(),
  inspectImage: vi.fn(),
  fingerprintImage: vi.fn(),
  saveThumbnail: vi.fn(),
  getProviders: vi.fn(),
}));

vi.mock("@/lib/image/downloader", () => ({ downloadImage: mocks.downloadImage }));
vi.mock("@/lib/image/metadata", () => ({ inspectImage: mocks.inspectImage }));
vi.mock("@/lib/image/fingerprint", () => ({ fingerprintImage: mocks.fingerprintImage }));
vi.mock("@/lib/image/thumbnails", () => ({ saveThumbnail: mocks.saveThumbnail }));
vi.mock("@/lib/reverse-search", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/reverse-search")>();
  return { ...actual, getProviders: mocks.getProviders };
});

import { rerunFailedProviderLookups, retryImageLookup } from "@/lib/scan/retry";
import { createScanEntry, getScanEntry, pruneScans } from "@/lib/scan/scan-store";
import { saveScanSnapshot } from "@/lib/scan/scan-persistence";

const ORIGINAL_CWD = process.cwd();
const SANDBOX = path.join(ORIGINAL_CWD, "data", "results", ".retry-test-sandbox");

function makeProvider(
  id: string,
  result: ProviderResult | ((image: ImageInput) => Promise<ProviderResult>),
): ReverseImageSearchProvider {
  return {
    id,
    displayName: id,
    description: "test provider",
    search: async (image: ImageInput) => (typeof result === "function" ? result(image) : result),
  };
}

function makeImageInput(): ImageInput {
  return {
    data: Buffer.from("fake-image-bytes"),
    mimeType: "image/jpeg",
    sha1: "a".repeat(40),
    sha256: "b".repeat(64),
    pageUrl: "https://example.com/about",
    imageUrl: "https://example.com/images/team.jpg",
  };
}

function makeDraft(): ImageScanResult {
  return {
    id: "result-1",
    pageUrl: "https://example.com/about",
    imageUrl: "https://example.com/images/team.jpg",
    status: "FAILED",
    remark: "Google Lens request failed (HTTP 500).",
    providerOutcomes: [
      { providerId: "commons", searched: true, status: "NO_MATCH", matchCount: 0, remark: "No match." },
      { providerId: "serpapi", searched: false, status: "FAILED", matchCount: 0, remark: "Google Lens request failed (HTTP 500)." },
    ],
    occurrences: [{ pageUrl: "https://example.com/about", imageUrl: "https://example.com/images/team.jpg" }],
    sha256: "b".repeat(64),
  };
}

function stubHappyDownload(): void {
  mocks.downloadImage.mockResolvedValue({
    ok: true,
    data: Buffer.from("fake-image-bytes"),
    contentType: "image/jpeg",
    finalUrl: "https://example.com/images/team.jpg",
  });
  mocks.inspectImage.mockResolvedValue({ ok: true, width: 100, height: 100, mimeType: "image/jpeg", format: "jpeg" });
  mocks.fingerprintImage.mockResolvedValue({ sha256: "b".repeat(64), sha1: "a".repeat(40), ahash: 0n, dhash: 0n });
  mocks.saveThumbnail.mockResolvedValue(null);
}

beforeEach(async () => {
  process.chdir(ORIGINAL_CWD);
  await rm(SANDBOX, { recursive: true, force: true });
  await mkdir(SANDBOX, { recursive: true });
  process.chdir(SANDBOX);
  stubHappyDownload();
});

afterEach(async () => {
  process.chdir(ORIGINAL_CWD);
  await rm(SANDBOX, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

describe("rerunFailedProviderLookups", () => {
  it("re-runs only the failed provider and keeps the successful one", async () => {
    const commonsSearch = vi.fn();
    const serpapiSearch = vi.fn(async (): Promise<ProviderResult> => ({
      searched: true,
      status: "MATCH_FOUND",
      remark: "Potential match found on Google Lens (2 visual match sources).",
      matches: [
        { sourceName: "Google Lens — Stock", sourceUrl: "https://stock.test/photos/1", providerId: "serpapi" },
        { sourceName: "Google Lens — Blog", sourceUrl: "https://blog.test/post", providerId: "serpapi" },
      ],
    }));

    // commons already succeeded for this row → must NOT be invoked again.
    const providers = [
      makeProvider("commons", commonsSearch as unknown as ProviderResult),
      makeProvider("serpapi", serpapiSearch),
    ];

    const draft = makeDraft();
    await rerunFailedProviderLookups(makeImageInput(), draft, providers);

    expect(commonsSearch).not.toHaveBeenCalled();
    expect(serpapiSearch).toHaveBeenCalledTimes(1);

    // serpapi outcome replaced, commons untouched
    const outcomes = draft.providerOutcomes ?? [];
    expect(outcomes.find((o) => o.providerId === "serpapi")?.searched).toBe(true);
    expect(outcomes.find((o) => o.providerId === "serpapi")?.matchCount).toBe(2);
    expect(outcomes.find((o) => o.providerId === "commons")?.status).toBe("NO_MATCH");

    // row promoted from FAILED to MATCH_FOUND with the merged remark
    expect(draft.status).toBe("MATCH_FOUND");
    expect(draft.remark).toContain("Manual verification required");
    expect(draft.reverseSearchResults?.map((m) => m.sourceUrl)).toContain("https://stock.test/photos/1");
  });

  it("keeps NO_MATCH when the retried provider still finds nothing", async () => {
    const providers = [
      makeProvider("serpapi", {
        searched: true,
        status: "NO_MATCH",
        remark: "No matching image found on Google Lens.",
        matches: [],
      }),
    ];
    const draft = makeDraft();
    await rerunFailedProviderLookups(makeImageInput(), draft, providers);

    expect(draft.status).toBe("NO_MATCH");
    expect(draft.remark).toBe("No matching image found on Google Lens.");
    expect(draft.reverseSearchResults).toBeUndefined();
  });

  it("stays FAILED when the retried provider fails again", async () => {
    const providers = [
      makeProvider("serpapi", { searched: false, status: "FAILED", remark: "Google Lens lookup failed: timeout" }),
    ];
    const draft = makeDraft();
    await rerunFailedProviderLookups(makeImageInput(), draft, providers);

    expect(draft.status).toBe("FAILED");
    expect(draft.remark).toBe("Google Lens lookup failed: timeout");
    const serpapi = draft.providerOutcomes?.find((o) => o.providerId === "serpapi");
    expect(serpapi?.searched).toBe(false);
  });

  it("categorizes and sanitizes new matches", async () => {
    const providers = [
      makeProvider("serpapi", {
        searched: true,
        status: "MATCH_FOUND",
        remark: "Potential match found.",
        matches: [
          { sourceName: "Getty", sourceUrl: "https://www.gettyimages.com/photos/x", providerId: "serpapi" },
          { sourceName: "Bad", sourceUrl: "javascript:alert(1)", providerId: "serpapi" },
        ],
      }),
    ];
    const draft = makeDraft();
    await rerunFailedProviderLookups(makeImageInput(), draft, providers);

    const urls = draft.reverseSearchResults?.map((m) => m.sourceUrl) ?? [];
    expect(urls).toContain("https://www.gettyimages.com/photos/x");
    expect(urls).not.toContain("javascript:alert(1)");
    expect(draft.reverseSearchResults?.find((m) => m.sourceUrl.includes("gettyimages"))?.category).toBe(
      "COMMERCIAL_STOCK",
    );
  });
});

describe("retryImageLookup", () => {
  it("rejects while the scan is still running", async () => {
    createScanEntry("retry-running", "https://example.com").progress.state = "RUNNING";

    const outcome = await retryImageLookup("retry-running", "missing-result");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("still running");
  });

  it("rejects unknown result ids", async () => {
    createScanEntry("retry-empty", "https://example.com").progress.state = "COMPLETED";
    const outcome = await retryImageLookup("retry-empty", "missing-result");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("Result not found");
  });

  it("updates the auto-saved JSON file after a successful retry", async () => {
    const scanId = "retry-saved-1";
    const entry = createScanEntry(scanId, "https://example.com/");
    entry.progress.state = "COMPLETED";
    entry.results.push(makeDraft());

    // Simulate the auto-save that runs when a scan completes.
    await saveScanSnapshot({ progress: { ...entry.progress }, results: entry.results });

    // No providers configured for this scan → the row is committed unchanged.
    mocks.getProviders.mockReturnValue({});

    const outcome = await retryImageLookup(scanId, "result-1");
    expect(outcome.ok).toBe(true);

    if (outcome.ok) {
      expect(outcome.savedFilePath).toContain("example.com");
      expect(outcome.result.status).toBe("FAILED");
      expect(outcome.result.providerOutcomes?.length).toBe(2);
    }

    const savedRaw = await readFile(path.join(SANDBOX, "data", "results", "example.com.json"), "utf8");
    const saved = JSON.parse(savedRaw) as { snapshot: { results: ImageScanResult[] } };
    expect(saved.snapshot.results).toHaveLength(1);
    expect(saved.snapshot.results[0].id).toBe("result-1");
  });

  it("refreshes a FAILED row via the configured providers and persists it", async () => {
    const scanId = "retry-success";
    const entry = createScanEntry(scanId, "https://example.com/");
    entry.progress.state = "COMPLETED";
    entry.results.push(makeDraft());
    await saveScanSnapshot({ progress: { ...entry.progress }, results: entry.results });

    mocks.getProviders.mockReturnValue({
      serpapi: makeProvider("serpapi", {
        searched: true,
        status: "MATCH_FOUND",
        remark: "Potential match found on Google Lens (1 visual match source).",
        matches: [{ sourceName: "Google Lens — Stock", sourceUrl: "https://stock.test/photos/1", providerId: "serpapi" }],
      }),
    });

    const outcome = await retryImageLookup(scanId, "result-1");
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.status).toBe("MATCH_FOUND");
      expect(outcome.result.providerOutcomes?.find((o) => o.providerId === "serpapi")?.searched).toBe(true);
    }

    const savedRaw = await readFile(path.join(SANDBOX, "data", "results", "example.com.json"), "utf8");
    const saved = JSON.parse(savedRaw) as { snapshot: { results: ImageScanResult[] } };
    expect(saved.snapshot.results[0].status).toBe("MATCH_FOUND");
    expect(saved.snapshot.results[0].reverseSearchResults?.[0]?.sourceUrl).toBe("https://stock.test/photos/1");
  });

  it("aborts without committing when the image changed on the server", async () => {
    const scanId = "retry-changed";
    const entry = createScanEntry(scanId, "https://example.com/");
    entry.progress.state = "COMPLETED";
    entry.results.push(makeDraft());

    mocks.fingerprintImage.mockResolvedValue({ sha256: "c".repeat(64), sha1: "a".repeat(40), ahash: 0n, dhash: 0n });

    const outcome = await retryImageLookup(scanId, "result-1");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("changed");
    expect(entry.results[0].status).toBe("FAILED");
  });

  it("does not write a JSON file when the scan was never saved", async () => {
    const scanId = "retry-unsaved";
    const entry = createScanEntry(scanId, "https://unsaved.example/");
    entry.progress.state = "COMPLETED";
    entry.results.push(makeDraft());

    mocks.getProviders.mockReturnValue({});

    const outcome = await retryImageLookup(scanId, "result-1");
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.savedFilePath).toBeNull();

    // Nothing was saved, so data/results may not exist at all.
    let files: string[] = [];
    try {
      files = await readdir(path.join(SANDBOX, "data", "results"));
    } catch {
      files = [];
    }
    expect(files.filter((f) => f.endsWith(".json"))).toHaveLength(0);
  });

  it("reports mode 'live' when the scan is still in memory", async () => {
    const scanId = "retry-mode-live";
    const entry = createScanEntry(scanId, "https://example.com/");
    entry.progress.state = "COMPLETED";
    entry.results.push(makeDraft());
    mocks.getProviders.mockReturnValue({});

    const outcome = await retryImageLookup(scanId, "result-1");
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.mode).toBe("live");
  });

  it("runs one retry at a time per result row", async () => {
    const scanId = "retry-concurrent";
    const entry = createScanEntry(scanId, "https://example.com/");
    entry.progress.state = "COMPLETED";
    entry.results.push(makeDraft());

    mocks.getProviders.mockReturnValue({});

    // Two concurrent retries: the second must be rejected while the first holds the lock.
    const [first, second] = await Promise.all([
      retryImageLookup(scanId, "result-1"),
      retryImageLookup(scanId, "result-1"),
    ]);
    expect(first.ok || second.ok).toBe(true);
    expect(first.ok && second.ok).toBe(false);
    if (!first.ok) expect(first.error).toContain("already in progress");
    if (!second.ok) expect(second.error).toContain("already in progress");
  });

  describe("snapshot fallback (live scan gone)", () => {
    /** Evict finished scans so getScanEntry(scanId) is undefined. */
    function evictLiveEntry(): void {
      createScanEntry("__sentinel__", "https://sentinel.test"); // stays RUNNING
      pruneScans(1);
    }

    it("retries from the saved snapshot when the live scan no longer exists", async () => {
      const scanId = "retry-snapshot-1";
      const entry = createScanEntry(scanId, "https://example.com/");
      entry.progress.state = "COMPLETED";
      entry.progress.providers = ["serpapi"];
      entry.results.push(makeDraft());
      await saveScanSnapshot({ progress: { ...entry.progress }, results: entry.results });

      mocks.getProviders.mockReturnValue({
        serpapi: makeProvider("serpapi", {
          searched: true,
          status: "MATCH_FOUND",
          remark: "Potential match found on Google Lens (1 visual match source).",
          matches: [{ sourceName: "Google Lens — Stock", sourceUrl: "https://stock.test/photos/1", providerId: "serpapi" }],
        }),
      });

      evictLiveEntry();
      expect(getScanEntry(scanId)).toBeUndefined();

      const outcome = await retryImageLookup(scanId, "result-1");
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.mode).toBe("snapshot");
      expect(outcome.result.status).toBe("MATCH_FOUND");
      expect(outcome.savedFilePath).toContain("example.com");

      // The snapshot file was refreshed in place.
      const savedRaw = await readFile(path.join(SANDBOX, "data", "results", "example.com.json"), "utf8");
      const saved = JSON.parse(savedRaw) as { snapshot: { results: ImageScanResult[] } };
      expect(saved.snapshot.results[0].status).toBe("MATCH_FOUND");
      expect(saved.snapshot.results[0].reverseSearchResults?.[0]?.sourceUrl).toBe("https://stock.test/photos/1");
    });

    it("rejects rows that exist in neither memory nor the snapshot", async () => {
      const scanId = "retry-snapshot-2";
      const entry = createScanEntry(scanId, "https://example.com/");
      entry.progress.state = "COMPLETED";
      entry.results.push(makeDraft());
      await saveScanSnapshot({ progress: { ...entry.progress }, results: entry.results });

      evictLiveEntry();

      const outcome = await retryImageLookup(scanId, "no-such-row");
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.error).toContain("saved result file");
    });

    it("explains when neither a live scan nor a saved file exists", async () => {
      evictLiveEntry();

      const outcome = await retryImageLookup("retry-snapshot-3", "result-1");
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error).toContain("Scan not found");
        expect(outcome.error).toContain("no saved result file");
      }
    });
  });
});
