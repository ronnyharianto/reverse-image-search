# Product Requirements Document

# Copyright Image Scanner

## 1. Product Overview

Copyright Image Scanner is a local web application used to scan images displayed on a company profile or website.

The user provides a website URL. The system crawls the website pages, finds images on each page, performs reverse image search for each discovered image, and displays the results in a list.

The purpose of the application is to help users identify images that may require copyright or license verification.

The application does **not** determine whether an image legally infringes copyright.

---

# 2. Technology

The application runs locally.

Required technology:

- Node.js
- Next.js
- React
- TypeScript
- Playwright
- Sharp

The application must not require Python.

The application must not require a paid external service for the basic application functionality.

---

# 3. Main User Flow

The complete user flow is:

```text
User enters website URL
        ↓
System starts crawling website
        ↓
System finds pages
        ↓
System finds images on each page
        ↓
For each image:
        ↓
Reverse image search
        ↓
Analyze search result
        ↓
Save result
        ↓
Display result in UI
        ↓
Continue to next image
```

The system should process images incrementally.

The user should be able to see results while the scan is still running.

The system must not wait until the entire website has been scanned before displaying the first result.

---

# 4. Start Scan Page

The initial page should contain a simple form.

```text
Copyright Image Scanner

Website URL

┌──────────────────────────────────────────────┐
│ https://example.com                          │
└──────────────────────────────────────────────┘

[ Start Scan ]
```

The user enters the URL of the company profile or website to scan.

---

# 5. Website Crawling

After the user starts the scan, the system crawls pages belonging to the target website.

Example:

```text
https://example.com
https://example.com/about
https://example.com/services
https://example.com/contact
```

The system should follow links found on the website.

The crawler must:

- Stay within the target website/domain.
- Avoid processing the same page multiple times.
- Handle relative and absolute URLs.
- Support JavaScript-rendered pages.
- Have a configurable maximum number of pages.
- Have a configurable crawl depth.
- Handle page errors without stopping the entire scan.

The default limits should be reasonable to prevent an uncontrolled crawl.

Recommended defaults:

```text
Maximum pages: 100
Maximum crawl depth: 3
```

---

# 6. Image Detection

For every crawled page, the system searches for images.

The system must detect normal images such as:

```html
<img src="/images/company.jpg" />
```

The system should also detect common lazy-loaded images such as:

```html
<img data-src="/images/company.jpg" />
<img data-lazy-src="/images/company.jpg" />
<img data-original="/images/company.jpg" />
```

The system should support responsive images using `srcset`.

For every image found, the system records:

- Page URL
- Image URL
- Image preview
- Image status
- Image remark

---

# 7. Image Processing

When an image is discovered:

```text
Image discovered
       ↓
Validate image
       ↓
Download image
       ↓
Prepare image
       ↓
Reverse image search
       ↓
Store result
       ↓
Display result
```

An error processing one image must not stop the entire scan.

---

# 8. Reverse Image Search

Every discovered image should be submitted to a reverse image search mechanism.

The reverse image search should attempt to identify:

- Matching images
- Similar images
- Possible original/source websites
- Possible stock-image sources
- Other websites containing the same or similar image

The reverse search implementation must be isolated from the crawler so that the image crawler and search functionality remain separate.

Conceptually:

```typescript
interface ReverseImageSearchProvider {
  search(image: ImageInput): Promise<ReverseImageSearchResult>;
}
```

The exact reverse image search provider can be selected during implementation based on available free/local-compatible options.

The system must not claim that an image infringes copyright solely because a match was found.

---

# 9. Result List

The main scan page should display discovered images as a list/table.

Example:

```text
Scan Results

Target:
https://example.com

Progress:
Pages scanned: 12
Images found: 37
Images processed: 25
Currently processing: Image #26
```

Result table:

| #   | Image     | Page URL    | Image URL             | Status          | Remark                  |
| --- | --------- | ----------- | --------------------- | --------------- | ----------------------- |
| 1   | Thumbnail | `/`         | `/images/hero.jpg`    | NO_MATCH        | No matching image found |
| 2   | Thumbnail | `/about`    | `/images/team.jpg`    | MATCH_FOUND     | Possible match found    |
| 3   | Thumbnail | `/services` | `/images/service.jpg` | REQUIRES_REVIEW | Possible stock image    |
| 4   | Thumbnail | `/contact`  | `/images/map.jpg`     | FAILED          | Reverse search failed   |

The list must update while the scan is running.

---

# 10. Image Detail

The user should be able to click an image result to see more information.

Example:

```text
Image Detail

┌─────────────────────────────────────┐
│                                     │
│          Image Preview              │
│                                     │
└─────────────────────────────────────┘

Page URL:
https://example.com/about

Image URL:
https://example.com/images/team.jpg

Status:
MATCH_FOUND

Remark:
Possible matching image found.
```

