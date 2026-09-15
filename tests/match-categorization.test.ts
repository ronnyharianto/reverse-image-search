import { describe, expect, it } from "vitest";
import { categorizeSourceUrl, extractHost, summarizeMatchCategories } from "@/lib/match-categorization";

describe("extractHost", () => {
  it("extracts and normalizes hostnames", () => {
    expect(extractHost("https://www.unsplash.com/photos/x")).toBe("unsplash.com");
    expect(extractHost("http://YouTube.com/watch?v=1")).toBe("youtube.com");
    expect(extractHost("https://stock.adobe.com/")).toBe("stock.adobe.com");
  });

  it("returns empty for non-http(s) or invalid URLs", () => {
    expect(extractHost("javascript:alert(1)")).toBe("");
    expect(extractHost("ftp://files.example.com/a.jpg")).toBe("");
    expect(extractHost("not a url")).toBe("");
    expect(extractHost("")).toBe("");
  });
});

describe("categorizeSourceUrl", () => {
  it("flags commercial stock agencies", () => {
    expect(categorizeSourceUrl("https://www.gettyimages.com/photos/cat")).toBe("COMMERCIAL_STOCK");
    expect(categorizeSourceUrl("https://stock.adobe.com/images/x")).toBe("COMMERCIAL_STOCK");
    expect(categorizeSourceUrl("https://www.shutterstock.com/search/cat")).toBe("COMMERCIAL_STOCK");
    expect(categorizeSourceUrl("https://alamy.com/x")).toBe("COMMERCIAL_STOCK");
  });

  it("flags free media libraries including Wikimedia Commons", () => {
    expect(categorizeSourceUrl("https://commons.wikimedia.org/wiki/File:X.jpg")).toBe("FREE_MEDIA");
    expect(categorizeSourceUrl("https://unsplash.com/s/photos/student")).toBe("FREE_MEDIA");
    expect(categorizeSourceUrl("https://pixabay.com/photos/x/")).toBe("FREE_MEDIA");
    expect(categorizeSourceUrl("https://www.pexels.com/photo/x/")).toBe("FREE_MEDIA");
    expect(categorizeSourceUrl("https://www.nasa.gov/image/x")).toBe("FREE_MEDIA");
  });

  it("flags social platforms", () => {
    expect(categorizeSourceUrl("https://www.youtube.com/watch?v=dUqnAX_z06M")).toBe("SOCIAL_PLATFORM");
    expect(categorizeSourceUrl("https://www.linkedin.com/pulse/x")).toBe("SOCIAL_PLATFORM");
    expect(categorizeSourceUrl("https://medium.com/@lingosteve/x")).toBe("SOCIAL_PLATFORM");
    expect(categorizeSourceUrl("https://pin.it/abc")).toBe("SOCIAL_PLATFORM");
  });

  it("does not let a subdomain string trick the matcher", () => {
    // "notunsplash.com" must NOT match "unsplash.com"
    expect(categorizeSourceUrl("https://notunsplash.com/x")).toBe("OTHER_SOURCE");
    // ...but a real subdomain does
    expect(categorizeSourceUrl("https://blog.unsplash.com/x")).toBe("FREE_MEDIA");
  });

  it("falls back to OTHER_SOURCE for unknown hosts and bad input", () => {
    expect(categorizeSourceUrl("https://www.soroptimistpxv.com/scholarships-awards")).toBe("OTHER_SOURCE");
    expect(categorizeSourceUrl("https://popsugar.com/family/x")).toBe("OTHER_SOURCE");
    expect(categorizeSourceUrl(":::not-a-url:::")).toBe("OTHER_SOURCE");
  });

  it("prefers the more specific rule when domains overlap", () => {
    // adobe.com is not listed as free media; stock.adobe.com is commercial.
    // eyeem vs flickr-style overlaps are not present, but subdomain priority
    // within one category list must hold:
    expect(categorizeSourceUrl("https://blogs.nasa.gov/x")).toBe("FREE_MEDIA");
  });
});

describe("summarizeMatchCategories", () => {
  it("returns distinct categories in review-priority order", () => {
    const matches = [
      { sourceUrl: "https://www.youtube.com/watch?v=1" },
      { sourceUrl: "https://www.shutterstock.com/x" },
      { sourceUrl: "https://unsplash.com/x" },
      { sourceUrl: "https://unsplash.com/y" },
    ];
    expect(summarizeMatchCategories(matches)).toEqual([
      "COMMERCIAL_STOCK",
      "FREE_MEDIA",
      "SOCIAL_PLATFORM",
    ]);
  });

  it("returns empty for no matches", () => {
    expect(summarizeMatchCategories([])).toEqual([]);
  });
});
