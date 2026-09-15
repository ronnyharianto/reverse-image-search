import { NextResponse } from "next/server";
import { loadScanSnapshotWithTimestamp } from "@/lib/scan/scan-persistence";
import { normalizeUrlForComparison, validateUrl } from "@/lib/validation/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/scan/saved?targetUrl=... — snapshot lookup for the warning flow.
 * URL strings are validated before use; matching is done on the normalized
 * URL so trailing slashes, default ports and param order do not matter.
 * `savedAt` is the timestamp recorded when the snapshot was saved (null for
 * legacy files).
 */
export async function GET(request: Request) {
  const targetUrl = new URL(request.url).searchParams.get("targetUrl") ?? "";
  const validated = validateUrl(targetUrl);
  if (!validated.ok) {
    return NextResponse.json({ error: "A valid `targetUrl` is required." }, { status: 400 });
  }

  const { snapshot, savedAt } = await loadScanSnapshotWithTimestamp(normalizeUrlForComparison(validated.url));
  if (!snapshot) {
    return NextResponse.json({ error: "No saved scan for this URL." }, { status: 404 });
  }

  return NextResponse.json({
    savedAt,
    scanId: snapshot.progress.scanId,
    state: snapshot.progress.state,
    pagesScanned: snapshot.progress.pagesScanned,
    imagesFound: snapshot.progress.imagesFound,
    imagesProcessed: snapshot.progress.imagesProcessed,
    results: snapshot.results,
  });
}
