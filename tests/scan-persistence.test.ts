import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  deleteScanSnapshot,
  loadScanSnapshot,
  loadScanSnapshotWithTimestamp,
  saveScanSnapshot,
  targetUrlToFileName,
} from "@/lib/scan/scan-persistence";
import type { ScanSnapshot } from "@/types/scanner";

// The persistence module resolves data/results relative to process.cwd();
// tests run from the project root, so redirect it at a temp sandbox and
// restore afterwards.
const ORIGINAL_CWD = process.cwd();
const SANDBOX = path.join(ORIGINAL_CWD, "data", "results", ".test-sandbox");

function makeSnapshot(targetUrl: string, scanId = "scan-test-1"): ScanSnapshot {
  return {
    progress: {
      scanId,
      targetUrl,
      state: "COMPLETED",
      pagesScanned: 3,
      imagesFound: 5,
      imagesProcessed: 5,
      startedAt: new Date().toISOString(),
      providers: ["commons"],
    },
    results: [],
  };
}

beforeEach(async () => {
  process.chdir(ORIGINAL_CWD);
  await rm(SANDBOX, { recursive: true, force: true });
  await mkdir(SANDBOX, { recursive: true });
  process.chdir(SANDBOX);
});

afterEach(async () => {
  process.chdir(ORIGINAL_CWD);
  await rm(SANDBOX, { recursive: true, force: true });
});

describe("targetUrlToFileName", () => {
  it("maps URLs to readable, filesystem-safe names", () => {
    expect(targetUrlToFileName("https://example.com/")).toBe("example.com");
    expect(targetUrlToFileName("https://www.example.com/")).toBe("example.com");
    expect(targetUrlToFileName("https://example.com/about/team")).toBe("example.com-about-team");
    // Query strings are dropped — one snapshot per path, and '?'/'&' are unsafe.
    expect(targetUrlToFileName("https://example.com/a?b=1&c=2")).toBe("example.com-a");
  });

  it("never produces path-traversing names", () => {
    const name = targetUrlToFileName("https://example.com/../../etc/passwd");
    expect(name).not.toContain("..");
    expect(name).toMatch(/^[a-zA-Z0-9.-]+$/);
  });
});

describe("save/load/deleteScanSnapshot", () => {
  it("round-trips a snapshot and overwrites on re-save", async () => {
    const first = makeSnapshot("https://example.com/", "scan-aaa");
    await saveScanSnapshot(first);
    const loaded = await loadScanSnapshot("https://example.com/");
    expect(loaded?.progress.scanId).toBe("scan-aaa");

    const second = makeSnapshot("https://example.com/", "scan-bbb");
    await saveScanSnapshot(second);
    const reloaded = await loadScanSnapshot("https://example.com/");
    expect(reloaded?.progress.scanId).toBe("scan-bbb");

    const savedPath = path.join(SANDBOX, "data", "results", "example.com.json");
    await expect(stat(savedPath)).resolves.toBeDefined();
  });

  it("distinguishes targets by URL path", async () => {
    await saveScanSnapshot(makeSnapshot("https://example.com/", "scan-root"));
    await saveScanSnapshot(makeSnapshot("https://example.com/about", "scan-about"));
    expect((await loadScanSnapshot("https://example.com/"))?.progress.scanId).toBe("scan-root");
    expect((await loadScanSnapshot("https://example.com/about"))?.progress.scanId).toBe("scan-about");
  });

  it("returns null for unknown URLs and handles delete of missing files", async () => {
    expect(await loadScanSnapshot("https://never-scanned.test/")).toBeNull();
    expect(await deleteScanSnapshot("https://never-scanned.test/")).toBe(false);
  });

  it("returns the savedAt timestamp alongside the snapshot", async () => {
    await saveScanSnapshot(makeSnapshot("https://example.com/", "scan-timed"));
    const { snapshot, savedAt } = await loadScanSnapshotWithTimestamp("https://example.com/");
    expect(snapshot?.progress.scanId).toBe("scan-timed");
    expect(savedAt).toEqual(expect.any(String));
    expect(Number.isNaN(new Date(savedAt!).getTime())).toBe(false);
  });

  it("tolerates legacy files without a savedAt timestamp", async () => {
    const resultsDir = path.join(process.cwd(), "data", "results");
    await mkdir(resultsDir, { recursive: true });
    await writeFile(
      path.join(resultsDir, "legacy.test.json"),
      JSON.stringify({ snapshot: makeSnapshot("https://legacy.test/", "scan-legacy") }),
      "utf8",
    );
    const { snapshot, savedAt } = await loadScanSnapshotWithTimestamp("https://legacy.test/");
    expect(snapshot?.progress.scanId).toBe("scan-legacy");
    expect(savedAt).toBeNull();
  });

  it("rejects corrupt snapshot files instead of throwing", async () => {
    const resultsDir = path.join(process.cwd(), "data", "results");
    await mkdir(resultsDir, { recursive: true });
    await writeFile(path.join(resultsDir, "broken.test.json"), "{corrupt", "utf8");
    expect(await loadScanSnapshot("https://broken.test/")).toBeNull();
  });
});
