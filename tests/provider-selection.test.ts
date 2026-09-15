import { afterEach, describe, expect, it } from "vitest";
import { loadStoredSelection, mergeStoredSelection, saveStoredSelection } from "@/lib/provider-selection";

const catalog = [
  { id: "commons", configured: true, defaultEnabled: true },
  { id: "serpapi", configured: true, defaultEnabled: false },
  { id: "google-vision", configured: false, defaultEnabled: false },
  { id: "custom", configured: false, defaultEnabled: false },
];

describe("mergeStoredSelection", () => {
  it("restores the stored selection, filtered to the catalog", () => {
    expect(mergeStoredSelection(["serpapi", "commons"], catalog)).toEqual(["commons", "serpapi"]);
  });

  it("drops unconfigured providers and falls back to defaults", () => {
    // google-vision key was removed since the last scan → its stored intent
    // can no longer run, so the picker falls back to the default-enabled ones.
    expect(mergeStoredSelection(["google-vision"], catalog)).toEqual(["commons"]);
    // Mixed case: the still-configured part of the selection survives.
    expect(mergeStoredSelection(["google-vision", "commons"], catalog)).toEqual(["commons"]);
  });

  it("falls back to defaults when nothing valid remains", () => {
    expect(mergeStoredSelection([], catalog)).toEqual(["commons"]);
    expect(mergeStoredSelection(undefined, catalog)).toEqual(["commons"]);
    expect(mergeStoredSelection(["google-vision", "custom"], catalog)).toEqual(["commons"]);
  });

  it("ignores unknown provider ids from tampered storage", () => {
    expect(mergeStoredSelection(["nope", "commons"], catalog)).toEqual(["commons"]);
  });

  it("keeps catalog order, not storage order", () => {
    expect(mergeStoredSelection(["custom", "serpapi"], [
      { id: "commons", configured: true, defaultEnabled: true },
      { id: "serpapi", configured: true, defaultEnabled: false },
      { id: "custom", configured: true, defaultEnabled: false },
    ])).toEqual(["serpapi", "custom"]);
  });
});

describe("localStorage round-trip", () => {
  // Node environment has no window/localStorage — install a minimal stub
  // backed by a plain object, mirroring what jsdom would provide.
  let store: Record<string, string>;
  const originalWindow = globalThis.window;

  function installWindowStub(): void {
    store = {};
    Object.defineProperty(globalThis, "window", {
      value: { localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } } },
      configurable: true,
      writable: true,
    });
  }

  afterEach(() => {
    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, "window");
    } else {
      Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true, writable: true });
    }
  });

  it("saves and loads the selection", () => {
    installWindowStub();
    saveStoredSelection(["commons", "serpapi"]);
    expect(loadStoredSelection()).toEqual(["commons", "serpapi"]);
  });

  it("returns undefined when nothing was stored", () => {
    installWindowStub();
    expect(loadStoredSelection()).toBeUndefined();
  });

  it("returns undefined for corrupt JSON instead of throwing", () => {
    installWindowStub();
    window.localStorage.setItem("copyright-scanner:providers", "{not json");
    expect(loadStoredSelection()).toBeUndefined();
  });

  it("ignores non-array and non-string payloads", () => {
    installWindowStub();
    window.localStorage.setItem("copyright-scanner:providers", JSON.stringify({ ids: ["commons"] }));
    expect(loadStoredSelection()).toBeUndefined();
    window.localStorage.setItem("copyright-scanner:providers", JSON.stringify([1, "commons", null]));
    expect(loadStoredSelection()).toEqual(["commons"]);
  });

  it("treats a throwing localStorage as absent (privacy mode)", () => {
    Object.defineProperty(globalThis, "window", {
      value: { localStorage: { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } } },
      configurable: true,
      writable: true,
    });
    expect(() => saveStoredSelection(["commons"])).not.toThrow();
    expect(loadStoredSelection()).toBeUndefined();
  });
});
