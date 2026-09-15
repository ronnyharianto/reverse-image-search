import { afterEach, describe, expect, it, vi } from "vitest";
import { SerpApiProvider } from "@/lib/reverse-search/serpapi";
import { GoogleVisionProvider } from "@/lib/reverse-search/google-vision";
import type { ImageInput } from "@/lib/reverse-search/provider";

const imageInput: ImageInput = {
  data: Buffer.from("fake-image-bytes"),
  mimeType: "image/jpeg",
  sha1: "a".repeat(40),
  sha256: "b".repeat(64),
  pageUrl: "https://example.test/about",
  imageUrl: "https://example.test/images/team.jpg",
};

describe("SerpApiProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("searches Google Lens by the image URL", async () => {
    let requestUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        requestUrl = input;
        return Response.json({
          visual_matches: [
            { title: "Team page", link: "https://stock.test/photos/1", source: "Stock Photos", exact_matches: true },
            { title: "Blog", link: "https://blog.test/post", source: "Blog" },
          ],
        });
      }),
    );

    const result = await new SerpApiProvider("test-key").search(imageInput);
    expect(requestUrl).toContain("engine=google_lens");
    expect(requestUrl).toContain("api_key=test-key");
    expect(requestUrl).toContain(encodeURIComponent(imageInput.imageUrl!));
    expect(result.searched).toBe(true);
    if (result.searched) {
      expect(result.status).toBe("MATCH_FOUND");
      expect(result.matches).toHaveLength(2);
      expect(result.matches[0]?.sourceUrl).toBe("https://stock.test/photos/1");
      expect(result.remark).toContain("1 exact");
    }
  });

  it("returns NO_MATCH when Lens finds no visual matches", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ visual_matches: [] })));
    const result = await new SerpApiProvider("test-key").search(imageInput);
    expect(result.searched).toBe(true);
    if (result.searched) expect(result.status).toBe("NO_MATCH");
  });

  it("skips (FAILED) when the image URL is unavailable", async () => {
    const result = await new SerpApiProvider("test-key").search({ ...imageInput, imageUrl: undefined });
    expect(result.searched).toBe(false);
    if (!result.searched) expect(result.status).toBe("FAILED");
  });

  it("fails without throwing on HTTP errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("denied", { status: 401 })));
    const result = await new SerpApiProvider("bad-key").search(imageInput);
    expect(result.searched).toBe(false);
    if (!result.searched) expect(result.remark).toContain("SERPAPI_API_KEY");
  });

  it("drops duplicate and non-http links", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          visual_matches: [
            { link: "https://ok.test/1" },
            { link: "https://ok.test/1" },
            { link: "javascript:alert(1)" },
          ],
        }),
      ),
    );
    const result = await new SerpApiProvider("test-key").search(imageInput);
    expect(result.searched).toBe(true);
    if (result.searched) expect(result.matches).toHaveLength(1);
  });
});

describe("GoogleVisionProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uploads base64 bytes and maps web detection matches", async () => {
    let requestBody = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string, init?: RequestInit) => {
        requestBody = String(init?.body ?? "");
        return Response.json({
          responses: [
            {
              webDetection: {
                pagesWithMatchingImages: [{ url: "https://site.test/page", pageTitle: "About Us" }],
                fullMatchingImages: [{ url: "https://cdn.test/full.jpg" }],
                partialMatchingImages: [{ url: "https://cdn.test/partial.jpg" }],
              },
            },
          ],
        });
      }),
    );

    const result = await new GoogleVisionProvider("vision-key").search(imageInput);
    expect(requestBody).toContain(JSON.parse(JSON.stringify(imageInput.data.toString("base64"))));
    expect(requestBody).toContain("WEB_DETECTION");
    expect(result.searched).toBe(true);
    if (result.searched) {
      expect(result.status).toBe("MATCH_FOUND");
      expect(result.matches.map((m) => m.sourceUrl)).toEqual([
        "https://site.test/page",
        "https://cdn.test/full.jpg",
        "https://cdn.test/partial.jpg",
      ]);
      expect(result.matches[0]?.sourceName).toContain("About Us");
    }
  });

  it("returns NO_MATCH when web detection has no matches", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ responses: [{ webDetection: {} }] })));
    const result = await new GoogleVisionProvider("vision-key").search(imageInput);
    expect(result.searched).toBe(true);
    if (result.searched) expect(result.status).toBe("NO_MATCH");
  });

  it("surfaces API errors as FAILED without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { message: "API key not valid" } })));
    const result = await new GoogleVisionProvider("bad-key").search(imageInput);
    expect(result.searched).toBe(false);
    if (!result.searched) expect(result.remark).toContain("API key not valid");
  });
});
