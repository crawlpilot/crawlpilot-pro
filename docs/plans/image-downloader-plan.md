# CrawlPilot: Image Downloader, from page scanner to best-in-class

Branch base: `feat/scraper-toolkit` (AI Extract X1 and markdown M1 done).

The goal: when someone wants the images on a page, or on a hundred pages, CrawlPilot finds every one of them
at full size, saves them under useful names, says exactly what failed and why, and does it without wrecking
the page they're on. Each phase below closes a gap that today loses images, or adds a feature the toolkit
already has the parts for (tab pool, job runner, data tables, on-device model).

Recommended order: **G0 → G1 → G2 → G3 → G4 → G5 → G6 → G7.** G0 to G2 fix correctness (missing images,
silent failures); they come before any new feature.

---

## 1. Where things stand

| Part | File | What it does |
|---|---|---|
| Scanner | `content/features/universal-images/ImageScanner.ts` | Walks `querySelectorAll('*')` (with open shadow roots). It reads `<img>`, `<picture><source>`, video posters, `<canvas>` (as a PNG data URL) and inline or computed `background-image`. Results are deduped by exact URL |
| Deep scan | `ProgressiveImageScanner.ts` | Scrolls the window top to bottom in 800px steps, capped at 50,000px. It rescans the whole page each step and watches mutations for 3s, then scrolls back |
| Live watch | same | A MutationObserver that does a full rescan on every mutation batch |
| Handlers | `content/handlers/images.ts` | `SCAN_IMAGES_DEEP`, `_CANCEL`, `_LIVE_START`, `_LIVE_STOP`; streams batches to the panel |
| Panel | `pages/ImageDownloaderPage.tsx`, `hooks/useImageScan.ts`, `components/images/*` | A 3-column grid, filters (format, size class, width and height, visible only, search) and size groups. Downloads one file via `chrome.downloads`, or a zip via JSZip |
| Fetching | `background/index.ts` `DOWNLOAD_IMAGE_PROXY` | When the panel's CORS fetch fails, the background fetches with `credentials: 'omit'` and a 15s timeout. It returns the bytes as `Array.from(Uint8Array)` |
| Tests | `imageFilters.test.ts` (26 lines) | Filters only. Nothing covers the scanner, the downloads or the end-to-end flow |

## 2. Gaps (found in the code)

### 2.1 Images it never finds

1. **Linked full-size images.** It misses `<a href="…/photo.jpg">` around a thumbnail, the most common
   gallery pattern, so users get the 300px thumbnail and never the original.
2. **Lazy attributes.** The scanner reads only `data-src`, `data-lazy-src` and `data-original`. Our own
   `content/services/markdown/images.ts` (`imageSource`, `largestSrcset`) knows 17 lazy attributes,
   `data-srcset`, placeholders and `<picture>` fallbacks. The two disagree; the scanner should use the
   markdown helpers.
3. **`currentSrc` first.** It takes the candidate the browser picked for the current viewport and DPR, not
   the largest in `srcset`. In a narrow side-panel layout, that is usually the small one.
4. **Image types never collected:**
   - inline `<svg>` (the `'svg'` element type exists but nothing produces it);
   - SVG `<image href>`;
   - `::before`/`::after` backgrounds;
   - `image-set()`, `mask-image`, `border-image`, `list-style-image`;
   - `<input type="image">`, `<object data>`, `<embed>`;
   - `<noscript>` fallbacks holding the real `<img>`;
   - `og:image`, `twitter:image`, the JSON-LD `image`, favicons, `apple-touch-icon`.
5. **Iframes.** Content scripts run with `all_frames: false`, so embedded galleries and widgets are never
   scanned.
6. **Inner scroll containers.** The deep scan scrolls only the window. Feeds, modals and grids that scroll
   inside a `div`, like many SPA layouts, never load their lazy images.
