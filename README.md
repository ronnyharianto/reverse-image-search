# Copyright Image Scanner

> **⚠️ This tool does NOT decide whether an image is safe to use — and it is not a legal
> authority.** It is a screening aid that flags images worth a closer look. **Every result still
> requires manual verification**: open the reported sources and check the license and attribution
> terms yourself. A match is a lead, not proof of infringement; a "No Match" is not proof that an
> image is copyright-free.

A local web application for **copyright-risk screening** of images on company profile websites.

Enter a website URL → the app crawls the site's pages (Playwright), extracts images, downloads
and validates them (Sharp), and performs **real reverse image search** per image. Results stream
into the UI live while the scan is still running.

## Getting started

Requirements: Node.js 20+ (tested with Node 24). No Python required.

```bash
npm install
npx playwright install chromium   # one-time browser download for the crawler
npm run dev
```

Open http://localhost:3000, enter a website URL, press **Start Scan**.

## How to use

### 1. Start a scan

1. Open http://localhost:3000.
2. Enter the website URL to screen (e.g. `https://example.com`) — only public `http(s)` URLs
   are accepted; internal/private addresses are rejected.
3. Press **Start Scan**. You are redirected to the scan page and the crawl begins immediately.

### 2. Watch progress live

The scan page streams progress over Server-Sent Events (with automatic polling fallback), so
results appear **while the scan is still running** — no refresh needed:

- **Counters**: pages scanned, images found, images processed.
- **Current activity**: the page being crawled and the image being processed.
- **Stop** button: ends the scan early; results gathered so far remain visible.

### 3. Read the results

Results are listed in a table (thumbnail, page URL, image URL, status, remark). Click any row
to open the **detail panel**, which shows:

- Image preview, dimensions, file size and MIME type.
- Status and remark.
- All pages the image occurs on (identical images are deduplicated — one row, many occurrences).
- **Reverse-search results**: the matching source(s) found, each with a link to the source page,
  the provider that produced it, and a **category badge** (commercial stock / free media /
  social / other — see *Match categories* below). When a row has matches in more than one
  category, filter chips let you show only one kind.
- **Provider search summary**: which configured providers ran for this image and what each
  found (match count, "No match", or "Failed" with the reason).

### 4. Act on a match

A `MATCH_FOUND` row means the image's exact content was located on a known source (by default,
Wikimedia Commons). To check the license:

1. Open the **source URL** from the reverse-search results (e.g. the Commons file page).
2. Review the license and attribution requirements listed there.

`NO_MATCH` images were **not found in the searched corpus only** — verify their origin manually
(stock-site receipts, in-house confirmation, or a manual reverse search in Google Images /
Bing Visual Search).

### 5. Retry failed lookups

If a provider lookup failed for an image (network or quota error), the row shows a
**Retry lookup** button once the scan has finished (in the result list and the detail panel).
Only the failed providers re-run — successful ones keep their earlier result, so no extra quota
is spent. Retries work both on live scans and on saved reports (see below).

### 6. Save and revisit results

- When a scan has finished, **Save results (JSON)** downloads the report and persists it under
  `data/results/<domain>.json` (gitignored).
- Scanning the same URL again warns that a saved result exists: choose **Show last result** to
  open it read-only, or **Scan fresh** to re-run the scan.
- The saved view is read-only; press **Edit** in its banner to enable retries. A retry on a saved
  report runs against the persisted JSON and writes the refreshed row back to the file — so it
  works even after the dev server was restarted.

### 7. Notes and limits

- The crawler follows links **within the target domain only** (up to 100 pages, depth 3,
  3 concurrent pages / 5 concurrent images). External image URLs are still processed.
- Identical images (same SHA-256) are downloaded and searched only once.
- Supported image formats: JPEG, PNG, WebP, GIF, AVIF (up to 10 MB each).
- Scans live in memory: a server restart clears them, but saved reports under `data/results/`
  remain and stay retryable. Thumbnails are cached under `data/images/` for the session.

## What it does

1. **Crawls** the target website only (same domain, `www`-equivalent), up to 100 pages at depth 3
   with 3 concurrent pages, JavaScript rendering included.
2. **Finds images** per page: `src`, lazy-load attributes (`data-src`, `data-lazy-src`,
   `data-original`), `srcset` (largest candidate) and `<picture><source>`.
3. **Processes each image**: SSRF-checked download (10 MB cap, 15 s timeout, magic-byte format
   validation), SHA-256 + SHA-1 hashing, perceptual fingerprints (aHash/dHash), WebP thumbnail.
4. **Reverse image search** (pluggable providers — see *Providers* below):
   - **Wikimedia Commons** (free, no key): exact-content SHA-1 lookup via the public MediaWiki
     API over ~100M files.
   - **Google Lens / SerpAPI** (opt-in): web-wide reverse image search by image URL.
   - **Google Cloud Vision** (opt-in): official Web Detection, uploads the image bytes.
   - **Custom endpoint** (opt-in): bring your own key.
