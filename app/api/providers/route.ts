import { NextResponse } from "next/server";
import { getProviderCatalog } from "@/lib/reverse-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/providers — catalog for the provider picker (configured state included). */
export function GET() {
  return NextResponse.json({ providers: getProviderCatalog() });
}
