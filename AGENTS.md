# AGENTS.md

# Copyright Image Scanner — Development Instructions

## 1. Project Context

This project is a local web application for scanning images used on company profile websites.

The main workflow is:

```text
User enters website URL
        ↓
Crawl website pages
        ↓
Find images
        ↓
Process one image
        ↓
Reverse image search
        ↓
Store result
        ↓
Display result immediately
        ↓
Process next image
```

The application is a **copyright-risk screening tool**.

It must not claim that an image legally infringes copyright.

---

# 2. Technology Stack

Use:

- Node.js
- Next.js
- React
- TypeScript
- Playwright
- Sharp

Do not use Python.

Do not introduce a database for this project unless explicitly required.

The application must be runnable locally with:

```bash
npm install
npm run dev
```

Expected URL:

```text
http://localhost:3000
```

---

# 3. Development Scope

Keep the implementation focused on the requirements in `PRD.md`.

The project is **local-only**.

Do not implement:

- Vercel deployment
- Cloud deployment
- Supabase
- Cloud storage
- Background cloud workers
- User authentication
- User accounts
- Subscription systems
- Multi-user functionality
- Paid APIs

Do not build features that are not required by the PRD.

---

# 4. Main User Experience

The most important UX requirement is **incremental processing**.

Do not implement the scanner as:

```text
Crawl everything
    ↓
Process everything
    ↓
Show results
```

Instead use:

```text
Find page
    ↓
Find image
    ↓
Process image
    ↓
Reverse image search
    ↓
Show result
    ↓
Continue
```

The user should see results while the scan is still running.

---

# 5. Start Page

The main page should remain simple.

Required elements:

```text
Copyright Image Scanner

Website URL

[ URL input ]

[ Start Scan ]
```

Do not add unnecessary configuration options to the initial UI.

If crawl limits are exposed, use sensible defaults.

Recommended:

```text
Maximum pages: 100
Maximum crawl depth: 3
```

---

# 6. Scanner Architecture

Keep responsibilities separated.

Recommended structure:

```text
lib/
├── crawler/
│   ├── crawler.ts
│   ├── page-discovery.ts
│   └── image-extractor.ts
│
├── image/
│   ├── downloader.ts
│   ├── metadata.ts
│   └── fingerprint.ts
│
├── reverse-search/
│   ├── provider.ts
│   └── ...
│
└── validation/
    └── url.ts
```

The exact file names may differ, but responsibilities should remain separated.

---

# 7. Crawler

Use Playwright for website crawling.

The crawler must:

- Support JavaScript-rendered pages.
- Follow links within the target website.
- Normalize URLs.
- Avoid duplicate pages.
- Respect maximum page count.
- Respect maximum crawl depth.
- Handle page errors.
- Continue after individual failures.

Do not crawl indefinitely.

---

# 8. Domain Restriction

By default, only crawl pages belonging to the target website.

For example:

```text
Target:
https://example.com
```

Allowed:

```text
https://example.com/
https://example.com/about
https://example.com/services
```

Do not automatically crawl:

```text
https://facebook.com/example
https://linkedin.com/company/example
https://other-site.com
```

External image URLs referenced by the target page may still be processed when directly accessible.

---

# 9. Image Extraction

Support normal images:

```html
<img src="/images/team.jpg" />
```

Support common lazy-loading attributes:

```html
<img data-src="/images/team.jpg" />
<img data-lazy-src="/images/team.jpg" />
<img data-original="/images/team.jpg" />
```

Support:

```html
<img srcset="..." />
```

Image URLs must be resolved against the page URL.

Example:

```text
Page:
https://example.com/about

Image:
../images/team.jpg

Resolved:
https://example.com/images/team.jpg
```

---

# 10. Image Processing Pipeline

Every discovered image should follow this pipeline:

```text
Image discovered
      ↓
Normalize URL
      ↓
Check duplicate
      ↓
Download image
      ↓
Validate image
      ↓
Calculate fingerprint
      ↓
Reverse image search
      ↓
Create result
      ↓
Send result to UI
```

The reverse-search operation should happen per image.

---

# 11. Duplicate Handling

Avoid performing the same reverse image search repeatedly for identical images.

Use SHA-256 for exact duplicate detection.

Example:

```text
Image A
SHA-256 = abc123

Image B
SHA-256 = abc123

Result:
Same image
```

