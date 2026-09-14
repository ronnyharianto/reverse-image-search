import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getThumbnailsDir } from "@/lib/image/thumbnails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serves locally stored thumbnails: /api/images/<scanId>/<file>.webp
 * Path segments are sanitized to prevent directory traversal.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ scanId: string; file: string }> }) {
  const { scanId, file } = await params;

  if (!/^[0-9a-f-]{8,64}$/i.test(scanId) || !/^[0-9a-f]{8,64}\.webp$/i.test(file)) {
    return NextResponse.json({ error: "Invalid image path." }, { status: 400 });
  }

  const filePath = path.join(getThumbnailsDir(scanId), path.basename(file));
  try {
    const data = await readFile(filePath);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Image not found." }, { status: 404 });
  }
}