The detail page/panel should also display reverse image search results when available.

Example:

```text
Reverse Search Results

1. Example Stock Website
   URL: https://example.com/image/123
   Similarity: 95%

2. Another Website
   URL: https://another-site.com/photo
   Similarity: 91%
```

---

# 11. Status

The system should use the following statuses:

### `PROCESSING`

The image is currently being processed.

### `NO_MATCH`

The reverse image search did not find a matching result.

This does **not** mean the image is copyright-free.

### `MATCH_FOUND`

A potentially matching image was found.

### `REQUIRES_REVIEW`

The result indicates that the user should manually investigate the image/license.

### `FAILED`

The system could not process or search the image.

---

# 12. Remark

The `Remark` field should provide a short explanation of the current result.

Examples:

```text
No matching image found.

Potential matching image found.

Possible stock image detected.

Multiple matching sources found.

Reverse image search failed.

Image could not be downloaded.
```

The remark must not state a definitive legal conclusion.

Do not use:

```text
Copyright violation.
```

Instead use:

```text
Potential copyright risk. Manual verification required.
```

---

# 13. Scan Progress

While scanning, the UI should show progress information.

Example:

```text
Scanning website...

Pages scanned:     8
Images discovered: 32
Images processed:  24

Current page:
https://example.com/about

Current image:
https://example.com/images/team.jpg
```

The result list should continue updating as images are processed.

---

# 14. Duplicate Images

If the same image appears on multiple pages, the system should be able to identify it as the same image.

Example:

```text
/image/team.jpg

Found on:
/
/about
/contact
```

The system should avoid unnecessarily performing the same reverse image search multiple times for an identical image.

However, each page occurrence should still be associated with the image so the user can see where it is used.

---

# 15. Error Handling

Errors must not stop the complete scan.

Examples:

```text
Page cannot be accessed
Image cannot be downloaded
Image format is unsupported
Reverse image search failed
Request timed out
```

The system should mark the affected item as:

```text
FAILED
```

and continue processing other pages/images.

---

# 16. Security

The URL entered by the user must be validated.

Only:

```text
http://
https://
```

URLs are allowed.

The application must not allow the crawler to access obvious internal/private resources such as:

```text
localhost
127.0.0.1
::1
private IP addresses
cloud metadata endpoints
```

The crawler must not bypass:

- Authentication
- CAPTCHA
- Access controls
- Anti-bot mechanisms

---

# 17. Local Application

The application must run locally using Node.js.

Expected development command:

```bash
npm install
npm run dev
```

The application should then be accessible through:

```text
http://localhost:3000
```

No Python installation should be required.

No cloud server should be required.

---

# 18. Suggested Project Structure

```text
copyright-image-scanner/
│
├── app/
│   ├── page.tsx
│   ├── scan/
│   │   └── page.tsx
│   └── api/
│       └── scan/
│           └── route.ts
│
├── components/
│   ├── ScanForm.tsx
│   ├── ScanProgress.tsx
│   ├── ImageResultList.tsx
│   └── ImageDetail.tsx
│
├── lib/
│   ├── crawler/
│   ├── image/
│   ├── reverse-search/
│   └── validation/
│
├── types/
│   └── scanner.ts
│
├── public/
│
├── package.json
├── tsconfig.json
├── PRD.md
└── AGENTS.md
```

The AI agent may adjust the structure when necessary, provided the separation of responsibilities is maintained.

---

# 19. Acceptance Criteria

The application is complete when all of the following work:

1. User can enter a company profile/website URL.
2. User can start a scan.
3. System crawls pages within the target website.
4. System finds images on each page.
5. System supports normal and common lazy-loaded images.
6. System records the page URL for each image.
7. System records the image URL.
8. System displays an image preview.
9. System performs reverse image search for discovered images.
10. Results are displayed incrementally while scanning.
11. User can see the status of every processed image.
12. User can see a remark for every image.
13. User can inspect reverse search results.
14. Duplicate images are detected to avoid unnecessary repeated searches.
15. A failed image/search does not stop the complete scan.
16. User can see the current scanning progress.
17. The application runs locally with Node.js.
18. Python is not required.
19. No paid service is required for the basic application.
20. The application does not claim that an image is legally infringing copyright.

---

# 20. Important Principle

This application is a **copyright-risk screening and research tool**.

Reverse image search results indicate that an image may exist elsewhere. They do not, by themselves, establish copyright ownership or infringement.

The application must therefore use terminology such as:

```text
No Match
Match Found
Potential Match
Requires Review
Unknown
Failed
```

and must not automatically state:

```text
Copyright Violation
Illegal Image
Copyright Infringement
```

unless the user independently establishes that conclusion.
