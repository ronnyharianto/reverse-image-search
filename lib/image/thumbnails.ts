import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Local thumbnail storage under data/images/<scanId>/.
 * Thumbnails are 256px-wide JPEGs served through /api/images/...
 */

const THUMBNAIL_WIDTH = 256;

export function getThumbnailsDir(scanId: string): string {
  return path.join(process.cwd(), "data", "images", scanId);
}

/** Writes a WebP thumbnail; returns the file name, or null on failure. */
export async function saveThumbnail(scanId: string, sha256: string, data: Buffer): Promise<string | null> {
  try {
    const sharpModule = (await import("sharp")).default;
    const thumbBuffer = await sharpModule(data, { failOn: "error" })
      .resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true })
      .webp({ quality: 70 })
      .toBuffer();

    const dir = getThumbnailsDir(scanId);
    await mkdir(dir, { recursive: true });
    const fileName = `${sha256.slice(0, 24)}.webp`;
    await writeFile(path.join(dir, fileName), thumbBuffer);
    return fileName;
  } catch {
    return null;
  }
}
