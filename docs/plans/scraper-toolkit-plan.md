# CrawlPilot: scraper toolkit plan (fixes, improvements, new features)

**Status:** proposed · **Date:** 2026-10-17 · **Branch base:** `main` @ `a9355a8` (release 2.0.0)

**Goal:** make CrawlPilot the tool a person keeps open while building or running scrapers. It already
extracts data from pages. It should also answer the questions you ask before writing a scraper and after
one breaks: where the data lives, what blocks you, which selector will last, and why a run came back empty.

**Hard rule: no integration with thenos.** No API calls, no shared packages, no accounts. thenos is used
only as a source of ideas that were already tested on real sites. Everything below is reimplemented in
TypeScript inside the extension. The thenos packages we borrow ideas from (`recipes`, `markdown`,
`crawler`, `scraper`, `recipes-spi`) are Apache-2.0. Ideas from AGPL packages (`selector-agent`,
`browser-tools`) are design-only: copy behaviour, never code.

---

## 1. Where things stand

thenos's recipe studio plan (`thenos/docs/plans/recipe-studio-plan.md` §2) lists CrawlPilot as its
reference for the picker, container detection, selector generation, pagination and the list → detail flow.
In those areas the extension already leads. Since then, thenos has built the next layer on top of them:

| Area | CrawlPilot today | thenos added |
|---|---|---|
| Selector stability | `isUnstableClass` / hash rules in `src/shared/selectors/stability.ts` | The same rules as a data table (`selector_rules.json`), plus CSS-module shapes (`Button__root___1a2b3`), `price_x7f2a`-style tokens, mixed-case build tokens, state attributes, GUID-like ids |
| Selector fallback | `resolve.ts` walks a chain | Candidates with *evidence families* (id, label, data attr, structure, text), graded, verified on samples |
| Broken selectors | Re-run returns empty rows | Element **fingerprints** captured at pick time; relocation by shape when the selector misses, accepted only with a clear margin (`recipes/fingerprint.py`) |
| Field values | Mostly raw text | Typed fields (money + currency, number, date, URL, rating, boolean, enum) with transform chains (`recipes/transforms/*`) |
| Page verdicts | None (`captcha`, `429`, `robots` appear nowhere in `src/`) | `blocked`, `challenge`, `needs_js`, `empty_shell`, `soft_404`, `wrong_geo`, `waiting_room`, `rate_limited` (`scraper/detect.py`), bot-manager detection |
| Where data lives | DOM only (JSON-LD/OG read only by the Metadata extractor) | Network JSON index, embedded state, structured data, value-first JSON picker (`recipes/network.py`, `json_index/`) |
| Listing output | Rows | `ListingResult`: per-page rows / new / duplicates, `stop_reason`, `truncated`, `dedupe_by` (`docs/reference/retail-listing-contract.md`) |
| Discovery | URLs pasted by hand into Page Extractor | Sitemap, robots, feeds, canonical URLs, scope, soft-404 (`crawler/*`) |
| Markdown | Readability + turndown | Main-content pruning, tables, BM25 query filtering, outline (`markdown/*`) |

## 2. Gaps and fixes in the current extension

Things to fix before adding features. Each one was checked in the code.

