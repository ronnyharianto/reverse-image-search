import { NextResponse } from "next/server";
import { startScan } from "@/lib/scan/scan-engine";
import { validateUrlWithDns } from "@/lib/validation/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { url?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON with a `url` field." }, { status: 400 });
  }

  const rawUrl = typeof body.url === "string" ? body.url.trim() : "";
  if (!rawUrl) {
    return NextResponse.json({ error: "Please enter a website URL." }, { status: 403 });
  }

  const validated = await validateUrlWithDns(rawUrl);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  try {
    const scanId = await startScan(validated.url);
    return NextResponse.json({ scanId }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Could not start the scan: ${message}` }, { status: 500 });
  }
}
