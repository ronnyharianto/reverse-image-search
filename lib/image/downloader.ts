import { DOWNLOAD_TIMEOUT_MS, MAX_IMAGE_BYTES } from "@/types/scanner";
import { validateUrlWithDns } from "@/lib/validation/url";

/**
 * Image downloading with hard limits:
 * - timeout, maximum size, manual redirect handling (each hop re-validated
 *   against SSRF rules), and a response size checked while streaming.
 */

export type DownloadResult =
  | { ok: true; data: Buffer; contentType: string; finalUrl: string }
  | { ok: false; error: string };

const MAX_REDIRECTS = 3;
const MAX_ATTEMPTS = 3;

export async function downloadImage(url: string): Promise<DownloadResult> {
  let lastError = "Download failed.";

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const result = await downloadOnce(url);
    if (result.ok) return result;
    lastError = result.error;
    // Retry with backoff on rate limiting / transient server errors
    if (/HTTP (429|5\d\d)$/.test(result.error) && attempt < MAX_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
      continue;
    }
    return result;
  }
  return { ok: false, error: lastError };
}

async function downloadOnce(url: string): Promise<DownloadResult> {
  let currentUrl = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const safe = await validateUrlWithDns(currentUrl);
    if (!safe.ok) return { ok: false, error: `Image URL rejected: ${safe.error}` };

    let response: Response;
    try {
      response = await fetch(safe.url, {
        redirect: "manual",
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
        headers: {
          "User-Agent": "CopyrightImageScanner/0.1 (local screening tool)",
          Accept: "image/*",
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: `Download failed: ${message.slice(0, 200)}` };
    }

    // Redirect: validate the next hop before following it
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        return { ok: false, error: "Download failed: redirect without location." };
      }
      try {
        currentUrl = new URL(location, safe.url).toString();
      } catch {
        return { ok: false, error: "Download failed: invalid redirect location." };
      }
      continue;
    }

    if (!response.ok) {
      return { ok: false, error: `Download failed: HTTP ${response.status}` };
    }
    return await readBody(response, safe.url);
  }

  return { ok: false, error: "Download failed: too many redirects." };
}

async function readBody(response: Response, finalUrl: string): Promise<DownloadResult> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_IMAGE_BYTES) {
    return { ok: false, error: "Image exceeds the maximum allowed size." };
  }

  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  const chunks: Buffer[] = [];
  let received = 0;

  try {
    const reader = response.body?.getReader();
    if (!reader) return { ok: false, error: "Download failed: empty response body." };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_IMAGE_BYTES) {
        reader.cancel().catch(() => undefined);
        return { ok: false, error: "Image exceeds the maximum allowed size." };
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Download failed: ${message.slice(0, 200)}` };
  }

  if (received === 0) {
    return { ok: false, error: "Download failed: empty image." };
  }

  return { ok: true, data: Buffer.concat(chunks), contentType, finalUrl };
}
