# Codebase Bug & Issue Report — 2026-09-15

Scope: crawler, image pipeline, scan engine/store, API routes, reverse-search
providers, persistence, and UI. Findings ordered by severity. Line numbers refer
to the tree at the current HEAD (post `eeb892a` plus the timestamp display change).

---

## 1. Race in the Commons rate limiter distorts pacing

**Severity: Medium** · `lib/reverse-search/commons.ts:38-45` · **Status: FIXED**
(2026-09-15 — replaced with `SequentialRequestQueue`
(`lib/reverse-search/request-queue.ts`); Commons API calls are chained off a
shared promise tail so only one request is in flight and consecutive starts
are ≥ 250 ms apart, verified by `tests/request-queue.test.ts`.)

`rateLimit()` reads `lastRequestAt`, sleeps, then unconditionally sets
`lastRequestAt = Date.now()` when the sleep finishes. With the 5 concurrent
image workers all sharing this module-level limiter:

- Two workers can both compute a wait against the same stale `lastRequestAt`,
  sleep the same duration, and fire nearly simultaneously (thundering herd on
  the exact same tick) — the limiter does not serialize requests, it only
  spaces out *starts*.
- `lastRequestAt` is set when the sleep ends, not when the request is made, so
  the effective spacing between actual requests shrinks under concurrency.

Result: bursts faster than the documented ≤4 req/s, risking 429s from the
MediaWiki API (which the retry logic then papers over, slowing scans further).

**Suggested fix:** a proper sequential queue — chain each request off a shared
promise tail (`tail = tail.then(() => request())`), or track
`lastRequestAt = Date.now()` *before* sleeping and hold a mutex while
sleeping+requesting.

---

## 2. `Saved:` badge in the UI is never rendered from real data

**Severity: Medium** · `app/api/scan/saved/route.ts:26`, `components/*`

`GET /api/scan/saved` hardcodes `savedAt: null` in its response even though
`saveScanSnapshot()` persists a real `savedAt` ISO timestamp in every file.
No consumer renders it today, but:

- the warning dialog in `ScanForm.tsx` shows "scanned <startedAt>" — the scan
  *start* time, not when it was saved, which is subtly wrong after re-saves;
- any future "list saved scans" UI would silently show empty dates.

**Suggested fix:** return `savedAt: payload.savedAt` from the route and surface
it in the warning message ("saved on <savedAt>").

---

## 3. `{ providerId, ... }` in match stubs fails to satisfy the type

**Severity: Low (tests only)** · `tests/provider-registry.test.ts:6-9`

`stubProvider` returns matches like
`{ sourceName, sourceUrl, providerId }` — fine. But note that in
`tests/match-categorization.test.ts` the match stubs are
`{ sourceUrl: string }` passed to `summarizeMatchCategories`, which only needs
`sourceUrl`. No bug here today, but the two stub shapes drift easily; if
`MatchSource` gains required fields again the provider test breaks first.

**Suggested fix:** extract a shared `makeMatch()` helper in a test util so both
files build `MatchSource` objects from one place.

---

## 4. Scan store never prunes in production

**Severity: Low** · `lib/scan/scan-store.ts:91`, `app/api/scan/route.ts`

`pruneScans(max = 20)` exists and is tested, but the only callers are the unit
tests. `startScan()` (via `app/api/scan/route.ts`) never calls it, so every
scan ever started in a long-lived dev server session stays in the map —
results arrays included. For a long session scanning image-heavy sites this
grows unbounded (hundreds of MB of in-memory results are possible).

**Suggested fix:** call `pruneScans()` inside `startScan()` before creating a
new entry, so the documented bound actually applies.

---

## 5. Duplicate-scan warning bypassed by history navigation

**Severity: Low** · `components/ScanForm.tsx`, `app/api/scan/route.ts`

The 409 `saved-scan-exists` check runs per POST. Fine, but two related gaps:

- The `?saved=1` flag in the scan page URL is read via
  `window.location.search` during render (`app/scan/[id]/page.tsx:95`). This
  works on first paint but breaks if the router ever re-renders without
  navigating (Next.js client transitions can re-run render with the same
  URL — acceptable here, just fragile).
- **A "Show last result" click leaves `fresh` unset, so if the user then
  re-submits the form for the same URL they get the warning again. That is
  correct behavior — but if the user clicks "Scan fresh" twice quickly
  (double-click), two scans for the same URL can race and both run, doubling
  the load on the target site.**

