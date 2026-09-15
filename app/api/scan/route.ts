import { NextResponse } from "next/server";
import { startScan } from "@/lib/scan/scan-engine";
import { getConfiguredProviderIds } from "@/lib/reverse-search";
import { validateUrlWithDns } from "@/lib/validation/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { url?: unknown; providers?: unknown };
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

  // Optional provider selection: default = Wikimedia Commons only; opt-in
  // providers run only when explicitly selected.
  let enabledProviderIds: string[] | undefined;
  if (body.providers !== undefined) {
    if (
      !Array.isArray(body.providers) ||
      body.providers.length === 0 ||
      !body.providers.every((id) => typeof id === "string")
    ) {
      return NextResponse.json(
        { error: "`providers` must be a non-empty array of provider ids." },
        { status: 400 },
      );
    }
    const configured = getConfiguredProviderIds();
    const requested = body.providers as string[];
    const unavailable = requested.filter((id) => !configured.has(id as never));
    if (unavailable.length > 0) {
      return NextResponse.json(
        { error: `Provider(s) not configured: ${unavailable.join(", ")}` },
        { status: 400 },
      );
    }
    enabledProviderIds = requested;
  }

  try {
    const scanId = await startScan(validated.url, { enabledProviderIds });
    return NextResponse.json({ scanId }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Could not start the scan: ${message}` }, { status: 500 });
  }
}