7. **Carousels and hidden slides.** "Visible only" is on by default, and `isVisible` treats
   `display:none`, `opacity:0` and zero-size as invisible. That hides inactive carousel slides and
   zoom images, which are often exactly the product photos people came for.
8. **Blob and data URLs** from the page can't be fetched from the side panel (wrong origin), so zips skip
   them silently.

### 2.2 Wrong information

- **Type guessed from the URL extension**, defaulting to `jpg`. CDN URLs without an extension
  (`/image?id=…`, Shopify, Cloudinary `f_auto`, `format=webp`) are all labelled `jpg`, so the format
  filter is wrong for them.
- **Dimensions:**
  - backgrounds use the element's box, not the image's natural size;
  - `<source>` borrows the sibling `<img>`'s size, even though it is a different file;
  - a lazy image not yet loaded falls back to its rendered box.
- **`sizeBytes` is declared but never filled.**
- **The same picture listed several times.** `?w=300` and `?w=1200` of one photo, or one photo on two
  CDN hosts, appear as separate images. No size variants are folded together and no content is compared.
- **Updates are lost.** `scanMerge` returns `all.slice(beforeCount)`, so a better size found later for a
  known URL is never sent, and `useImageScan.merge` ignores known URLs anyway.

### 2.3 Downloads that fail silently or badly

- **Zip downloads:**
  - sequential, one fetch at a time; 500 images take minutes;
  - no progress beyond "Packing…";
  - failed images are skipped with no count or list, and no retry.
- **Background proxy:**
  - `Array.from(Uint8Array)` sends a 2 MB image as a JSON array of numbers, about 10× the size, through
    messaging;
  - `credentials: 'omit'` breaks images that need a login cookie (private albums, intranets, paid
    sites);
  - no `Referer` header, so hotlink-protected hosts return 403s or placeholder images.
- **Names:**
  - zip entries are `image_1.jpg`, …; the original file names, alt text and page are lost;
  - single files are `image-<timestamp>.jpg`;
  - no subfolders, no naming template, no `conflictAction`.
- **Fallback.** `saveAs(url)` on a cross-origin URL opens the image instead of saving it.
- **Memory.** JSZip builds the whole archive in memory. A large gallery (1–2 GB) crashes the panel.

### 2.4 Intrusive and slow

- **Scroll on open.** Opening the tool starts a deep scan right away, which scrolls the user's page to
  the top and back.
- **Fixed scroll timing.** Steps are 800px with a 100–120 ms wait, whatever the site; slow lazy
  loaders are missed.
- **Full rescan on every step and mutation.** Each one runs `querySelectorAll('*')` and
  `getComputedStyle` on every element. On a 20k-node page that is seconds of main-thread work per step,
  and live watch rescans on every mutation without throttling.
- **Tab switches.** It works on the active tab only. Switching tabs during a scan sends later messages to
  a different tab.

### 2.5 UI

- **Colours.** They are hard-coded for a dark theme (white rgba values, `#06b6d4`, a navy gradient)
  instead of theme tokens, so the page looks broken in a light theme.
- **Untranslated text:** "Search...", "Show more (N remaining)" and the size chips ("< 500px",
  "Medium", "Large").
- **Missing features:**
  - no preview or lightbox;
  - no way to see where an image is on the page;
  - no sort (page order, size, bytes);
  - no shift-click range selection;
  - no exclude filter, domain filter or aspect-ratio filter;
  - filters reset on every open;
  - the grid is fixed at 3 columns.
- **No outputs beyond files:** no "copy URLs", and no CSV/JSON of what was found. Images can't go to Data
  tables, which is how the rest of the toolkit shares results.

## 3. What "best in the industry" means here

These are the features dedicated image-downloader extensions and tools commonly offer: full-size
detection, link-following, bulk rename, folders, multi-tab, URL filters, format conversion, dedupe. Two
more set CrawlPilot apart: the scan runs on the same engine as the scrapers, and everything stays on the
device.