**Suggested fix:** disable the "Scan fresh" button once it has been clicked
(submitting state already exists — reuse it; currently
`setSubmitting(true)` happens inside `startScan`, which does cover this, but
the warning panel's own buttons are not covered by `disabled={submitting}`).

---

## 6. `startPollingFallback` can poll a finished scan forever

**Severity: Low** · `app/scan/[id]/page.tsx` (SSE effect)

The polling fallback (used when SSE fails) has no stop condition on scan
state: it keeps hitting `GET /api/scan/<id>` every 2 s even after the snapshot
reports `COMPLETED`/`FAILED`. On a long-lived open tab this is an endless
1-request/2s loop against the dev server.

**Suggested fix:** inside the polling callback, clear the interval when
`snapshot.progress.state !== "RUNNING"`.

---

## 7. `imagesProcessed` can exceed `imagesFound`

**Severity: Low (cosmetic)** · `lib/scan/scan-engine.ts:97-104`, `image-processor.ts`

`imagesFound` counts each *unique image URL* once, but
`emitFailedResult`/`processImageTask` increment `imagesProcessed` per *task*.
The same URL encountered on a second page enqueues a repeat task; if the first
attempt failed, the repeat attempt emits a second FAILED row and increments
the counter again. The UI then shows `Images processed > Images found`,
which is confusing.

**Suggested fix:** in `emitFailedResult`, skip the row/counter when
`urlToResultIndex` already maps this URL to a FAILED row; or count
`imagesProcessed` off `seenImageUrls`-style uniqueness.

---

## 8. Dead code / leftovers

**Severity: Low (hygiene)** · AGENTS.md §29 forbids abandoned code.

- `lib/scan/scan-store.ts:19` — `pendingSha?: string` field is written by
  nothing and read by nothing (superseded by `pendingShas` map).
- `app/api/scan/saved/route.ts:26` — `savedAt: null` placeholder (see §2).
- `lib/crawler/crawler.ts:31` — `CrawlSummary` is returned but its
  `pagesFailed`/`uniqueImageUrls` fields are discarded by the only caller
  (`scan-engine.ts`); `pagesFailed` would be useful in the progress UI.

---

## 9. Crawler: pages can be counted before images are actually extracted

**Severity: Info** · `lib/crawler/crawler.ts:88-108`

`onPageScanned` fires right after `extractImages`, but lazy-loaded images that
materialize *after* the `waitUntil: "load"` + `domcontentloaded` window are
missed. This is a known trade-off of the fixed-delay approach; the
`data-src`-style attribute extraction mitigates it. No action needed unless
missed-image reports come in; if so, a scroll-to-bottom pass or
`networkidle` waiting would close the gap at the cost of crawl speed.

---

## 10. Thumbnails are keyed by scan, orphaned after prune/restart

**Severity: Info** · `lib/image/thumbnails.ts`, `.gitignore`

`data/images/<scanId>/` directories are never garbage-collected. After the
in-memory scan store drops a scan (or the server restarts), the thumbnail
files remain on disk forever, and saved-snapshot views that reference
`/api/images/<scanId>/<file>` will 404 for pruned scans. Consider a startup
sweep or a "delete saved scans" action that also removes the folder.

---

## 11. `remark` selection in merged results is order-dependent

**Severity: Info** · `lib/reverse-search/index.ts:230`

When several providers return NO_MATCH, the merged remark is the *last*
provider's remark (`remarks[remarks.length - 1]`). With both Commons and
SerpAPI enabled, a scan row can attribute the "No matching image on Wikimedia
Commons." text to a result that actually has only SerpAPI matches... the
status is right, the prose is arbitrary. Prefer joining all remarks or
prefixing with provider labels.

---

## What was checked and looks sound

- **SSRF guards**: `validateUrlWithDns` blocks private/loopback/link-local/
  CGNAT/IPv4-mapped ranges, re-validates every redirect hop (downloader) and
  every page navigation (crawler). Decimal/hex IPv4 obfuscation handled.
- **Redirect handling**: manual, capped at 3, each hop re-validated.
- **Size/timeout limits**: enforced on content-length and streamed bytes;
  body reader cancels on overflow.
- **Duplicate SHA merging**: `pendingShas` claim map correctly serializes
  concurrent identical bytes; `releaseClaim` runs in `finally`.
- **SSE stream**: initial snapshot + live events, keepalive heartbeat, and a
  finish-watcher; `cancel()` cleans up subscriptions.
- **Scan API validation**: rejects non-array/empty providers, unconfigured
  provider ids, invalid URLs; `fresh: true` is the only bypass of the
  saved-scan warning.
- **Persistence**: URL→filename mapping is traversal-safe; corrupt files are
  tolerated; overwrite semantics are newest-wins.
- **No legal-conclusion wording** anywhere in statuses/remarks (screening
  terminology enforced, incl. a test guarding it).
