import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ENABLED_PROVIDER_IDS,
  getActiveProviderIds,
  getConfiguredProviderIds,
  getProviderCatalog,
  getProviders,
  summarizeProviderOutcomes,
} from "@/lib/reverse-search";
import type { ProviderResult, ReverseImageSearchProvider } from "@/lib/reverse-search/provider";

const stubProvider = (id: string): ReverseImageSearchProvider => ({
  id,
  displayName: id,
  description: "",
  search: () => Promise.resolve({ searched: true, status: "NO_MATCH", remark: "", matches: [] }),
});

describe("provider registry", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("always has Wikimedia Commons configured", () => {
    vi.stubEnv("SERPAPI_API_KEY", "");
    vi.stubEnv("GOOGLE_VISION_API_KEY", "");
    vi.stubEnv("REVERSE_SEARCH_CUSTOM_URL", "");
    const configured = getConfiguredProviderIds();
    expect(configured.has("commons")).toBe(true);
    expect(configured.has("serpapi")).toBe(false);
    expect(configured.has("google-vision")).toBe(false);
    expect(configured.has("custom")).toBe(false);
  });

  it("marks opt-in providers configured when their env keys are set", () => {
    vi.stubEnv("SERPAPI_API_KEY", "k1");
    vi.stubEnv("GOOGLE_VISION_API_KEY", "k2");
    const configured = getConfiguredProviderIds();
    expect(configured.has("serpapi")).toBe(true);
    expect(configured.has("google-vision")).toBe(true);
  });

  it("catalog reports configuration state and required env vars", () => {
    vi.stubEnv("SERPAPI_API_KEY", "k1");
    vi.stubEnv("GOOGLE_VISION_API_KEY", "");
    const catalog = getProviderCatalog();
    const byId = new Map(catalog.map((item) => [item.id, item]));
    expect(byId.get("commons")?.configured).toBe(true);
    expect(byId.get("serpapi")?.configured).toBe(true);
    expect(byId.get("google-vision")?.configured).toBe(false);
    expect(byId.get("google-vision")?.requires).toEqual(["GOOGLE_VISION_API_KEY"]);
    expect(byId.get("custom")?.configured).toBe(false);
  });

  it("instantiates only enabled AND configured providers", () => {
    vi.stubEnv("SERPAPI_API_KEY", "k1");
    vi.stubEnv("GOOGLE_VISION_API_KEY", "");
    const providers = getProviders(["commons", "serpapi"]);
    expect(providers.commons).toBeDefined();
    expect(providers.serpapi).toBeDefined();
    expect(providers.googleVision).toBeUndefined();
    expect(providers.custom).toBeUndefined();
  });

  it("refuses to instantiate unconfigured providers even when enabled", () => {
    vi.stubEnv("GOOGLE_VISION_API_KEY", "");
    const providers = getProviders(["commons", "google-vision"]);
    expect(providers.commons).toBeDefined();
    expect(providers.googleVision).toBeUndefined();
  });

  it("defaults to Wikimedia Commons only when no selection is given", () => {
    vi.stubEnv("SERPAPI_API_KEY", "k1");
    const providers = getProviders();
    expect(providers.commons).toBeDefined();
    expect(providers.serpapi).toBeUndefined();
    expect(providers.googleVision).toBeUndefined();
    expect(providers.custom).toBeUndefined();
  });

  it("catalog marks only Wikimedia Commons as default-enabled", () => {
    vi.stubEnv("SERPAPI_API_KEY", "k1");
    const catalog = getProviderCatalog();
    const byId = new Map(catalog.map((item) => [item.id, item]));
    expect(byId.get("commons")?.defaultEnabled).toBe(true);
    expect(byId.get("serpapi")?.defaultEnabled).toBe(false);
    expect(byId.get("google-vision")?.defaultEnabled).toBe(false);
    expect(byId.get("custom")?.defaultEnabled).toBe(false);
    expect(DEFAULT_ENABLED_PROVIDER_IDS).toEqual(["commons"]);
  });

  it("ignores unknown provider ids", () => {
    const providers = getProviders(["commons", "not-a-provider"]);
    expect(providers.commons).toBeDefined();
    expect(providers.serpapi).toBeUndefined();
  });

  it("resolves active provider ids enabled, configured and in run order", () => {
    vi.stubEnv("SERPAPI_API_KEY", "k1");
    // Run order follows PROVIDER_IDS: commons, serpapi, google-vision, custom.
    expect(getActiveProviderIds(["serpapi", "commons"])).toEqual(["commons", "serpapi"]);
    expect(getActiveProviderIds(["commons", "google-vision"])).toEqual(["commons"]);
    expect(getActiveProviderIds()).toEqual(["commons"]);
    expect(getActiveProviderIds(["not-a-provider"])).toEqual([]);
  });
});

describe("summarizeProviderOutcomes", () => {
  it("pairs results with providers by position and counts matches", () => {
    const providers = [stubProvider("commons"), stubProvider("serpapi")];
    const results: ProviderResult[] = [
      { searched: true, status: "MATCH_FOUND", remark: "hit", matches: [
        { sourceName: "A", sourceUrl: "https://a.test/1", providerId: "commons" },
        { sourceName: "B", sourceUrl: "https://b.test/2", providerId: "commons" },
      ] },
      { searched: true, status: "NO_MATCH", remark: "none", matches: [] },
    ];
    const outcomes = summarizeProviderOutcomes(providers, results);
    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]).toEqual({
      providerId: "commons",
      searched: true,
      status: "MATCH_FOUND",
      matchCount: 2,
      remark: "hit",
    });
    expect(outcomes[1]).toMatchObject({ providerId: "serpapi", status: "NO_MATCH", matchCount: 0 });
  });

  it("records provider failures as searched: false", () => {
    const outcomes = summarizeProviderOutcomes([stubProvider("google-vision")], [
      { searched: false, status: "FAILED", remark: "boom" },
    ]);
    expect(outcomes[0]).toEqual({
      providerId: "google-vision",
      searched: false,
      status: "FAILED",
      matchCount: 0,
      remark: "boom",
    });
  });

  it("omits providers that did not run", () => {
    const outcomes = summarizeProviderOutcomes([stubProvider("commons"), stubProvider("serpapi")], [
      { searched: true, status: "NO_MATCH", remark: "none", matches: [] },
      undefined,
    ]);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.providerId).toBe("commons");
  });
});
