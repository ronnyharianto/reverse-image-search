import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getResultsDir } from "@/lib/scan/scan-persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/scan/<id>/saved — serve a persisted snapshot by scan id.
 *
 * Saved files are named after the target URL, so the scan id is resolved by
 * scanning the folder for a snapshot whose progress.scanId matches. When the
 * live in-memory scan no longer exists (server restarted after saving), this
 * lets the scan page still render the last saved result.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{8,64}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid scan id." }, { status: 400 });
  }

  let files: string[];
  try {
    files = await readdir(getResultsDir());
  } catch {
    return NextResponse.json({ error: "No saved scans found." }, { status: 404 });
  }

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await readFile(path.join(getResultsDir(), file), "utf8");
      const payload = JSON.parse(raw) as { snapshot?: { progress?: { scanId?: string } } };
      if (payload.snapshot?.progress?.scanId === id) {
        return new Response(raw, { headers: { "Content-Type": "application/json" } });
      }
    } catch {
      // Skip unreadable/corrupt files.
    }
  }

  return NextResponse.json({ error: "Saved scan not found." }, { status: 404 });
}
