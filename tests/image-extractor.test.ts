import { describe, expect, it } from "vitest";
import { parseSrcset, pickBestSrcsetCandidate, selectImageUrl } from "@/lib/crawler/image-extractor";

describe("parseSrcset", () => {
  it("parses width descriptors", () => {
    const candidates = parseSrcset("a.jpg 480w, b.jpg 1024w");
    expect(candidates).toEqual([
      { url: "a.jpg", width: 480 },
      { url: "b.jpg", width: 1024 },
    ]);
  });

  it("parses density descriptors and bare URLs", () => {
    expect(parseSrcset("a.jpg 2x, b.jpg")).toEqual([
      { url: "a.jpg", density: 2 },
      { url: "b.jpg" },
    ]);
  });

  it("tolerates messy whitespace and trailing commas", () => {
    expect(parseSrcset(" a.jpg 480w , , b.jpg 2x ")).toEqual([
      { url: "a.jpg", width: 480 },
      { url: "b.jpg", density: 2 },
    ]);
  });
});

describe("pickBestSrcsetCandidate", () => {
  it("prefers the largest width", () => {
    expect(pickBestSrcsetCandidate("a.jpg 480w, b.jpg 1024w, c.jpg 640w")).toBe("b.jpg");
  });

  it("falls back to density when no width is given", () => {
    expect(pickBestSrcsetCandidate("a.jpg 1x, b.jpg 2x")).toBe("b.jpg");
  });

  it("returns the first candidate as a last resort", () => {
    expect(pickBestSrcsetCandidate("a.jpg, b.jpg")).toBe("a.jpg");
  });
});

describe("selectImageUrl", () => {
  const pageUrl = "https://example.com/about";

  it("prefers lazy-load attributes over src", () => {
    const result = selectImageUrl(
      { src: "/small.jpg", dataSrc: "/full.jpg" },
      pageUrl,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).toBe("https://example.com/full.jpg");
  });

  it("uses the best srcset candidate when src is missing", () => {
    const result = selectImageUrl({ srcset: "/a.jpg 100w, /b.jpg 800w" }, pageUrl);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).toBe("https://example.com/b.jpg");
  });

  it("falls back to src when lazy attrs and srcset are empty", () => {
    const result = selectImageUrl({ src: "/images/logo.png" }, pageUrl);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).toBe("https://example.com/images/logo.png");
  });

  it("rejects elements with only unusable candidates", () => {
    expect(selectImageUrl({ src: "data:image/gif;base64,R0lGOD" }, pageUrl).ok).toBe(false);
    expect(selectImageUrl({}, pageUrl).ok).toBe(false);
  });

  it("skips a blocked lazy candidate but keeps a valid src", () => {
    const result = selectImageUrl({ dataSrc: "javascript:alert(1)", src: "/ok.jpg" }, pageUrl);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).toBe("https://example.com/ok.jpg");
  });
});
