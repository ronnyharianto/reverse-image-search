# Copyright Image Scanner

A local web application for **copyright-risk screening** of images on company profile websites.

Enter a website URL → the app crawls the site's pages (Playwright), extracts images, downloads
and validates them (Sharp), and performs **real reverse image search** per image. Results stream
into the UI live while the scan is still running.

> **This is a screening tool, not a legal authority.** A match means an image exists elsewhere —
> it does **not** establish copyright ownership or infringement. A "No Match" result does **not**
> mean an image is copyright-free.

## Getting started

Requirements: Node.js 20+ (tested with Node 24). No Python required.

```bash
npm install
npx playwright install chromium   # one-time browser download for the crawler
npm run dev
```

Open http://localhost:3000, enter a website URL, press **Start Scan**.

## What it does

1. **Crawls** the target website only (same domain, `www`-equivalent), up to 100 pages at depth 3
   with 3 concurrent pages, JavaScript rendering included.
2. **Finds images** per page: `src`, lazy-load attributes (`data-src`, `data-lazy-src`,
   `data-original`), `srcset` (largest candidate) and `<picture><source>`.
3. **Processes each image**: SSRF-checked download (10 MB cap, 15 s timeout, magic-byte format
   validation), SHA-256 + SHA-1 hashing, perceptual fingerprints (aHash/dHash), WebP thumbnail.
4. **Reverse image search** (pluggable providers):
   - **Wikimedia Commons** (default, free, no key): exact-content SHA-1 lookup via the public
     MediaWiki API over ~100M files.
   - **Custom provider** (optional): bring your own key — see *Configuration* below.
5. **Shows results incrementally** over Server-Sent Events: status, remark, thumbnail, page URL,
   image URL — with a detail panel listing matching sources and all pages an image occurs on.

Identical images (same SHA-256) are searched only once; every page occurrence is still listed.

## Statuses

| Status            | Meaning                                                          |
| ----------------- | ---------------------------------------------------------------- |
| `PROCESSING`      | The image is currently being processed.                          |
| `NO_MATCH`        | The configured providers found no match. *Not* proof of freedom. |
| `MATCH_FOUND`     | A potentially matching image/source was found.                   |
| `REQUIRES_REVIEW` | No provider searched this image — manual verification required.  |
| `FAILED`          | Download, validation or search failed; the scan continues.       |

## Configuration

No configuration is required for basic functionality (no paid services).

Optional environment variables (`.env.local`) enable the custom provider:

```bash
REVERSE_SEARCH_CUSTOM_URL=https://your-endpoint.example/lookup/{sha256}
REVERSE_SEARCH_CUSTOM_API_KEY=your-key            # optional
REVERSE_SEARCH_CUSTOM_AUTH_HEADER=X-Api-Key       # optional, default: Authorization
```

The endpoint receives `{ sha1, sha256, mimeType }` and should return JSON matches:
`[{ "sourceName": "...", "sourceUrl": "https://...", "similarity": 95 }]`.

## Security

- Only `http://` and `https://` URLs are accepted.
- `localhost`, private IP ranges, link-local (incl. cloud metadata `169.254.169.254`), CGNAT,
  IPv4-mapped IPv6 and hostnames resolving to private addresses are rejected — including on
  every redirect hop.
- The crawler does not bypass authentication, CAPTCHAs or anti-bot mechanisms.

## Development

```bash
npm test     # Vitest unit tests (URL/SSRF, extraction, hashing, dedup, providers)
npm run lint
npm run build
```

Scan thumbnails are written to `data/images/` (gitignored). Scans live in memory and are lost on
server restart — this is a local utility, by design.
