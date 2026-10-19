# A simpler, self-guiding side panel

Audited 2026-10-19 on `main` at `46ff154`: every side-panel view screenshotted at side-panel size (400 px wide) on the saved Walmart search page (`src/test/fixtures/corpus/walmart-search.html.gz`), and the code read.

**Goal.** Someone who has never seen CrawlPilot opens the side panel on a page and gets that page's data out with no instructions: they see what CrawlPilot can do *with this page*, press one obvious button, and get a table. Advanced tools stay, one level down.

**Measure of done.** On five common pages (a product listing, a search results page, an article, a product page, a table), a first-time user gets a downloaded CSV:
- in **≤ 3 clicks** after opening the panel, on the default path;
- **without reading a help text** longer than one line;
- seeing **no term from the jargon list** (§3) on that path.

---

## 1. What makes it read like an enterprise tool today

Each finding comes from the screenshots; file pointers are where the fix lands.

### Navigation and structure
1. **Home is a catalogue, not a starting point.** Eight cards of equal weight (List, Toolkit, AI Extract, Summarizer, Page Extractor, Metadata Extractor, Images, Utilities), plus Email Extractor reachable only by URL. The user has to know which tool fits their job. Nothing on Home refers to the page they're looking at. The developer-oriented Scraper Toolkit is the 2nd card. (`pages/HomePage.tsx`, 487 lines of hand-repeated cards.)
2. **Three navigation systems at once.** The global pill nav (Home / Runs / Data), each tool's back arrow, and Home's footer buttons (Recent Runs / Saved Data) repeat each other. The pill keeps "Home" highlighted inside every tool. (`components/ui/Header.tsx`, `HomePage.tsx`.)
3. **Chrome eats the panel.** Global header plus tool header take ~205 of 860 px before any content, about a quarter of a laptop-height panel.
4. **Steppers without words.** The List and Page Extractor wizards show three dots with no labels, so the user can't tell what's next or how long it is. (`components/wizard/WizardLayout.tsx`.)
5. **Two tools with the same first screen.** Page Extractor and Metadata Extractor both open on "Pages to Scrape: Upload CSV / Select Data Source / Discover from this site". The obvious source, *links on this page*, isn't offered first. "Next step" is greyed out with no reason given.
6. **"Runs" and "Data" are two places for one thing.** Users think "my scrapes", not jobs and datasets.