The system should reuse the reverse-search result for exact duplicates.

However, each occurrence must retain its own:

- Page URL
- Image URL
- Result/status

Example:

```text
Image A
├── Page: /
└── Image URL: /images/team.jpg

Image B
├── Page: /about
└── Image URL: /images/team.jpg
```

These can share one reverse-search result.

---

# 12. Perceptual Hash

Use a perceptual hash when practical.

The purpose is to detect visually similar images.

Examples:

- resized image
- slightly modified image
- cropped image

Do not treat perceptual similarity as proof of copyright infringement.

---

# 13. Reverse Image Search

Reverse image search must be isolated behind an abstraction.

Use an interface similar to:

```typescript
interface ReverseImageSearchProvider {
  search(image: ImageInput): Promise<ReverseImageSearchResult>;
}
```

Do not tightly couple the crawler to the reverse-search implementation.

The provider implementation should be replaceable.

The application should be able to represent:

```text
SEARCHING
NO_MATCH
MATCH_FOUND
FAILED
```

---

# 14. Important Reverse Search Constraint

Do not fake reverse image search.

Do not create a system that simply searches the image filename or URL and claims that it is reverse image search.

The implementation must clearly distinguish between:

```text
Actual reverse image search
```

and:

```text
Normal text/URL search
```

If the selected reverse-image-search provider cannot be automated reliably or legally, the implementation must not pretend otherwise.

---

# 15. Result Data Model

Each image occurrence should contain at least:

```typescript
interface ImageScanResult {
  id: string;
  pageUrl: string;
  imageUrl: string;
  status: ImageStatus;
  remark: string;
  previewUrl?: string;
  reverseSearchResults?: ReverseSearchResult[];
}
```

Possible statuses:

```typescript
type ImageStatus =
  | "PROCESSING"
  | "NO_MATCH"
  | "MATCH_FOUND"
  | "REQUIRES_REVIEW"
  | "FAILED";
```

---

# 16. Result UI

Results must be displayed in a list/table.

Required columns:

```text
#
Image
Page URL
Image URL
Status
Remark
```

Example:

```text
┌────┬─────────┬────────────┬────────────┬──────────────────┐
│ #  │ Image   │ Page URL   │ Status     │ Remark           │
├────┼─────────┼────────────┼────────────┼──────────────────┤
│ 1  │ Preview │ /          │ NO_MATCH   │ No match found   │
│ 2  │ Preview │ /about     │ MATCH_FOUND│ Possible match  │
│ 3  │ Preview │ /services  │ PROCESSING │ Searching...    │
└────┴─────────┴────────────┴────────────┴──────────────────┘
```

New results should appear without requiring the user to refresh the page.

---

# 17. Image Detail

Clicking a result should allow the user to inspect:

- Image preview
- Page URL
- Image URL
- Status
- Remark
- Reverse-search results
- Matching source URLs where available

Keep the detail UI simple.

---

# 18. Status Semantics

Use statuses carefully.

### PROCESSING

Reverse image search is currently running.

### NO_MATCH

No matching result was returned by the reverse-image-search provider.

It does **not** mean the image is copyright-free.

### MATCH_FOUND

A possible matching image/source was found.

### REQUIRES_REVIEW

The user should manually verify the image source/license.

### FAILED

The image or reverse search could not be processed.

---

# 19. Copyright Terminology

Never display definitive legal conclusions.

Do not use:

```text
Copyright violation
Illegal image
Copyright infringement
Definitely copyrighted
```

Prefer:

```text
Potential match
Potential copyright risk
Requires review
Unknown source
No match found
```

The application is a screening tool, not a legal authority.

---

# 20. Progress UI

The user must be able to see current progress.

Display information such as:

```text
Pages scanned: 12
Images found: 38
Images processed: 27

Current page:
/about

Current image:
/images/team.jpg
```

The progress should update while scanning.

---

# 21. API / Server Architecture

Use Next.js server-side functionality for scanner operations.

Browser code must not directly access:

- Playwright
- Sharp
- filesystem
- Node.js-only modules

Use API routes/server actions/server-side modules as appropriate.

Do not expose server-only implementation details to the client.

---

# 22. Local Data

Persistent cloud storage is not required.

Temporary scan data may be stored locally.

Possible structure:

```text
data/
├── scans/
├── images/
└── results/
```