| # | Gap | Evidence | Fix |
|---|---|---|---|
| G1 | ~~Console noise on every page~~ **Not a gap**: the production build strips all `console.*` (terser `drop_console`), and the controller must stay eager because `checkAutoResume()` resumes pagination after navigation | `vite.config.ts` | None. Revisit on-demand injection only together with the permission banner |
| G2 | Bulk and metadata runs can't tell a block page from real data, so CAPTCHA, 403 and 429 pages are saved as empty or junk rows | No detection code in `BulkExtractionOrchestrator.ts` | Add a `classifyPage()` verdict to every extraction (§3.6). Stop or back off per domain on `blocked` / `rate_limited`, and show the verdict for each row **Done (P1)** for bulk + metadata runs |
| G3 | Politeness is per worker only: `requestDelay` + jitter exist, but N tabs on one site run N× faster, and nothing backs off on 429 | `BulkExtractionOrchestrator.processUrl` | **Done (P1):** per-site minimum gap across all tabs, exponential per-host backoff on `rate_limited` / `waiting_room` with requeue. robots.txt warning moves to Recon (§3.1) |
| G4 | Stability rules miss newer generated-class shapes | Compare `stability.ts` with thenos `selector_rules.json` | Move the rules to `src/shared/selectors/rules.json` and add the missing shapes, each with a test |
| G5 | A re-run silently returns fewer or zero rows when the site changed | No fingerprints are stored; `HistoryPage` re-runs the config snapshot as-is | Store fingerprints at pick time. Report "N fields missed", then propose a fix (§3.5) |
| G6 | Columns are plain strings, so price, rating and date exports need cleanup elsewhere | `DataExtractor` / `SchemaGenerator` output | Add type detection and normalisation (§3.4) |
| G7 | Shadow DOM and same-origin iframes are mostly unsupported | `shadowRoot` and `iframe` each appear in only one file | Make the picker and resolver go into open shadow roots, and same-origin frames through `all_frames` on demand |
| G8 | Recipes can't be taken out of the extension or shared: they live only in IndexedDB `recipes`, with no versioned schema | `db-manager.ts` `createRecipe` | A versioned recipe file format with import and export (§3.7) |
| G9 | Few tests, and none against real page HTML | 6 `*.test.ts` files | Golden fixtures: save real listing pages (Amazon, Walmart, a Shopify store, a docs site) and assert the container, item selector, columns and next button on each |
| G10 | The README is out of date ("Ultimate Web Scraper", an old roadmap) | `README.md` | Rewrite it for the current feature set and the dev setup |

## 3. New features

Ordered by how much they help someone who scrapes for a living. Each one runs locally, needs no account
and calls no server.

### 3.1 Page Recon: "how should I scrape this page?"

A side-panel page that reads the current tab and reports:
- **Rendering:** is the content in the HTML that was served, or added later by JS? Compare
  `document.documentElement.outerHTML` at load with a fetch of the same URL (the `needs_js` /
  `empty_shell` heuristics: empty `#root`/`#__next`, visible text under 200 characters, `<noscript>`
  asking for JavaScript).
- **Embedded data:** JSON-LD blocks (with their `@type`), microdata, OpenGraph, `__NEXT_DATA__`,
  `__NUXT__`, `window.__INITIAL_STATE__`, `__APOLLO_STATE__`. Each can be opened and copied as JSON.
- **Bot protection seen:** Cloudflare (`cf-chl`, `__cf_bm`), Akamai (`_abck`, `bm_sz`), PerimeterX
  (`_px`), DataDome, Kasada, Imperva, and CAPTCHA widgets (reCAPTCHA, hCaptcha, Turnstile, Arkose). Read
  from cookies, scripts and markup. The page only reports what it found and suggests nothing for
  getting around it (§5).
- **Discovery:** canonical URL, hreflang, robots.txt rules for this path, sitemap URLs (from robots
  and `/sitemap.xml`), RSS/Atom feeds.
- **Pagination type:** next link, `?page=` pattern, load-more button, infinite scroll. The existing
  `NextButtonSelector` / `PaginationSelectorGenerator` already detect these, so this only surfaces them.
- **Recommendation:** one plain sentence, for example "Products are in `__NEXT_DATA__` → a plain HTTP
  request is enough, no browser needed" or "Rendered by JS behind Akamai → needs a real browser".

### 3.2 API finder (network capture + value-first picker)

Usually the best scraper skips the DOM and calls the JSON API the page itself uses.
- A MAIN-world script records `fetch`/`XHR` JSON responses for the tab while recording is on. Use
  `chrome.debugger` only if the user turns it on, because it shows a warning bar and needs a new
  permission.
- **Value-first search:** the user clicks a value on the page (or types one), and the panel lists every
  captured response that contains it, with the JSON path (`data.products[3].price.value`) and the path
  that generalises to every item (`data.products[*].price.value`).
- **Export a request** as cURL, Python `requests`/`httpx`, Node `fetch` or Scrapy `Request`, with the
  method, headers, body and the query parameters that look like pagination (`page`, `offset`,
  `cursor`). Cookies and auth headers are left out by default and only added after a per-export
  confirmation.
- Bonus: "Extract from this API" turns the generalised paths into a table, using the existing DataTable
  and exporters.

### 3.3 Selector Lab

A tool for testing selectors on the live page, separate from the extract wizards:
- Type CSS or XPath and see the match count right away, with matches highlighted (reuse
  `SelectionHighlightManager`).
