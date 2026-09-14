import { createHash } from "node:crypto";

/**
 * Image fingerprinting:
 * - SHA-256: exact duplicate detection + the SHA-1 needed for the
 *   Wikimedia Commons hash lookup.
 * - aHash + dHash: 64-bit perceptual hashes for visual similarity ranking.
 */

export interface ImageFingerprint {
  sha256: string;
  sha1: string;
  ahash: bigint;
  dhash: bigint;
}

export function sha256Hex(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function sha1Hex(data: Buffer): string {
  return createHash("sha1").update(data).digest("hex");
}

function bitsToBigint(bits: number[]): bigint {
  let value = 0n;
  for (const bit of bits) {
    value = (value << 1n) | BigInt(bit);
  }
  return value;
}

/** Hamming distance between two 64-bit perceptual hashes. */
export function hammingDistance(a: bigint, b: bigint): number {
  let xor = a ^ b;
  let distance = 0;
  while (xor) {
    distance += Number(xor & 1n);
    xor >>= 1n;
  }
  return distance;
}

/**
 * Compute all fingerprints for an image buffer.
 * Grayscale 8x8 (aHash) / 9x8 (dHash) raw pixel buffers keep this cheap.
 */
export async function fingerprintImage(data: Buffer): Promise<ImageFingerprint> {
  const sharpModule = (await import("sharp")).default;
  const gray = sharpModule(data, { failOn: "error" }).grayscale();

  const ahashRaw = await gray.clone().resize(8, 8, { fit: "fill" }).raw().toBuffer();
  const aAvg = ahashRaw.reduce((sum, v) => sum + v, 0) / ahashRaw.length;
  const ahashBits: number[] = [];
  for (const v of ahashRaw) ahashBits.push(v >= aAvg ? 1 : 0);

  const dhashRaw = await gray.clone().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  const dhashBits: number[] = [];
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const left = dhashRaw[row * 9 + col];
      const right = dhashRaw[row * 9 + col + 1];
      dhashBits.push(left > right ? 1 : 0);
    }
  }

  return {
    sha256: sha256Hex(data),
    sha1: sha1Hex(data),
    ahash: bitsToBigint(ahashBits),
    dhash: bitsToBigint(dhashBits),
  };
}

/** True when two images look visually similar (Hamming distance threshold). */
export function areVisuallySimilar(a: bigint, b: bigint): boolean {
  // ~10 differing bits out of 64 tolerated — conservative, avoids false positives
  return hammingDistance(a, b) <= 10;
}