### Language
7. **Engineering vocabulary** on main paths: Runs, Job History, Data Source, Page Extractor vs Metadata Extractor, Crawl speed *Careful / Balanced / Aggressive*, selectors, JSON-LD and microdata (in AI Extract's warning), PRO integrations, "Extension not connected to this tab".
8. **Shouting and system tone.** "NO JOBS FOUND" in caps; status filters with all-zero counts (Running 0, Completed 0, Stopped 0) before anything has run. AI Extract opens with a 6-line hardware notice (Chrome 138, GPU VRAM, `chrome://on-device-internals`) above the fold.
9. **Inconsistent naming.** "Crawl Pilot" in the header, "CrawlPilot" on Welcome.

### Visual
10. **A "mission control" look.** Near-black background (`#030712`), cyan *and* amber *and* violet accents, glows, gradient headers, a different colour per tool, and 24–36 px radii from `theme.shape.borderRadius = 12` multiplied by component values. The marketing site moved to the light **Daylight** style (2026-07); the extension still looks like the old dev-tool site.
11. **Type too small.** Captions are 0.68 rem (≈ 11 px) slate `#64748B` on near-black, used for most explanations. It's hard to read, and at the AA contrast limit.
12. **Icon-only toolbars.** Image Downloader's header has four unlabelled icon buttons; the data table's actions are similar.

### What already works (keep it)
- The Scraper Toolkit pattern (`components/toolkit/`): a page strip showing what the tool works on, a one-screen intro with one button, numbered steps, next-step buttons into other tools, details folded away.
- List Extractor step 1: one button, then it finds the pattern by itself.
- The connection banner as *the* place for permissions. Per the earlier decision, no new onboarding pages; fix the banner's words, don't add flows.

---

## 2. Design principles

1. **Start from the page.** The panel's first screen is about the open tab: what's on it, and what you can take from it.
2. **One primary action per screen**, at the bottom where the thumb and eye land, always enabled or saying why not.
3. **Smart defaults, settings later.** Detect pagination, speed and field names; show them as editable defaults, never as required choices.
4. **Plain words.** Say what the user gets ("Get all 40 products"), not what the system does ("Start Extraction").
5. **Progressive disclosure.** Advanced tools and options are one tap away, never in the way.
6. **One look.** One accent colour, neutral surfaces, readable type, the same page shell in every tool.

---

## 3. Words: the glossary to apply everywhere

| Today | Becomes | Note |
|---|---|---|
| Runs / Job History / Data | **My data** | one place: each saved table with its run status inside |
| Extract a List | **Get a list from this page** | |
| Page Extractor | **Same details from many pages** | |
| Metadata Extractor | merged into the above as a preset: *Article text & metadata* | §4.4 |
| Select on Page | **Point at one item** | |
| Data Source | **A list you saved** | |
| Crawl speed: Careful / Balanced / Aggressive | **Speed: Gentle (recommended) / Normal / Fast** | plus one line on why gentle avoids blocks |
| Start Extraction | **Get all N items** (count when known) | |
| Open Results Table | **See your table** | |
| Extension not connected to this tab · Connect | **CrawlPilot needs to see this page · Allow** | same banner, same `connectTab` |
| NO JOBS FOUND | **Nothing saved yet**, plus a button back to the page | sentence case everywhere |
| Selector, JSON-LD, microdata, API | only inside Scraper Toolkit and "Advanced" sections | |
| Crawl Pilot / CrawlPilot | **CrawlPilot** | one spelling |

All strings go through i18n (`src/i18n/locales/en/*.json`). Other locales keep falling back to English until translated.

---

## 4. The changes

### 4.1 Shell and navigation (S)
- **One header:** logo, a page-aware title, and a menu with My data, Settings, Help. Drop the pill nav and Home's footer buttons. Inside a tool, the header becomes **back + tool name**; steps sit under it as **labelled** steps ("1 Pick · 2 Pages · 3 Get data").
- **A shared `ToolPage` shell** (header, page strip, scroll area, sticky action bar), generalised from `ToolkitPage` and `components/toolkit/ui.tsx`. Every tool uses it in place of its own hand-styled header.
- **Target:** ≤ 110 px of chrome above content.

### 4.2 Home becomes "This page" (M)
- **Top:** the page strip (icon, title, host) from the toolkit.
- **Then one suggestion, from cheap detection on open:**
  - a list found (`findListInside` on `main`/`body`, `keepItems`) → **"40 products found · Get them as a table"**;
  - an article (readability length, JSON-LD `Article`) → **"Save this article · Summarize it"**;
  - a product page (JSON-LD `Product`) → **"Get this product's details"**;
  - nothing recognised → **"Point at what you want"**, which starts the picker.
- **Then four intents as large tiles:** *A list* · *This page's details* · *Images* · *Summarize & ask*.
- **Then "More tools"** (collapsed): Same details from many pages, Scraper Toolkit, Utilities, Email finder.
- **Recent:** the last 3 saved tables, one tap to open. This replaces the footer buttons.
- **Code:** `HomePage.tsx` becomes data-driven: one `TOOLS` array rendered by one card component, instead of eight copied cards. Detection runs through one content message (`PAGE_SUMMARY`) built from `items.ts`, `ReconService.collectEmbedded` and `detectPagination`, with a time budget (≤ 50 ms, see `performance-plan.md`).

### 4.3 List extraction: the happy path in one screen (M)
- **After "Point at one item":** show the preview table at once (first 5 rows, field names already chosen), with pagination **auto-detected and shown as a sentence**: "Will follow *Next* through up to 20 pages · change". One button: **Get all N items**.
- **Steps 2 and 3 stay, as "Change how pages load" and "Settings"** sheets reached from that sentence. The three-step wizard becomes the advanced path, not the required one.
- **While it runs:** "Page 3 of ~12 · 96 items so far", Stop, and the table filling in live. When done: **See your table / Download CSV** in one bar.
- **Field editing on the preview:** rename the column header in place, remove with ×, "+ Add a field" opens the picker. No separate field list.

### 4.4 Many pages: one tool instead of two (M)
- **Merge Page Extractor and Metadata Extractor** into *Same details from many pages*.
- **Step 1 "Which pages?"** offers sources in this order: links from the list you just got, links on this page, the site's sitemap, paste or upload. The "Next" button says what's missing ("Add at least one page").
- **Step 2 "Which details?"** offers two presets (*Article text & metadata*, *Product details*) or *Point at fields on one page*.
- **Code:** the existing `PageExtractorPage` and `MetadataExtractorPage` run logic stays; only the entry and step 1 merge.

### 4.5 My data (M)
- **Merge History and the data table list:** cards per saved table (name, source site, rows, when, status badge if running or failed) with **Open**, **Download**, **Run again**.
- **The empty state** invites a first scrape and links back to the page.
- **The data table page:** label every toolbar action. Export becomes one **Download** button (CSV default, menu for JSON / Markdown). Integrations go under "Send to…".

### 4.6 Copy, empty states and errors (S)
- Apply the glossary (§3).
- **AI Extract without the on-device model:** one line ("On-device AI isn't available in this Chrome. CrawlPilot will fill what the page publishes.") with a "Why?" link for the hardware details.
- **Errors in user terms, with a next step:** "This page blocks automated reading. Try Gentle speed, or open the page and scroll first."
- **Settings:** language, storage (show usage only, with the clean-up in a menu), integrations; the PRO upsell becomes a single row, not a warning box.

### 4.7 Visual refresh (M, depends on decision D1)
- **Tokens** in `theme/muiTheme.ts`: one accent (brand amber for marks, near-black or white for the primary button, as on the site), neutral surfaces, `shape.borderRadius: 8` with components using 1–1.5 (8–12 px), no glows or gradients.
- **Type scale:** body 13 px, secondary 12 px, smallest 11 px only for metadata. Secondary text at ≥ 4.5:1 contrast.
- **Tool icons** in one neutral colour; tool identity from words, not colour.
- **Light theme** to match Daylight (if D1 = light), with dark kept as a setting. Tailwind classes in `index.css` and MUI must share the same tokens.

### 4.8 Help without new pages (S)
- A one-line hint under each primary action, and "?" tooltips on the few advanced terms that remain.
- **Welcome** (`WelcomePage.tsx`, first run only) shows the same four intents as Home and one button, "Try it on this page". No new onboarding screens; permissions stay in the banner.

---

## 5. Phases

| Phase | Contents | Size | Ships |
|---|---|---|---|
| **U0** | Glossary + copy pass (§3, §4.6), sentence-case empty states, one brand spelling | S | alone; no layout change |
| **U1** | `ToolPage` shell, single header, labelled steps (§4.1); all tools moved onto it | S–M | after U0 |
| **U2** | Home "This page" with detection and intents; data-driven tool list (§4.2) | M | after U1 |
| **U3** | List happy path: preview + auto pagination + one button (§4.3) | M | after U1 |
| **U4** | My data (§4.5) | M | after U1 |
| **U5** | Many pages merge (§4.4) | M | after U1 |
| **U6** | Visual refresh (§4.7) | M | any time after U1; touches every screen |
| **U7** | Usability check against the measure of done; fix what it finds | S | last |

U0 and U1 make the panel feel simpler at once. U2 and U3 deliver the "self-navigable" part.

**Status (2026-10-19):** U0, U1, U2 and U3 done. U3: after the first pick the list's Next / "Load more" control is found on the page (`src/content/services/pagination/findNext.ts`, `FIND_NEXT`; carousel arrows and disabled controls ignored), the pick shows a 3-row preview, the pages as a sentence and one button (`components/list-extractor/QuickRun.tsx`); the preview no longer opens a pop-up window; a finished run says what it got and opens its own table (e2e `e2e/list-quick.spec.ts`). The page check is `src/content/services/pageSummary.ts` (`PAGE_SUMMARY`), 1–60 ms on the corpus pages in jsdom; e2e in `e2e/home.spec.ts`; screenshots with `UX_SHOTS=<dir> npx playwright test e2e/ux-shots.spec.ts`. Known miss: the Amazon product capture (no buy box) reads as a list of its related items.

## 6. How we'll know

- **Path checks:** an e2e test per page type in `e2e/` (like `e2e/toolkit.spec.ts`) asserting the default path: open → suggestion visible → one click → table preview → one click → CSV. It also counts clicks.
- **Screenshot review:** the audit spec used for this plan (every view at 400 px on corpus pages) kept as `e2e/ux-shots.spec.ts` behind `UX_SHOTS=<dir>`, run before and after each phase.
- **Five first-time users:** short sessions, one task each from the measure of done, watching for hesitation and wrong turns.

## 7. Decisions needed

- **D1 Theme:** move the extension to the light Daylight look (dark as a setting), or keep it dark and only simplify colours and type? *Recommendation: light by default, to match the website and lose the console feel.*
- **D2 Tools to demote:** Scraper Toolkit, Utilities and Email finder under "More tools"? *Recommendation: yes; they're for a minority and clutter the first screen.*
- **D3 Merge Page + Metadata Extractor** into one "many pages" tool with presets? *Recommendation: yes.*
- **D4 "My data"** replacing both Runs and Data? *Recommendation: yes.*

## 8. Out of scope

- Extraction logic, selectors and run engine: only their entry points and wording change.
- New onboarding pages or install-time tabs (rejected before; the banner stays the permission flow).
- Translating the new strings beyond English (fallbacks as today).
