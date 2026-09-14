import type { Metadata } from "sharp";
import { MAX_IMAGE_BYTES } from "@/types/scanner";

/**
 * Image validation and metadata via Sharp.
 * Only common raster formats accepted; SVG is rejected deliberately
 * (SVG can embed scripts and is rarely a photographic work).
 * AVIF is included — it is widely used on modern websites.
 */

const ALLOWED_SHARP_FORMATS = new Set(["jpeg", "png", "webp", "gif", "avif"]);

export type MetadataResult =
  | { ok: true; metadata: Metadata; width: number; height: number; mimeType: string; format: string }
  | { ok: false; error: string };

export async function inspectImage(data: Buffer, contentType: string): Promise<MetadataResult> {
  if (data.length === 0) return { ok: false, error: "Image is empty." };
  if (data.length > MAX_IMAGE_BYTES) return { ok: false, error: "Image exceeds the maximum allowed size." };

  // Sniff magic bytes instead of trusting the declared content type
  const format = isSupportedImageBytes(data);
  if (!format) {
    return {
      ok: false,
      error: "Unsupported image format (only JPEG, PNG, WebP, GIF and AVIF are supported).",
    };
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

    // Cast: some @types/sharp versions omit "avif" from FormatEnum although
    // the runtime reports it.
    const sharpFormat = (metadata.format ?? "") as string;
    // Some Sharp builds report AVIF as heif container with AV1 compression
    const isAvif =
      sharpFormat === "avif" || (sharpFormat === "heif" && metadata.compression === "av1");
    const isAllowed = ALLOWED_SHARP_FORMATS.has(sharpFormat) || (isAvif && format === "avif");
    if (!isAllowed) {
      return { ok: false, error: `Unsupported image format: ${sharpFormat || "unknown"}` };
    }

    return {
      ok: true,
      metadata,
      width: metadata.width,
      height: metadata.height,
      mimeType: sharpFormat === "jpeg" ? "image/jpeg" : isAvif ? "image/avif" : `image/${format}`,
      format,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Image could not be decoded: ${message.slice(0, 150)}` };
  }
}

/** Sniff magic bytes; null when the bytes are not a supported raster image. */
export function isSupportedImageBytes(data: Buffer): string | null {
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
  // AVIF: ISO-BMFF container — bytes 4..8 = "ftyp", brand at 8..12
  if (
    data.subarray(4, 8).toString("ascii") === "ftyp" &&
    ["avif", "avis", "mif1"].includes(data.subarray(8, 12).toString("ascii"))
  ) {
    return "avif";
  }
  return null;
}
