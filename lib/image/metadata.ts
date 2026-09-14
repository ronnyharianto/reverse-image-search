import type { Metadata } from "sharp";
import { MAX_IMAGE_BYTES } from "@/types/scanner";

/**
 * Image validation and metadata via Sharp.
 * Only common raster formats accepted; SVG is rejected deliberately
 * (SVG can embed scripts and is rarely a photographic work).
 */

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const ALLOWED_SHARP_FORMATS = new Set(["jpeg", "png", "webp", "gif"]);

export type MetadataResult =
  | { ok: true; metadata: Metadata; width: number; height: number; mimeType: string; format: string }
  | { ok: false; error: string };

export async function inspectImage(data: Buffer, contentType: string): Promise<MetadataResult> {
  if (data.length === 0) return { ok: false, error: "Image is empty." };
  if (data.length > MAX_IMAGE_BYTES) return { ok: false, error: "Image exceeds the maximum allowed size." };

  // Sniff magic bytes instead of trusting the declared content type
  const format = detectFormat(data);
  if (!format) {
    return { ok: false, error: "Unsupported image format (only JPEG, PNG, WebP and GIF are supported)." };
  }

  if (contentType && !contentType.startsWith("image/")) {
    return { ok: false, error: `Response is not an image (content type: ${contentType}).` };
  }

  try {
    const sharpModule = (await import("sharp")).default;
    const metadata = await sharpModule(data, { failOn: "error" }).metadata();
    if (!metadata.width || !metadata.height) {
      return { ok: false, error: "Image has no readable dimensions." };
    }
    if (!ALLOWED_SHARP_FORMATS.has(metadata.format ?? "")) {
      return { ok: false, error: `Unsupported image format: ${metadata.format}` };
    }
    return {
      ok: true,
      metadata,
      width: metadata.width,
      height: metadata.height,
      mimeType: metadata.format === "jpeg" ? "image/jpeg" : `image/${metadata.format}`,
      format: metadata.format,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Image could not be decoded: ${message.slice(0, 150)}` };
  }
}

function detectFormat(data: Buffer): string | null {
  if (data.length < 12) return null;
  // JPEG: FF D8 FF
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  // GIF: GIF87a / GIF89a
  if (data.subarray(0, 3).toString("ascii") === "GIF") return "gif";
  // WebP: RIFF....WEBP
  if (data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") {
    return "webp";
  }
  return null;
}

export { ALLOWED_MIME_TYPES };
