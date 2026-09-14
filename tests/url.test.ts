import { describe, expect, it } from "vitest";
import {
  isSameSite,
  normalizeUrlForComparison,
  resolveAndValidateUrl,
  validateUrl,
  validateUrlWithDns,
} from "@/lib/validation/url";

describe("validateUrl", () => {
  it("accepts public http and https URLs", () => {
    expect(validateUrl("https://example.com").ok).toBe(true);
    expect(validateUrl("http://example.com/about").ok).toBe(true);
  });

  it("rejects non-http protocols", () => {
    for (const raw of ["file:///etc/passwd", "ftp://example.com/x", "javascript:alert(1)", "data:text/html,x"]) {
      expect(validateUrl(raw).ok).toBe(false);
    }
  });

  it("rejects localhost and loopback", () => {
    for (const raw of [
      "http://localhost",
      "http://localhost:3000",
      "http://127.0.0.1",
      "http://127.0.0.1:8080/admin",
      "http://[::1]/",
      "http://0.0.0.0",
    ]) {
      const result = validateUrl(raw);
      expect(result.ok).toBe(false);
    }
  });

  it("rejects private IPv4 ranges", () => {
    for (const raw of [
      "http://10.0.0.1",
      "http://172.16.0.5",
      "http://172.31.255.1",
      "http://192.168.1.1",
      "http://169.254.169.254/latest/meta-data", // cloud metadata endpoint
      "http://100.64.0.1",
    ]) {
      expect(validateUrl(raw).ok).toBe(false);
    }
  });

  it("rejects private IPv6 ranges and IPv4-mapped addresses", () => {
    expect(validateUrl("http://[fd00::1]/").ok).toBe(false);
    expect(validateUrl("http://[fe80::1]/").ok).toBe(false);
    expect(validateUrl("http://[::ffff:127.0.0.1]/").ok).toBe(false);
  });

  it("allows public literal IPv4", () => {
    expect(validateUrl("http://93.184.216.34").ok).toBe(true);
  });

  it("rejects internal-looking hostnames", () => {
    expect(validateUrl("http://myserver.local").ok).toBe(false);
    expect(validateUrl("http://host.internal").ok).toBe(false);
  });

  it("rejects malformed input", () => {
    expect(validateUrl("").ok).toBe(false);
    expect(validateUrl("not a url").ok).toBe(false);
    expect(validateUrl("http://exa mple.com").ok).toBe(false);
  });
});

describe("validateUrlWithDns", () => {
  it("rejects a hostname that does not exist", async () => {
    const result = await validateUrlWithDns("https://this-domain-does-not-exist-9f3x2w.example");
    expect(result.ok).toBe(false);
  });

  it("rejects literal loopback IPv6", async () => {
    const result = await validateUrlWithDns("http://[::1]:3000");
    expect(result.ok).toBe(false);
  });
});

describe("resolveAndValidateUrl", () => {
  it("resolves relative image paths against the page URL", () => {
    const result = resolveAndValidateUrl("../images/team.jpg", "https://example.com/about/team");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).toBe("https://example.com/images/team.jpg");
  });

  it("resolves root-relative paths", () => {
    const result = resolveAndValidateUrl("/images/logo.png", "https://example.com/about");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).toBe("https://example.com/images/logo.png");
  });

  it("rejects data:, blob: and javascript: URLs", () => {
    expect(resolveAndValidateUrl("data:image/png;base64,AAAA", "https://example.com").ok).toBe(false);
    expect(resolveAndValidateUrl("blob:https://example.com/x", "https://example.com").ok).toBe(false);
    expect(resolveAndValidateUrl("javascript:void(0)", "https://example.com").ok).toBe(false);
  });
});

describe("normalizeUrlForComparison", () => {
  it("treats equivalent URLs as equal", () => {
    const a = normalizeUrlForComparison("https://EXAMPLE.com:443/path?b=2&a=1#section");
    const b = normalizeUrlForComparison("https://example.com/path?a=1&b=2");
    expect(a).toBe(b);
  });

  it("treats http default port as equal to explicit port 80", () => {
    expect(normalizeUrlForComparison("http://example.com:80/x")).toBe(normalizeUrlForComparison("http://example.com/x"));
  });

  it("keeps genuinely different URLs distinct", () => {
    expect(normalizeUrlForComparison("https://example.com/a")).not.toBe(normalizeUrlForComparison("https://example.com/b"));
  });
});

describe("isSameSite", () => {
  it("accepts same-site URLs including www equivalence", () => {
    expect(isSameSite("https://example.com/about", "https://example.com")).toBe(true);
    expect(isSameSite("https://www.example.com/about", "https://example.com")).toBe(true);
  });

  it("rejects other sites and subdomains", () => {
    expect(isSameSite("https://facebook.com/example", "https://example.com")).toBe(false);
    expect(isSameSite("https://cdn.example.com/x.js", "https://example.com")).toBe(false);
  });
});