5. **Shows results incrementally** over Server-Sent Events: status, remark, thumbnail, page URL,
   image URL — with a detail panel listing matching sources (categorized by source kind) and all
   pages an image occurs on.

Identical images (same SHA-256) are searched only once; every page occurrence is still listed.

## Statuses

| Status            | Meaning                                                          |
| ----------------- | ---------------------------------------------------------------- |
| `PROCESSING`      | The image is currently being processed.                          |
| `NO_MATCH`        | The configured providers found no match. *Not* proof of freedom. |
| `MATCH_FOUND`     | A potentially matching image/source was found.                   |
| `REQUIRES_REVIEW` | No provider searched this image — manual verification required.  |
| `FAILED`          | Download, validation or search failed; the scan continues.       |

## Match categories

Every reverse-search match is labeled by the *kind of domain* hosting it — a prioritization hint
for your manual review, **never a verdict**:

| Category | Short | Meaning |
| --- | --- | --- |
| Commercial stock | Stock | Likely sold commercially — a license is probably required. Verify, purchase, or replace. |
| Free media library | Free | Known free-license library — verify the exact file page and follow its attribution terms. |
| Social platform | Social | User-uploaded — the platform is not the rights holder; find the original source. |
| Other source | Other | Another web page using the image — useful to gauge spread, not license evidence. |

Categories are derived from the match's domain (see `lib/match-categorization.ts`) and shown as
badges in the result list and detail panel; filter chips appear when a row matches multiple kinds.

## Providers

Every scan runs one or more **reverse image search providers** and merges their results
(`MATCH_FOUND` wins over `NO_MATCH`). Before starting a scan, the home page shows a
**provider picker** where you can:

- toggle any configured provider on/off for that scan — by default only
  **Wikimedia Commons** is enabled; SerpAPI, Google Vision and custom endpoints must be
  selected explicitly for each scan (they may upload image bytes or cost money),
- see providers whose credentials are missing as **“Not configured”** (locked, with the env
  var name needed to enable them).

| Provider | Method | Config | Free allowance |
| --- | --- | --- | --- |
| Wikimedia Commons | Exact-content SHA-1 lookup (always available) | none | unlimited (rate-limited) |
| Google Lens (SerpAPI) | Web-wide reverse search **by image URL** | `SERPAPI_API_KEY` | ~250 searches/month |
| Google Cloud Vision | Official Web Detection, **uploads image bytes** | `GOOGLE_VISION_API_KEY` | 1,000 units/month |
| Custom endpoint | Your own reverse-search HTTP endpoint | `REVERSE_SEARCH_CUSTOM_URL` | — |

Notes:

- SerpAPI searches by the image's public URL, so it works for images crawled from public
  sites; each unique image costs one search.
- Google Vision sends the image bytes directly — no public URL required.
- If you select **no provider** (or none are configured), images are marked
  `REQUIRES_REVIEW` — the scanner never fakes results.
- Each result records **which providers ran** and what each one found; the image detail
  panel shows a per-provider summary, and every match is attributed to its provider.

## Configuration

No configuration is required for basic functionality (no paid services). Setting a key
**enables** the matching provider in the picker but does not turn it on by default — each
scan runs Wikimedia Commons unless you select additional providers. Restart the dev
server after changing `.env.local`.

```bash
# .env.local
SERPAPI_API_KEY=your-key                          # enables Google Lens (SerpAPI)
GOOGLE_VISION_API_KEY=your-key                    # enables Google Cloud Vision

REVERSE_SEARCH_CUSTOM_URL=https://your-endpoint.example/lookup/{sha256}
REVERSE_SEARCH_CUSTOM_API_KEY=your-key            # optional
REVERSE_SEARCH_CUSTOM_AUTH_HEADER=X-Api-Key       # optional, default: Authorization
```

The custom endpoint receives `{ sha1, sha256, mimeType }` and should return JSON matches:
`[{ "sourceName": "...", "sourceUrl": "https://...", "similarity": 95 }]`.

## Security

- Only `http://` and `https://` URLs are accepted.
- `localhost`, private IP ranges, link-local (incl. cloud metadata `169.254.169.254`), CGNAT,
  IPv4-mapped IPv6 and hostnames resolving to private addresses are rejected — including on
  every redirect hop.
- The crawler does not bypass authentication, CAPTCHAs or anti-bot mechanisms.

## Development

```bash
npm test     # Vitest unit tests (URL/SSRF, extraction, hashing, dedup, providers, registry)
npm run lint
npm run build
```

Scan thumbnails are written to `data/images/` and scan reports to `data/results/` (both
 gitignored). Scans live in memory and are lost on server restart — saved reports remain on disk
 and stay retryable. This is a local utility, by design.
