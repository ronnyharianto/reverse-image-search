import { NextResponse } from "next/server";
import { getScanEntry } from "@/lib/scan/scan-store";
import { saveScanSnapshot, targetUrlToFileName } from "@/lib/scan/scan-persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/scan/save — persist a finished scan as JSON.
 *
 * Body: { scanId }. Writes data/results/<target-url>.json and returns the
 * snapshot as a downloadable file (Content-Disposition attachment), so the
 * user both keeps a server-side record and can archive the file elsewhere.
 * Only finished scans can be saved.
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
  try {
    await saveScanSnapshot(snapshot);
  } catch {
    return NextResponse.json({ error: "Could not write the results file." }, { status: 500 });
  }

  const fileName = `${targetUrlToFileName(entry.progress.targetUrl)}.json`;
  return new Response(JSON.stringify({ savedAt: new Date().toISOString(), snapshot }, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
