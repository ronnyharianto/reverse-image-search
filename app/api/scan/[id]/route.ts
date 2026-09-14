import { NextResponse } from "next/server";
import { getScanEntry } from "@/lib/scan/scan-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entry = getScanEntry(id);
  if (!entry) {
    return NextResponse.json({ error: "Scan not found (server may have restarted)." }, { status: 404 });
  }

  return NextResponse.json({
    progress: { ...entry.progress },
    results: entry.results.map((result) => ({
      ...result,
      occurrences: result.occurrences.map((o) => ({ ...o })),
      reverseSearchResults: result.reverseSearchResults?.map((m) => ({ ...m })),
    })),
  });
}