| Capability | Today | Target |
|---|---|---|
| Finds lazy, `srcset`, `<picture>` and background images | Partly | Every source in §2.1, iframes included |
| Gets the full-size original | No | Linked originals, largest `srcset` and CDN rewrites, each checked by a probe |
| Correct type, size and bytes | Guessed | Probed (a `HEAD` or ranged request, plus magic bytes) |
| Dedupe | Exact URL | URL variants folded, plus a perceptual hash for identical pixels |
| Logged-in and hotlink-protected images | Fail | Fetched in the page (with its cookies) or with a `Referer` rule |
| Large batches | Sequential zip in memory | Parallel per-host pool, a streamed zip or straight to a folder, progress, retry, a failure report |
| Names and folders | `image_1.jpg` | Templates (`{site}/{page}/{n}-{alt}.{ext}`) and subfolders |
| Many pages | Active tab only | Open tabs, a URL list, pagination via the job runner, background runs |
| Convert and resize | No | WebP/AVIF → JPG/PNG, max edge, metadata stripped, on-device |
| Results as data | No | A manifest in Data tables: URL, page, alt, caption, size, bytes, file name |
| Understands images | No | On-device alt text, tags and "only product photos" (Prompt API image input, #29) |
| Reruns | No | Save as a recipe; a rerun downloads only new images |

## 4. Phases

### G0: tests first (corpus and end-to-end)

- **`e2e/site/gallery.html`**, served by the existing harness, covering:
  - `srcset` and `data-srcset`, `<picture>`, lazy attributes, a `<noscript>` fallback;
  - a thumbnail linked to its original;
  - a background, a pseudo-element background and `image-set()`;
  - inline SVG, a hidden carousel slide, an inner scroll container that lazy-loads;
  - an open shadow root and a same-origin iframe;
  - a `blob:` image and an extension-less CDN URL served as WebP.
- **Harness routes:**
  - `/site/protected.jpg`: returns 403 without the right `Referer`;
  - `/site/private.jpg`: needs a cookie;
  - `/site/slow.jpg`: slow, to test timeouts and retries.
- **Unit tests** for the source resolver, CDN rewrites, URL-variant folding, the naming template and the
  pool and retry logic.
- **End-to-end:** scan finds N; download all → the zip holds N files with the expected names; the failure
  report lists exactly the broken ones.
- **Done when** the tests encode every §2 gap and fail against today's code.

### G1: one scanner, every source, incremental

- **Sources.**
  - Replace `getBestSrc`/`getSrcSetMax` with `imageSource`/`largestSrcset` from
    `content/services/markdown/images.ts`; move them to `shared/` or `content/services/images/`, which
    both use.
  - Collect each candidate as `{url, variants[], origin}`: `currentSrc` and the largest `srcset` entry
    are both kept, and the larger wins.
  - Add every source in §2.1, item 4, plus linked originals (`a[href]` whose path ends in an image
    extension or whose `type` is an image; checked by a probe in G3).
- **Context for each image:**
  - page position (`document order`, `rect.top`);
  - nearest heading;
  - `figcaption`/`alt`/`title`, the link href;
  - the enclosing list item (it reuses the List Extractor's repeated-item detection, so a listing
    becomes "one product, its 4 photos").
- **Iframes.** Inject into frames on demand (`chrome.scripting.executeScript({allFrames: true})` for
  the scan only), merging by `frameId`. Keep `all_frames: false` for the always-on script.
- **Incremental.**
  - The first pass is a full walk.
  - After that, handle only `MutationRecord.addedNodes` and changed attributes, batched in
    `requestIdleCallback`, at most every 250 ms.
  - Read computed backgrounds only for elements with layout. This replaces the full rescan per step.
- **Updates.** Batches carry `{added, updated}`; the panel merges updates (larger size, better type).
- **Deep scan.**
  - Scroll the largest scrollable element, which may not be the window.
  - Wait adaptively: stop waiting once no new requests or images have arrived for 300 ms, with a 2 s
    maximum per step.
  - Detect the end of an infinite feed by "no growth in 3 steps", not by a pixel cap.
  - Opening the tool runs a **quick scan** (no scrolling). The deep scan is a button.
- **Carousels.** "Visible only" now means "not tracking pixels or decoration", based on size and an
  icon heuristic. Hidden slides are kept and tagged `hidden`, and filtered only on request.
- **Tab binding.** The scan stays tied to its `tabId` (the panel's `toTab` pattern), so switching tabs
  doesn't redirect messages.

### G2: a fetch and save engine that reports everything

- **Where bytes come from, in order:**
  1. **The page context** (the content script's `fetch` with `credentials: 'include'`): it has the
     site's cookies, a natural `Referer`, and can read `blob:` URLs. Data URLs are decoded locally.
  2. **The background** with `credentials: 'include'` and a session `declarativeNetRequest` rule that
     sets `Referer` to the page's origin for that host (see §6, decision 1).
  3. **`chrome.downloads.download(url)` directly**, when only a file is needed, not the bytes.
- **Transport.** Stop sending number arrays. Either the content script saves files itself
  (`chrome.downloads` with a `blob:` URL it creates, through the background), or bytes travel as base64
  in fixed-size chunks over a port. Measure both in G0's end-to-end tests and pick one.
- **Pool.**
  - Concurrency is 6 overall and 2 per host, with retry and backoff on 429, 5xx and timeouts
    (it honours `Retry-After`).
  - Timeouts scale with size; abort is supported.
- **Output modes:**
  - (a) **to a folder:** `chrome.downloads` per file, under `CrawlPilot/{site}/…`, with
    `conflictAction: 'uniquify'`;
  - (b) **a streamed zip:** `fflate`'s streaming zip into a file, so memory stays flat; it replaces JSZip
    for images.
  - Default: a folder above 200 images or 300 MB, a zip below that.
- **Naming template.**
  - Tokens: `{site}`, `{page}` (title slug), `{n}`, `{name}` (the original file name), `{alt}`,
    `{width}x{height}`, `{ext}` (from the content type), `{date}`.
  - Presets: "Original names", "Page / number", "Product / alt". Filenames are sanitised.
- **Report.** A live counter while saving (done, failed, remaining, MB). At the end, a failure list
  with each reason (403 hotlink, 401 login, timeout, not an image), plus "Retry failed" and "Copy failed
  URLs".
- **Done when** the protected, private, slow and blob images in G0 all download, and a 2,000-image
  run keeps the panel under 300 MB.

### G3: full-size originals

- **Candidates for each image:**
  - the linked href;
  - the largest `srcset` entry;
  - `data-zoom-image`/`data-large-image`;
  - the JSON-LD `image` for the same product;
  - CDN rewrite rules.
- **CDN rules** (`shared/images/fullsize.ts`): one table of `{host test, from → to}` rules, each a
  pure function with a unit test. Initial set:
  - Shopify `_300x300` → none;
  - WordPress `-300x200.jpg` → `.jpg`;
  - Cloudinary `w_…,h_…,c_…` → removed;
  - imgix, Contentful and Sanity `?w=&h=&fit=` → removed;
  - Amazon `._AC_SX300_.` → `.`;
  - Wix `/v1/fill/w_…` → the original;
  - Squarespace `?format=300w` → `2500w`;
  - Unsplash and Pexels `?w=` → removed;
  - Medium `/max/800/` → `/max/4096/`.
- **Probe each candidate** (`HEAD`, or a `Range: bytes=0-64` GET where HEAD is blocked) for
  `content-type`, `content-length` and magic-byte dimensions (PNG IHDR, JPEG SOF, WebP VP8X, GIF, AVIF
  ispe). Take the largest valid one; never trust a rewrite without a probe.
- **Panel.** Each card shows "full size 3000×2000 (was 300×200)". A toggle switches between "full
  size" and "as shown".
- **Galleries that load the original on click** (a lightbox) are G6's click-through.

### G4: the panel

- **Theme.** Replace hard-coded colours with theme tokens, so the panel works in light and dark. Move
  all strings to `imageDownloader.json`: English now, the other 8 locales via #17.
- **Grid:**
  - 2 to 6 columns with a zoom slider; virtualised;
  - shift-click range selection, drag to select;
  - keyboard: arrows, space, `a`, `Esc`.
- **Lightbox:**
  - full-size preview with arrow keys;
  - details: URL, page, alt, caption, size, bytes, type;
  - "Show on page", which scrolls to the element and highlights it with the existing selector-highlight
    overlay; copy image or URL; open the original.
- **Sort:** page order, size, bytes, type.
- **Filters:** aspect ratio (square, portrait, landscape, banner), domain, URL include/exclude
  (text or regex), "exclude icons and logos", minimum bytes, hidden or visible, and file type from the
  probed `content-type`.
- **Persistence.** Filters are kept per site in `chrome.storage`.
- **Grouping:** by size (today), by section (nearest heading), by list item (one product, its photos)
  and by domain.
- **Exports:**
  - copy URLs;
  - **save to Data** as a manifest table (`src`, `fullSrc`, `page`, `alt`, `caption`, `width`,
    `height`, `bytes`, `type`, `file`), so images join the rest of the toolkit (CSV, JSON, Sheets);
  - export the manifest beside the zip as `manifest.csv`.

### G5: dedupe, convert, resize

- **Dedupe.**
  - URL variants fold before probing (the same path with a different size query, or a CDN rewrite
    match).
  - After fetching, a 64-bit dHash on an 8×9 thumbnail (OffscreenCanvas) marks visually identical
    images, and the set keeps the largest. It is on by default, with "show duplicates" to review.
- **Convert.**
  - WebP/AVIF/SVG → PNG/JPG (with a quality setting), using `createImageBitmap` and
    `OffscreenCanvas.convertToBlob`.
  - It runs in an offscreen document or a worker so the panel stays responsive. The image never leaves
    the device.
- **Resize** to a maximum edge, and **strip metadata** (re-encoding drops EXIF). There is also a "keep
  EXIF" option, which copies the original bytes as they are.
- **Animated GIF/WebP** are never converted to a still without a warning.

### G6: many pages and tabs

- **Sources of pages:** all open tabs in the window; a pasted URL list; "follow pagination" (reuses the
  List Extractor's Navigation step); a gallery's "next" button.
- **Runs.** These go through `background/runs/JobRunner` + `TabPool`, the same as bulk scrapes, so they
  get background execution, resume, rate limits and the Runs page. A new job kind, `images`, saves its
  manifest to Data and files to the folder.
- **Click-through galleries.** An optional "open each thumbnail" step clicks, waits for the lightbox
  image, records it and closes. It is opt-in, has a per-site step limit, and uses the existing
  interaction recorder's action model.
- **Rerun:** save as a recipe (`kind: 'images'`: filters, full-size rules, naming, pages). A rerun
  downloads only images not in the previous manifest, matched by URL and hash.

### G7: on-device understanding (with #29)

- **Alt text and captions** for images that have none, from the Prompt API's image input through the
  model host's queue and budget. They are written to the manifest and usable in `{alt}` names.
- **Tags and filters in plain words** ("only product photos", "no people", "screenshots"). Each image
  gets one constrained classification call (`responseConstraint` enum), cached by hash.
- **"Like this one":** group by dHash distance, and by model tags where available.
- **No model:** everything above is hidden, nothing else changes. All of it is optional and fails open.

## 5. Order, size, risk

| Phase | Size | Main risk |
|---|---|---|
| G0 tests | S | None. It makes the rest measurable |
| G1 scanner | M | Performance on huge pages: measure on the corpus (Amazon, Walmart search) |
| G2 fetch/save | M | The transport choice (§6, decision 2); the folder-vs-zip default |
| G3 full size | M | Rewrite rules rot; each is guarded by a probe and a unit test |
| G4 panel | M | Scope creep. Ship the theme, lightbox, sort and exports first |
| G5 dedupe/convert | S–M | Encoding cost on big sets: worker or offscreen |
| G6 many pages | M | Click-through is fragile; ship it behind opt-in |
| G7 AI | S | Depends on the model host and Prompt API image input (#29, #21) |

## 6. Open decisions

1. **Resolved (G2): page-context fallback, no new permission.** The side panel fetches directly (host
   permission, cookies); on a block, login, network error or HTML answer, the page fetches it (its
   `Referer` and session). Add DNR only if real sites still fail. Was: **The `Referer` and cookies route.** Page-context fetch covers most cases with no new permission.
   Hotlink rules for the background need `declarativeNetRequestWithHostAccess`, a new permission
   (no extra install warning, given the host access we already request). Recommendation: page-context
   first; add DNR only if G0 shows real sites still failing.
2. **Resolved (G2): no transport for the common case.** The side panel fetches the bytes itself; only the
   page fallback passes a data URL (up to 64 MB). Was: **The byte transport:** the content script saves files itself, or chunked base64 over a port.
   Recommendation: decide from G0's measurements.
3. **Resolved (G2): `fflate`**, and JSZip and file-saver are gone. Was: **`fflate` for a streamed zip** in place of JSZip, which is a new dependency. The data export's zip
   could move to it too, leaving one zip library.
4. **Default output:** a zip or a folder, and the size threshold for switching.
5. **Whether video is in scope** (posters only today). Recommendation: no direct video download, given
   DRM and streaming formats. Keep posters and GIF/WebP animations.

## 7. Non-goals

- Bypassing paywalls, DRM or login. Only images the signed-in user can already see are fetched.
- Server-side processing. Everything runs in the browser, and images never leave the device.
- Desktop-app features (watch folders, scheduled crawls outside Chrome) beyond what the job runner
  already offers.

## 8. Progress

| Phase | Status |
|---|---|
| G0 | Done: `e2e/site/gallery.html` + generated images in the harness, `e2e/images.spec.ts` (quick, deep, sizes, Amazon timing), `collect.test.ts`. The `Referer`/cookie/slow routes move to G2, which they test |
| G1 | Done: `content/services/images/` (`source.ts`, `collect.ts`, `session.ts`), `shared/images/`. Not done: cross-origin iframes (needs on-demand frame injection), grouping by list item (moved to G4) |
| G2 | Done: `sidepanel/services/images/` (`fetchImage`, `pool`, `zip`, `naming`, `save`), `shared/images/sniff.ts`, `FETCH_IMAGE` in the content script, `useImageSave`, `SaveOptions`, `SaveReportCard`; the downloader opens in its own tab (`?view=image-downloader&tabId=`). JSZip and file-saver removed. Not measured: memory on a 2,000-image run (the zip spills to Blobs every 16 MB; needs a large real-bytes fixture) |
| G3 | Done: `shared/images/fullsize.ts` (16 rules: Shopify, WordPress, Cloudinary, Amazon, Wix, Squarespace, Pinterest, Twitter, Etsy, eBay, Flickr, Google, YouTube, Medium, Gravatar, generic size parameters), `shared/images/dimensions.ts`, `probe.ts`, `fullSize.ts`, `useFullSize`; HD badge, a toggle, saves fall back to the shown file. Not done: probing originals that only the page may fetch (hotlink-protected originals are not upgraded); click-to-open lightboxes stay in G6 |
| G4 | Not started |
| G5 | Not started |
| G6 | Not started |
| G7 | Not started |
