import { NextResponse } from "next/server";
import { retryImageLookup } from "@/lib/scan/retry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/scan/<id>/retry — retry a failed reverse-search lookup for one
 * image row and refresh the auto-saved JSON snapshot when it exists.
 *
 * Body: { resultId }. Returns the refreshed result row on success.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let body: { resultId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON with a `resultId` field." }, { status: 400 });
  }

  const resultId = typeof body.resultId === "string" ? body.resultId : "";
  if (!resultId) {
    return NextResponse.json({ error: "A `resultId` is required." }, { status: 400 });
  }

  const outcome = await retryImageLookup(id, resultId);
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: 409 });
  }

  return NextResponse.json({ result: outcome.result, savedFilePath: outcome.savedFilePath });
}
