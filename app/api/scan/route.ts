import { NextResponse } from "next/server";
import { startScan } from "@/lib/scan/scan-engine";
import { getConfiguredProviderIds } from "@/lib/reverse-search";
import { validateUrlWithDns } from "@/lib/validation/url";
import { loadScanSnapshot } from "@/lib/scan/scan-persistence";
import { normalizeUrlForComparison } from "@/lib/validation/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { url?: unknown; providers?: unknown; fresh?: unknown };
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

  const normalizedTarget = normalizeUrlForComparison(validated.url);
  const fresh = body.fresh === true;

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

  // Duplicate-scan warning: a saved snapshot for this target URL exists.
  // Unless the client explicitly asked for a fresh scan (fresh: true), stop
  // here and let the user choose: view the saved result or scan anyway.
  if (!fresh) {
    const saved = await loadScanSnapshot(normalizedTarget);
    if (saved) {
      return NextResponse.json(
        {
          warning: "saved-scan-exists",
          message: `A saved result for ${validated.url} already exists (scanned ${saved.progress.startedAt}).`,
          savedScanId: saved.progress.scanId,
          savedState: saved.progress.state,
        },
        { status: 409 },
      );
    }
  }

  try {
    const scanId = await startScan(validated.url, { enabledProviderIds });
    return NextResponse.json({ scanId }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Could not start the scan: ${message}` }, { status: 500 });
  }
}
