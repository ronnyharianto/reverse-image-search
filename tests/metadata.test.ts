import { describe, expect, it } from "vitest";
import { inspectImage } from "@/lib/image/metadata";

async function makeAvif(): Promise<Buffer> {
  const sharpModule = (await import("sharp")).default;
  return sharpModule({
    create: { width: 16, height: 16, channels: 3, background: { r: 20, g: 120, b: 200 } },
  })
    .avif({ quality: 50 })
    .toBuffer();
}

async function makePng(): Promise<Buffer> {
  const sharpModule = (await import("sharp")).default;
  return sharpModule({
    create: { width: 8, height: 8, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
}

describe("inspectImage", () => {
  it("accepts AVIF images and reports the correct mime type", async () => {
    const result = await inspectImage(await makeAvif(), "image/avif");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.format).toBe("avif");
      expect(result.mimeType).toBe("image/avif");
      expect(result.width).toBe(16);
      expect(result.height).toBe(16);
    }
  });

  it("accepts AVIF even when the content type is missing", async () => {
    const result = await inspectImage(await makeAvif(), "");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.mimeType).toBe("image/avif");
  });

  it("still accepts PNG", async () => {
    const result = await inspectImage(await makePng(), "image/png");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.format).toBe("png");
  });

  it("rejects non-image content types", async () => {
    const result = await inspectImage(await makePng(), "text/html");
    expect(result.ok).toBe(false);
  });

  it("rejects random bytes with a helpful message", async () => {
    const result = await inspectImage(Buffer.from("not an image at all, just bytes"), "");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Unsupported image format");
  });
});