- A **stability grade** for each selector, in plain words (from the thenos studio's wording):
  **Strong** / **Fragile** / **Broken**, plus one sentence of reason ("relies only on utility classes",
  "contains a position index", "id looks generated").
- **Alternatives:** for the picked element, list one candidate from each evidence family (id, data
  attribute / test id, ARIA label, text anchor, structural path), each with its own grade and match
  count.
- **Copy as code** for Playwright, Puppeteer, Selenium, Scrapy (`response.css`), BeautifulSoup and
  Cheerio.

### 3.4 Typed fields and normalisation

In List and Page Extractor review steps:
- Detect each column's type from all its values: money (amount + currency, ranges, "was" prices),
  integer, decimal (locale-aware `1.234,56`), percentage, rating ("4.5 out of 5"), count ("10K+"),
  date (absolute and relative), URL (made absolute, tracking parameters removed), boolean, enum.
- Show a type badge on each column, and a transform chain the user can edit (trim, regex extract,
  replace, split, parse number, parse money, parse date, absolute URL) with **before → after** on
  sample rows.
- Exports keep both: `price` (normalised) and `price_raw`. JSON exports money as `{amount, currency}`.
- Port the parsers from the ideas in thenos `transforms/money.py`, `numbers.py`, `dates.py`,
  `units.py` and `urls.py`. Unit tests use the same tricky inputs.

### 3.5 Selector health and self-heal on re-run

- At pick time, store an **element fingerprint** for each field: tag, stable attributes, stable
  classes, the shape of its ancestors, its role or accessible name, and the shape of its value (not the
  value itself).
- On a re-run, if a field's selector chain matches nothing, score the elements in the item container
  against the fingerprint. Accept a match only when it scores above a threshold **and** clearly beats
  the next best. Never pick between two close matches.
- Use a relocated value for that run, and **propose** the new selector ("Price moved; use
  `[data-test=price]`? Apply / Ignore"). Never change the recipe silently.
- Run report: a hit rate for each field over the last N runs, and a warning when a field relies on only
  one fragile selector.

### 3.6 Run quality and verdicts

- `classifyPage()` gives every visited page in bulk, pagination and metadata runs a verdict: `ok`,
  `blocked`, `challenge`, `rate_limited`, `soft_404`, `login_wall`, `empty`, `waiting_room`.
- Policies: on `challenge`, pause and bring the tab forward so the user can solve it by hand, then
  resume. On `rate_limited`, back off that domain. On `soft_404`, skip the page.
- For each listing run, show per-page stats like thenos's `ListingResult`: rows, new rows, duplicates,
  and the **stop reason** (no next button, repeated content, page limit reached, blocked, user stopped).
  Use a dedupe key (the URL by default, or any column the user picks).
- History shows the verdict counts for each run, so "why did run #12 get 0 rows?" has an answer.

### 3.7 Portable recipes and code export

- `crawlpilot.recipe/1` JSON: the URL pattern, list container and item selectors with fallback chains,
  fields (chain, type, transforms, fingerprint), pagination spec, detail-page spec, and run options.
  The fields are versioned and validated on import.
- Import and export recipe files. Upgrade the configs already saved in IndexedDB to this format
  automatically.
- **Export as a scraper**: generate a starter Playwright (TS/Python) script or a Scrapy spider from
  the recipe, including its pagination loop and field transforms. This gives a user a head start on
  their own pipeline without any service in between.

### 3.8 Schema-first output

- Let the user give the output shape as a JSON Schema, a sample JSON object or a preset (start with a
  **retail listing item** preset based on thenos's `retail.listing_item@1` fields: `position`, `title`,
  `url`, `price`, `list_price`, `rating`, `reviews_count`, `sponsored`, `badges` …).
- Auto-map the detected columns to the schema fields by name and type, list required fields that have
  no match, and export JSON shaped to the schema.

### 3.9 Site map / URL discovery for Page Extractor

- From the current site, collect URLs from robots → sitemaps (including sitemap indexes and `.xml.gz`),
  RSS feeds, and the links on the current page.
- Canonicalise them (drop fragments and tracking parameters, normalise trailing slashes), filter by
  include/exclude glob and same-host scope, and group them by path pattern (`/product/*`, `/blog/*`).
- Send the selected group straight into Page Extractor Step 1, which now only takes URLs pasted by hand.

### 3.10 Change monitor

- Schedule any saved recipe (hourly, daily or weekly) with `chrome.alarms`. It runs in the TabPool's
  background tabs.
- Compare each run with the last snapshot by dedupe key: added, removed and changed rows, with a
  per-field diff (for example "price 49.99 → 44.99").
- A Chrome notification when something matches a rule ("any price dropped", "new rows"). History keeps
  the snapshots. Note: it only runs while Chrome is open, and the UI must say so.

### 3.11 LLM-ready page export

- Improve page → Markdown: prune boilerplate before Readability, convert tables to GFM, keep link
  references as numbered citations, and add an optional "only sections about X" filter (BM25 over
  sections, an idea from `markdown/query.py`).
- Batch mode over the URLs from Page Extractor, written to one `.md` per page or one JSONL file.

### 3.12 Session export for logged-in scraping

- Export the current site's cookies and localStorage as a Playwright `storageState` JSON, or as a
  `Cookie:` header / Netscape `cookies.txt`.
- Show the request fingerprint a scraper needs to match: User-Agent, client hints, Accept-Language,
  time zone.
- This is sensitive. It only runs when the user clicks it, never syncs, shows a clear warning, and
  needs the `cookies` permission requested as an optional permission through the existing banner flow.

### 3.13 AI extraction from a schema (Chrome built-in model, on-device)

The user describes the output they want, and Gemini Nano (Chrome's on-device model) fills it in from the
page. No data leaves the browser. The extension already has the plumbing:
- `src/sidepanel/services/ai/promptSession.ts`: `getLanguageModel()`, availability states, download
  progress, and `docCharBudget()` built on `inputQuota`.
- `useChatSession.ts`: already sends `responseConstraint` (the JSON-Schema-constrained output that
  `SUGGESTIONS_SCHEMA` uses).
- `chunking.ts`: boundary-aware truncation and splitting.

This feature reuses all of it. It adds no new permission and no network access.

**Core principle: the LLM runs once, and selectors take over after that.** The model is small, slow
(~5–10 s per call) and has a small context window, so it is used to *author* an extraction, not to *run*
one. Every value it returns has to point to an element on the page. Those elements become an ordinary
CrawlPilot recipe with selectors, so pagination, bulk runs, re-runs and monitors need no model at all.
This follows thenos's zero-LLM runtime rule (`docs/plans/recipe-registry-plan.md`, "contract v3,
zero-LLM runtime").

**Flow:**

1. **Schema intake** (shared with §3.8). The user gives one of:
   - a JSON Schema;
   - a sample JSON object (its types are inferred into a schema);
   - a list of fields with a short description each ("price: the current selling price");
   - a preset (retail listing item, product detail, article, job posting, contact).

   The user also chooses **one record** (a detail page) or **a list of records** (a listing).

2. **Structured data first, no model.** Before calling the model, try to fill the schema from the
   page's JSON-LD, microdata, OpenGraph and embedded state (§3.1 Recon) by matching names and types.
   Fields filled this way are marked "from page data" and never reach the model.

3. **Shrink the page.** Nano cannot read raw HTML, so build a compact, referenced view:
   - Pruned main content (§3.11) written as lines with element refs, for example
     `[e41] $49.99` and `[e42] Was $59.99`. Each ref maps to a live element, kept in a `Map` in the
     content script.
   - Keep headings, label → value pairs (`dt/dd`, table rows, `label: value` text), and the text of
     buttons, links and images (alt text). Drop navigation, footer and repeated boilerplate.
   - **List mode:** find the item container with the existing `GroupParentContainerDetector` /
     `FingerprintContainerDetector`, then send only **2–3 sample items**, each as its own referenced
     block. Never send the whole list.
   - Fit the budget with `measureInputUsage()` when it exists, otherwise `docCharBudget()`. If the
     view is still too big, run it in chunks (each chunk fills what it can) and merge, with the first
     non-null value winning.

4. **Constrained prompt.** Build a *wrapped* response schema from the user's schema. Each field
   becomes `{ value, ref }`: `ref` is the `e##` id the value was read from, or null. Make every
   property required and nullable, with `additionalProperties: false`, so the model cannot invent keys
   or leave fields out. Call `session.prompt(view, { responseConstraint: wrapped })`. Use a short
   system prompt: "copy values exactly as written; use null when the page does not show it; never
   compute or guess". Use `omitResponseConstraintInput` if the Chrome build supports it, to save
   input quota. Keep the existing prose-JSON fallback for older builds, as `useChatSession` already
   does.

5. **Verify every value (never trust the model's output as-is).**
   - **Grounding:** the `value` must appear in the referenced element's text or attribute, after
     whitespace and case are normalised. If it doesn't, search the whole view for it. If it is still
     not found, set it to null and flag the field "not found on page".
   - **Types:** run the §3.4 normalisers (money, number, date, URL, rating). A value that fails its
     schema type is flagged, not coerced.
   - **Schema validation** of the final object, with missing required fields listed.
   - **List mode:** a field has to resolve to *the same relative position* in every sample item. If
     it doesn't, it is flagged as inconsistent.

6. **Compile to selectors.** For each verified ref, generate a selector chain with the existing
   `SelectorGenerator` / `CommonSelectorGenerator`. In list mode the selector is relative to the item.
   Store a §3.5 fingerprint too. Run the chain on the live page: in list mode it must hit in at least
   80% of items. Then show the **same Review step the List and Page Extractors use**, with every
   column already filled in, so the user can edit or re-pick any field with the normal picker.

7. **Save and run.** The result is a normal recipe (§3.7) that can paginate, bulk-run, monitor and be
   exported with no model. **Model fallback** is opt-in per field: if a compiled selector misses on a
   later page, the model may be asked for only that field on only that page. The value goes through
   the same verification, and the run report shows which fields came from the model.

**UX:**
- Entry point: "Extract with a schema", which is a mode of List Extractor and Page Extractor Step 2,
  not a separate tool.
- Each field shows where its value came from: *page data*, *AI + verified selector*, *AI only
  (unverified)* or *not found*.
- Model states reuse the summarizer's banner and download progress (`available`, `downloadable`,
  `downloading`, `unavailable`). If the model is unavailable, the same screen falls back to manual
  mapping (§3.8): the schema is shown and the user picks each field with the picker.
- Abort with `AbortSignal`, and time out each call (60 s). Show a progress row per chunk.

**Code layout (new):**
- `src/shared/schema/` (intake, inference from an example, the wrapping and strict-making of
  schemas, validation).
- `src/content/services/ai-view/` (referenced page view, sample items for lists, `ref → element`
  map).
- `src/sidepanel/services/ai/extractSession.ts` (session creation, constrained prompt, chunk merge),
  next to `promptSession.ts`.
- `src/sidepanel/hooks/useSchemaExtraction.ts` (orchestrates intake → structured-data pass → model
  → verify → compile).

**Evaluation:** use the golden fixtures (G9) plus a hand-labelled expected JSON for each. A
`vitest` suite checks the deterministic parts (view building, wrapping, grounding, compile) with a
stubbed model. A manual `npm run eval:ai` script runs the real model in Chrome and reports, per field,
precision (verified values that are correct) and coverage (fields filled). A hallucinated value that
passes verification counts as a failure.

## 4. Phases

| Phase | Scope | Done when |
|---|---|---|
| **P0 Fixes** | G1, G4, G9 (fixtures harness), G10 | No console noise on page load; the rules table is shared and tested; the golden-fixture suite runs in `npm test` on at least 4 saved pages |
| **P1 Run quality** | G2, G3, §3.6 | A bulk run over a CAPTCHA page records `challenge`, pauses, and resumes after a manual solve; listing runs show per-page stats and a stop reason |
| **P2 Recon + Selector Lab** | §3.1, §3.3, G7 | Recon flags `__NEXT_DATA__` on a Next.js store and Akamai on a protected retailer; the Lab grades selectors and copies Playwright/Scrapy snippets; the picker works inside open shadow roots |
| **P3 API finder** | §3.2 | Clicking a price on a JS-rendered listing finds the XHR that holds it, generalises the path, and exports a working cURL |
| **P4 Typed fields** | §3.4, G6, §3.8 | Money, number, date, rating and URL are detected on the fixture pages with ≥ 95% column accuracy; the retail preset maps an Amazon listing with no required field missing |
| **P5 Recipes + heal** | §3.7, §3.5, G5, G8 | Exported recipes round-trip; a fixture with a renamed class relocates the field and proposes a selector; Playwright/Scrapy export runs on the fixture |
| **P6 Discovery + monitor + export** | §3.9, §3.10, §3.11, §3.12 | Sitemap → Page Extractor works on a docs site; a scheduled run sends a price-drop notification; storageState export loads in Playwright |

| **P7 AI schema extraction** | §3.13 (needs §3.4 normalisers, §3.7 recipe format, §3.8 schema intake) | On 4 fixtures, a product-detail and a retail-listing schema are filled with ≥ 90% field precision and 0 unverified values shown as verified; a list extraction compiles to selectors that hit ≥ 80% of items and then paginates with no model call; with the model unavailable, the same screen falls back to manual mapping |

P0–P1 make what exists trustworthy. P2–P3 are the most visible "scraper's toolkit" wins and are mostly
independent of each other. P4–P5 depend on the recipe format, so they go together.

## 5. Non-goals

- Any call to thenos or another backend. The extension keeps working fully offline.
- Proxies, CAPTCHA solving, fingerprint spoofing or other ways around bot protection. Recon *reports*
  protection but never helps evade it. This also keeps the extension within Chrome Web Store policy.
- An LLM-required flow, or a cloud LLM. The only model is Chrome's on-device one (§3.13). Every
  feature, AI extraction included, falls back to a manual path when the model is unavailable, and
  saved recipes never need it to run.
- A new onboarding flow for permissions. New optional permissions (`cookies`, `debugger`) go through
  the existing side-panel banner.

## 6. Port map (idea source → extension location)

| thenos source (read for behaviour) | Extension target |
|---|---|
| `packages/recipes/src/thenos_recipes/selector_rules.json`, `stability.py`, `quality.py` | `src/shared/selectors/rules.json`, `stability.ts`, new `grade.ts` |
| `packages/recipes/src/thenos_recipes/fingerprint.py` | new `src/shared/selectors/fingerprint.ts` |
| `packages/recipes/src/thenos_recipes/transforms/*` | new `src/shared/transforms/*` |
| `packages/scraper/src/thenos_scraper/detect.py`, `recipes/classify.py` | new `src/content/services/verdict/classifyPage.ts` |
| `packages/recipes/src/thenos_recipes/network.py`, `json_index/` | new `src/content/features/network/*` + `src/shared/json/index.ts` |
| `packages/crawler/src/thenos_crawler/sitemap*.py`, `canonical.py`, `scope.py`, `feeds.py` | new `src/background/discovery/*` |
| `packages/markdown/src/thenos_markdown/main/pruning.py`, `tables.py`, `query.py` | `src/content/readable-extract.ts` |
| `docs/reference/retail-listing-contract.md` | `src/shared/schemas/retail-listing-item.json` |
| `packages/recipes/src/thenos_recipes/listing.py` (stop reasons, page stats) | `PaginationAction.ts`, `BulkExtractionOrchestrator.ts` |
| `packages/recipes/src/thenos_recipes/schema_intake/`, `docs/plans/assist-flow-plan.md` (SC1–SC2 schema intake) | `src/shared/schema/` |
| `packages/markdown` agent mode with refs (`docs/plans/browser-tools-markdown-plan.md`) | `src/content/services/ai-view/` |
| `packages/recipes/src/thenos_recipes/verify.py`, `proof.py` (verify before offering) | grounding + compile in `useSchemaExtraction.ts` |

## 7. Progress (branch `feat/scraper-toolkit`)

| Item | State | Notes |
|---|---|---|
| G1 | Not a gap | See the G1 row |
| G2, G3, §3.6 run quality | **Done** | Bulk + metadata verdicts, challenge pause, backoff, per-site gap; listing dedup, page stats, stop reasons, page checks after navigation |
| G4 stability rules | **Done** | Bootstrap `col-md-*` deliberately kept usable |
| §3.1 Page Recon | **Done** | Toolkit tab |
| §3.3 Selector Lab | **Done** | Toolkit tab |
| §3.2 API Finder | **Done** | Toolkit tab; `public/net-hook.js` |
| §3.4 / G6 typed fields | **Done** in the data viewer | Not yet in the List/Page Extractor review steps |
| §3.9 discovery | **Done** | Page Extractor Step 1 |
| §3.13 AI schema extraction | **Done** for detail pages | List mode (2–3 sample items, item-relative selectors) and the JSON-LD pre-pass are next |
| G10 README | **Done** | |
| G5 / §3.5 fingerprints + heal | Open | |
| G7 shadow DOM / iframes | Open | |
| G8 / §3.7 portable recipes, code export | Open | |
| §3.8 schema-first output mapping | Open | Schema intake exists (`shared/ai/schemaIntake.ts`) and can be reused |
| G9 golden fixtures | Partial | Fixture HTML in `src/test/fixtures/`, no test yet: jsdom has no layout, so the picker's visual paths need a browser runner |
| §3.10 monitor, §3.11 LLM markdown, §3.12 session export | Open | |
| i18n for new UI | Open | New screens are English only |