Add generated data to `.gitignore`.

Do not commit scanned images or scan results to Git.

---

# 23. Security

Treat the input URL as untrusted.

Only allow:

```text
http://
https://
```

Reject:

```text
file://
ftp://
javascript:
data:
```

Prevent access to obvious internal resources:

```text
localhost
127.0.0.1
::1
private IP ranges
cloud metadata endpoints
```

The crawler must not become an SSRF proxy.

Do not bypass:

- CAPTCHA
- authentication
- access controls
- anti-bot systems

---

# 24. Download Limits

Image downloads must have reasonable limits.

Implement:

- request timeout
- maximum image size
- MIME type validation
- controlled concurrency

Do not load unlimited image data into memory.

A failed image should produce a `FAILED` result and the scanner should continue.

---

# 25. Concurrency

Do not process an unlimited number of pages/images simultaneously.

Use controlled concurrency.

Recommended starting values:

```text
Pages: 3 concurrent
Images: 5 concurrent
```

These values may be adjusted after testing.

---

# 26. Error Handling

One failure must not stop the entire scan.

Example:

```text
Image #10
    ↓
Download failed
    ↓
Status = FAILED
    ↓
Continue with Image #11
```

Errors should include enough information for debugging.

Do not expose internal stack traces to users.

---

# 27. TypeScript Rules

Use strict TypeScript.

Avoid:

```typescript
any;
```

unless there is a clear technical reason.

Prefer explicit interfaces/types.

Keep shared types in a dedicated location.

---

# 28. Testing

At minimum, test:

- URL validation
- URL normalization
- Domain restriction
- SSRF protection
- Page discovery
- Image extraction
- Lazy-loaded image extraction
- `srcset` extraction
- SHA-256 hashing
- Duplicate detection
- Result status handling

Important scanner logic should have unit tests.

---

# 29. Code Quality

Before considering the implementation complete:

```text
npm run lint
npm run build
npm test
```

must pass if those scripts exist.

Do not leave:

- unused imports
- dead code
- unnecessary dependencies
- debugging logs
- abandoned implementations

---

# 30. Dependency Rules

Before installing a package:

1. Check whether Node.js provides the required functionality.
2. Check whether Next.js already provides the functionality.
3. Prefer small, maintained packages.
4. Avoid unnecessary dependencies.
5. Do not add a package simply for convenience when native functionality is sufficient.

---

# 31. Development Order

Implement in this order:

```text
1. Initialize Next.js project
2. Create basic UI
3. Create scanner types
4. Implement URL validation
5. Implement SSRF protection
6. Implement website crawler
7. Implement page discovery
8. Implement image extraction
9. Implement image downloading
10. Implement image validation
11. Implement image hashing
12. Implement duplicate detection
13. Implement reverse-search abstraction
14. Implement reverse-image-search provider
15. Implement incremental scan results
16. Implement result list
17. Implement image detail
18. Implement progress UI
19. Add error handling
20. Add tests
21. Run lint/build/test
```

---

# 32. Do Not Over-Engineer

This is a local utility.

Do not introduce:

- microservices
- message queues
- Redis
- Kubernetes
- cloud workers
- authentication
- complex database architecture

unless explicitly requested.

Prefer the simplest architecture that satisfies `PRD.md`.

---

# 33. Agent Rules

Before coding:

1. Read `PRD.md`.
2. Understand the complete user flow.
3. Check the existing project structure.
4. Reuse existing code where appropriate.
5. Do not rewrite working components unnecessarily.

When implementing:

1. Work incrementally.
2. Keep modules focused.
3. Keep the UI simple.
4. Keep scanner operations server-side.
5. Make scan results incremental.
6. Handle individual failures gracefully.
7. Maintain the distinction between copyright screening and legal determination.

When finished:

1. Run tests.
2. Run lint.
3. Run build.
4. Fix errors.
5. Verify the local application manually.

---

# 34. Definition of Done

The application is complete when the following flow works end-to-end:

```text
Enter URL
    ↓
Start Scan
    ↓
Crawl website
    ↓
Find page
    ↓
Find image
    ↓
Process image
    ↓
Reverse image search
    ↓
Create result
    ↓
Display result immediately
    ↓
Continue scanning
    ↓
User can inspect every result
```

The application must run locally using Node.js and must not require Python.
