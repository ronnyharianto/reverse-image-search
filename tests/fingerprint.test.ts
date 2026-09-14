import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { fingerprintImage, hammingDistance, areVisuallySimilar, sha256Hex } from "@/lib/image/fingerprint";

describe("hashing", () => {
  it("computes stable SHA-256 hex digests", () => {
    const data = Buffer.from("hello world");
    expect(sha256Hex(data)).toBe(createHash("sha256").update("hello world").digest("hex"));
    expect(sha256Hex(data)).toBe(sha256Hex(Buffer.from("hello world")));
  });

  it("yields different hashes for different content", () => {
    expect(sha256Hex(Buffer.from("a"))).not.toBe(sha256Hex(Buffer.from("b")));
  });
});

describe("perceptual hashes", () => {
  it("gives identical images identical fingerprints", async () => {
    const sharpModule = (await import("sharp")).default;
    const tiny = await sharpModule({
      create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 10, b: 10 } },
    })
      .png()
      .toBuffer();
    const a = await fingerprintImage(tiny);
    const b = await fingerprintImage(tiny);
    expect(a.ahash).toBe(b.ahash);
    expect(a.dhash).toBe(b.dhash);
  });

  it(" Hamming distance is 0 for identical hashes and grows with difference", () => {
    expect(hammingDistance(0b1010n, 0b1010n)).toBe(0);
    expect(hammingDistance(0b1010n, 0b0101n)).toBe(4);
    expect(hammingDistance(0n, ~0n & 0xffffffffffffffffn)).toBe(64);
  });

  it("similar hashes count as visually similar", () => {
    const base = 0b1111000011110000n;
    expect(areVisuallySimilar(base, base ^ 0b11n)).toBe(true); // 2 bits differ
    expect(areVisuallySimilar(0n, ~0n & 0xffffffffffffffffn)).toBe(false); // 64 bits differ
  });
});


