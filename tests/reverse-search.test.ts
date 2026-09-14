import { afterEach, describe, expect, it, vi } from "vitest";
import { mergeProviderResults } from "@/lib/reverse-search";
import { WikimediaCommonsProvider } from "@/lib/reverse-search/commons";
import { getCustomProviderConfig, CustomProvider } from "@/lib/reverse-search/custom";
import type { ImageInput } from "@/lib/reverse-search/provider";

const imageInput: ImageInput = {
  data: Buffer.from("fake"),
  mimeType: "image/jpeg",
  sha1: "a".repeat(40),
  sha256: "b".repeat(64),
};

describe("mergeProviderResults", () => {
  it("prefers MATCH_FOUND over NO_MATCH", () => {
    const merged = mergeProviderResults(
      { searched: true, status: "NO_MATCH", remark: "none", matches: [] },
      { searched: true, status: "MATCH_FOUND", remark: "hit", matches: [{ sourceName: "X", sourceUrl: "https://x.test/1", providerId: "t" }] },
    );
    expect(merged.status).toBe("MATCH_FOUND");
    expect(merged.matches).toHaveLength(1);
  });

  it("reports NO_MATCH when providers genuinely searched and found nothing", () => {
    const merged = mergeProviderResults(
      { searched: true, status: "NO_MATCH", remark: "No matching image on Wikimedia Commons.", matches: [] },
    );
    expect(merged.status).toBe("NO_MATCH");
  });

  it("never fakes a match when no provider ran", () => {
    const merged = mergeProviderResults(undefined, undefined);
    expect(merged.status).toBe("REQUIRES_REVIEW");
    expect(merged.matches).toHaveLength(0);
  });

  it("reports FAILED only when all providers failed", () => {
    const merged = mergeProviderResults({ searched: false, status: "FAILED", remark: "boom" });
    expect(merged.status).toBe("FAILED");
  });

  it("drops non-http match URLs", () => {
    const merged = mergeProviderResults({
      searched: true,
      status: "MATCH_FOUND",
      remark: "hit",
      matches: [
        { sourceName: "good", sourceUrl: "https://ok.test/a", providerId: "t" },
        { sourceName: "bad", sourceUrl: "javascript:alert(1)", providerId: "t" },
      ],
    });
    expect(merged.matches).toHaveLength(1);
    expect(merged.matches[0].sourceUrl).toBe("https://ok.test/a");
  });
});

describe("WikimediaCommonsProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns MATCH_FOUND with source URLs when Commons has the SHA-1", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          query: {
            allimages: [
              {
                title: "File:Example.jpg",
                descriptionurl: "https://commons.wikimedia.org/wiki/File:Example.jpg",
                mime: "image/jpeg",
              },
            ],
          },
        }),
      ),
    );

    const provider = new WikimediaCommonsProvider();
    const result = await provider.search(imageInput);
    expect(result.searched).toBe(true);
    if (result.searched) {
      expect(result.status).toBe("MATCH_FOUND");
      expect(result.matches[0]?.sourceUrl).toBe("https://commons.wikimedia.org/wiki/File:Example.jpg");
    }
    const calledWith = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledWith).toContain("aisha1=" + "a".repeat(40));
  });

  it("returns NO_MATCH when Commons returns no files", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ query: { allimages: [] } })));
    const result = await new WikimediaCommonsProvider().search(imageInput);
    expect(result.searched).toBe(true);
    if (result.searched) expect(result.status).toBe("NO_MATCH");
  });

  it("returns FAILED on HTTP errors without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("denied", { status: 403 })));
    const result = await new WikimediaCommonsProvider().search(imageInput);
    expect(result.searched).toBe(false);
    if (!result.searched) expect(result.status).toBe("FAILED");
  });
});

describe("CustomProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("is disabled without configuration", () => {
    vi.stubEnv("REVERSE_SEARCH_CUSTOM_URL", "");
    expect(getCustomProviderConfig()).toBeNull();
  });

  it("substitutes hash placeholders and normalizes matches", async () => {
    vi.stubEnv("REVERSE_SEARCH_CUSTOM_URL", "https://api.test/lookup/{sha256}");
    vi.stubEnv("REVERSE_SEARCH_CUSTOM_API_KEY", "secret");

    let receivedUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        receivedUrl = input;
        return Response.json({ results: [{ sourceName: "Stock Site", sourceUrl: "https://stock.test/1", similarity: 92 }] });
      }),
    );

    const config = getCustomProviderConfig();
    expect(config).not.toBeNull();
    const result = await new CustomProvider(config!).search(imageInput);
    expect(receivedUrl).toBe(`https://api.test/lookup/${"b".repeat(64)}`);
    expect(result.searched).toBe(true);
    if (result.searched) {
      expect(result.status).toBe("MATCH_FOUND");
      expect(result.matches[0]?.similarity).toBe(92);
    }
  });
});
