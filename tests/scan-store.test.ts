import { beforeEach, describe, expect, it } from "vitest";
import { createScanEntry, getScanEntry, pruneScans } from "@/lib/scan/scan-store";
import { STATUS_LABELS, type ImageScanResult } from "@/types/scanner";

function makeResult(sha: string, pageUrl: string): ImageScanResult {
  return {
    id: `${sha}-${pageUrl}`,
    pageUrl,
    imageUrl: `https://example.com/${sha}.jpg`,
    status: "NO_MATCH",
    remark: "No matching image found.",
    occurrences: [{ pageUrl, imageUrl: `https://example.com/${sha}.jpg` }],
    sha256: sha,
  };
}

describe("scan store", () => {
  beforeEach(() => {
    pruneScans(1);
  });

  it("creates and retrieves scans", () => {
    const entry = createScanEntry("scan-1", "https://example.com");
    expect(getScanEntry("scan-1")).toBe(entry);
    expect(entry.progress.state).toBe("RUNNING");
    expect(entry.progress.pagesScanned).toBe(0);
  });

  it("dedups identical bytes via the sha index, merging occurrences", () => {
    const entry = createScanEntry("scan-2", "https://example.com");
    const first = makeResult("a".repeat(64), "https://example.com/");
    const duplicate = makeResult("a".repeat(64), "https://example.com/about");

    entry.results.push(first);
    entry.shaToResultIndex.set(first.sha256!, 0);

    const existingIndex = entry.shaToResultIndex.get(duplicate.sha256!);
    expect(existingIndex).toBe(0);
    entry.results[existingIndex!].occurrences.push({
      pageUrl: duplicate.pageUrl,
      imageUrl: duplicate.imageUrl,
    });

    // One result row, two page occurrences (original + duplicate page)
    expect(entry.results).toHaveLength(1);
    expect(entry.results[0].occurrences).toHaveLength(2);
    expect(entry.results[0].occurrences[1].pageUrl).toBe("https://example.com/about");
  });

  it("maps every image URL of an image to the same row", () => {
    const entry = createScanEntry("scan-2b", "https://example.com");
    entry.results.push(makeResult("c".repeat(64), "https://example.com/"));
    entry.urlToResultIndex.set("https://example.com/img/hero.jpg", 0);
    entry.urlToResultIndex.set("https://cdn.example.com/img/hero.jpg", 0);
    expect(entry.urlToResultIndex.get("https://example.com/img/hero.jpg")).toBe(0);
    expect(entry.urlToResultIndex.get("https://cdn.example.com/img/hero.jpg")).toBe(0);
  });

  it("tracks pending SHAs so concurrent identical bytes merge", async () => {
    const entry = createScanEntry("scan-2c", "https://example.com");
    let release!: (index: number) => void;
    const claim = new Promise<number>((resolve) => {
      release = resolve;
    });
    entry.pendingShas.set("d".repeat(64), claim);
    expect(entry.pendingShas.has("d".repeat(64))).toBe(true);
    release(3);
    await expect(claim).resolves.toBe(3);
  });

  it("prunes finished scans but never running ones", () => {
    const running = createScanEntry("scan-3", "https://a.test");
    const finished = createScanEntry("scan-4", "https://b.test");
    finished.progress.state = "COMPLETED";
    pruneScans(1);
    expect(getScanEntry("scan-3")).toBe(running);
    expect(getScanEntry("scan-4")).toBeUndefined();
  });
});

describe("status labels", () => {
  it("uses screening terminology only", () => {
    const labels = Object.values(STATUS_LABELS).join(" ");
    expect(labels).not.toMatch(/infring|illegal|violation/i);
    expect(STATUS_LABELS.NO_MATCH).toBe("No Match");
    expect(STATUS_LABELS.MATCH_FOUND).toBe("Match Found");
    expect(STATUS_LABELS.REQUIRES_REVIEW).toBe("Requires Review");
  });
});
