import { NextResponse } from "next/server";
import { findSavedSnapshotByScanId } from "@/lib/scan/scan-persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/scan/<id>/saved — serve a persisted snapshot by scan id.
 *
 * When the live in-memory scan no longer exists (server restarted after
 * saving), this lets the scan page still render the last saved result.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{8,64}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid scan id." }, { status: 400 });
  }

  const raw = await findSavedSnapshotByScanId(id);
  if (!raw) {
    return NextResponse.json({ error: "Saved scan not found." }, { status: 404 });
  }

  return new Response(raw, { headers: { "Content-Type": "application/json" } });
}
