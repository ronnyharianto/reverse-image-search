import { NextResponse } from "next/server";
import { getScanEntry } from "@/lib/scan/scan-store";
import { targetUrlToFileName } from "@/lib/scan/scan-persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/scan/save — persist a finished scan as JSON.
 *
 * Body: { scanId }. Returns the snapshot as a downloadable JSON file
 * (Content-Disposition attachment). Server-side persistence is handled by
 * the scan engine when a scan completes.
 */
export async function POST(request: Request) {
  let body: { scanId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON with a `scanId` field." }, { status: 400 });
  }

  const scanId = typeof body.scanId === "string" ? body.scanId : "";
  if (!scanId) {
    return NextResponse.json({ error: "A `scanId` is required." }, { status: 400 });
  }

  const entry = getScanEntry(scanId);
  if (!entry) {
    return NextResponse.json({ error: "Scan not found (it may have been pruned or the server restarted)." }, { status: 404 });
  }
  if (entry.progress.state === "RUNNING") {
    return NextResponse.json({ error: "The scan is still running. Save it once it finishes." }, { status: 409 });
  }

  const snapshot = { progress: { ...entry.progress }, results: entry.results };
  const fileName = `${targetUrlToFileName(entry.progress.targetUrl)}.json`;
  return new Response(JSON.stringify({ savedAt: new Date().toISOString(), snapshot }, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
