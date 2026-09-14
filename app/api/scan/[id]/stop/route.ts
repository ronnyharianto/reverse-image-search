import { NextResponse } from "next/server";
import { requestStop } from "@/lib/scan/scan-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const stopped = requestStop(id);
  if (!stopped) {
    return NextResponse.json({ error: "Scan not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
