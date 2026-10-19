# Automation, page tools and developer aids

Status: T1 done (2026-10-19). All decisions made (§9). The other steps are GitHub issues #38–#49. Next: T2 (Markdown).

This plan adds 12 features in three groups:

- **Repeated runs and monitoring:** a saved run reruns on a schedule; what changed is shown and
  notified; rows go to a webhook.
- **Page tools:**
  - tables to CSV;
  - a full-page screenshot of this page;
  - the page as clean markdown;
  - a structured data viewer;
  - a "load everything" step.
- **Developer aids:**
  - request to code;
  - cookie export;
  - a recipe as a Playwright or Puppeteer script;
  - an anti-bot check.

Several of them are mostly built already. §2 says what exists, so each step builds only what's missing.

## 1. What the user gets

- **"Tell me when the price drops."**
  - The user runs the List Extractor on a category page once, then clicks **Watch**: every 6 hours, price and stock.
  - CrawlPilot reruns it in a background tab, even on a logged-in page, compares it with the last run and sends a notification: "3 prices changed, 2 new products". History shows each change as old → new.
  - The rows can also go to a webhook (Zapier, n8n, Make, their own API) after every run, or only when something changed.
- **"Get me this table."** Every table on the page is listed with a preview, and each one goes to Copy (it pastes straight into Sheets), CSV or My data. Over many pages, the same table is collected from each one.
- **"Save this page."**
  - A full-page PNG of the page.
  - The page as clean markdown, or 200 pages as one `.jsonl` file for an LLM dataset.
- **"What data does this page publish?"** A tree of its JSON-LD, microdata, Open Graph and app state, with search and copy-path. "Use in AI Extract" turns a product entity into a schema.
- **"I want to run this on a server."**
  - A recipe exports as a Playwright or Puppeteer script that produces the same rows.
  - An API call exports as code that pages through every result.
  - Cookies export as `cookies.txt` or a Playwright `storageState`.
  - Recon says whether plain HTTP will work, or whether a bot wall (Cloudflare, DataDome…) is in the way.

## 2. What already exists

| Feature | Already there | Missing |
|---|---|---|
| Scheduled runs | Saved recipes and jobs (`db.jobs`, `Recipe`, `Job`). Bulk kinds (`page`, `metadata`, `contacts`, `api`) run in the service worker through `JobRunner` and `TabPool`. A hidden run tab behaves like a visible one (`public/visible-shim.js`). History reruns a job (`useJobRerun`). The `alarms` permission | **List runs only run from the side panel, in the active tab** (`useJobRerun` → `useExtractionProcess`), so they can't run unattended. Nothing schedules |
| Change monitor | Each run writes its own table (`Job.tableId`). `rowKey` gives row identity. Value parsers (`parsers.ts`) | A diff of two runs, a stored change list, notifications |
| Webhook | Sheets sync is the model to follow (`sheetsSync.ts`): a per-dataset target, rows-sent counter, resume, errors kept on the dataset | The webhook target itself |
| Table extractor | `fields/table.ts` (`tableHeaders`, `tableFields`) for picked tables. `downloadTableCsv`. The data table | A page-wide table finder and its screen. A bulk table job |
| Full-page screenshot | `captureVisibleTab` (used by `ai/vision.ts`, visible part only) | Scroll-and-stitch capture of the whole page |
| Page to Markdown | The markdown engine (`toMarkdown`, `fit` mode, reveal). The metadata extractor already returns `markdown` per page, in bulk | A "this page as markdown" screen with copy and download. `.md`-per-page zip and `.jsonl` export for bulk runs |
| Structured data viewer | `collectStructured` (JSON-LD, microdata, meta). Recon's `collectEmbedded` (app state) and its embedded-JSON list | A tree with search, copy-path and "Use in AI Extract" |
| Load everything | `AutoScrollAction` (infinite scroll, mutation-aware) and `PaginationAction` (load more), inside list runs. `findNext` finds the control | A standalone step other tools can run first |
| Request to code | **Built:** API Finder → cURL, Python requests, JS fetch, Scrapy, with auth headers opt-in and paging params detected (`requestSnippets.ts`) | A script that **pages through** the whole series and writes CSV |
| Cookie export | Nothing. No `cookies` permission | Everything |
| Selector to script | Recipes hold best-first selector chains (`chainOf`, `ListSpec`, `PageSpec`) | The generators |
| Anti-bot check | Recon: page verdict (`classifyPage`: challenge, rate limit, dead), served vs rendered text, `needsJs`, robots.txt, a recommendation (`http-json`, `http-html`, `browser`, `blocked`) | Naming the bot-wall vendor, CAPTCHA kind and rate-limit headers, and a logged-out fetch to show whether sign-in is needed |

## 3. Design

### 3.1 Background list runs (needed by everything in §3.2)

A list recipe must run with no side panel and no active tab, as bulk jobs already do.

- **New run kind: `list` in `JobRunner`.**
  1. Open one tab from the `TabPool`, in the background with the visible shim.
  2. Inject the content script and send the existing list-run command (`content/handlers/listRun.ts`) with `listRunInput(spec, maxPages)`.
  3. Stream rows into the job's table the same way bulk jobs do.
- **Same results as a panel run.** Pagination, infinite scroll and load-more already run inside the content script. The panel only started them and showed progress, and progress already goes out as messages.
- **The panel's own list runs move to this path too.** One way to run a list, not two. The live preview reads the job's progress messages.
- **A bot check during an unattended run** can't wait for the user. The job ends as `needs_you`, with a notification "Open the page to continue". The next scheduled run tries again.

### 3.2 Scheduled runs (monitors)

A **monitor** is a recipe plus when to run it and what to watch.

```ts
interface Monitor {
  id?: number;
  recipeId: number;
  name: string;
  /** Where it runs: the list page, or the URLs of a bulk recipe. */
  urls: string[];
  every: { minutes: number };          // 15 min … 7 days; presets: hourly, every 6 h, daily, weekly
  /** Daily and weekly: the time of day, local. */
  at?: string;                          // "09:00"
  paused: boolean;
  nextAt: number;
  lastJobId?: number;
  watch: WatchRule;                     // §3.3
  notify: 'changes' | 'every-run' | 'never';
  webhook?: WebhookTarget;              // §3.4
  createdAt: number; updatedAt: number;
}
```

- **Storage.** A new IndexedDB store, `monitors` (`DB_VERSION` 8). Each job a monitor starts records `monitorId`.
- **Scheduler** (`background/monitors/scheduler.ts`):
  - **Alarms.** One `chrome.alarms` alarm per monitor (`monitor:<id>`) at `nextAt`, recreated after each run. Alarms survive the worker sleeping. On browser start, every alarm is rebuilt from the store.
  - **Missed runs.** A run missed while the browser was closed or the computer asleep is caught up **once** at start, never once per missed slot. Then the schedule continues from now.
  - **One at a time.** Monitors run one after another; a due monitor waits for the one running. A monitor never runs while the user runs the same recipe by hand.
  - **Politeness.** Each run uses the recipe's pacing (`RunSettings`). A host gets at most one monitor run at a time.
- **Limits, said plainly in the screen:** runs happen only while Chrome is open. For runs when Chrome is closed, the user exports the recipe as a script (§3.11) and schedules it on a server.
- **Screen.**
  - **Watch** button on a finished run (List Extractor result, History row), in a dialog with:
    - how often;
    - what to watch;
    - notify;
    - webhook.
  - A **Monitors** list in History shows next run, last result and changes, with pause, run now, edit and delete.

### 3.3 Change monitor

After each monitor run, the run's table is compared with the last **complete** run of the same monitor.

- **Row identity.**
  - Default: a URL column; else the identifying fields (name, title, sku, id, the same rule as `budget.identityFields`); else `rowKey`.
  - The user can pick the key column in the Watch dialog.
- **What is compared.**
  - The watched columns (default: all).
  - Text is compared after normalising whitespace and case. Numbers are compared after parsing (`$1,299.00` = `1299`), so a format change isn't a change.
- **Output (`shared/monitor/diff.ts`):**

  ```ts
  { added: Row[]; removed: Row[]; changed: { key; field; before; after }[]; unchanged: number }
  ```

  It is stored on the job (`Job.changes`, with at most 500 changes kept, plus counts).
- **No false alarms from a broken run.** A run that ends `failed` or `stopped`, or reads under 50% of the previous run's rows, is not diffed. It is reported as "Run looks incomplete (40 of 120 rows): not compared", and the next good run is compared with the last good one.
- **Rules (`WatchRule`):** any change; new rows; removed rows; a field changed; a number goes below or above a value ("price < 50"); text contains ("In stock").
- **Notifications.** Uses `chrome.notifications` (the `notifications` permission; Chrome shows no install warning for it).
  - Example: one notification per run, "Shoes · 3 prices dropped, 2 new · Lamp $49 → $39".
  - A click opens the run's changes in History.
- **Changes view.** In History, a run of a monitor gets a **Changes** tab: added, removed, and a table of field changes, old → new. "Export changes" downloads them as CSV.
- **A rolling dataset (option, "Keep one table").** Each run updates a single table in place:
  - new rows added;
  - changed rows updated, keeping `_firstSeen` and `_lastSeen`;
  - removed rows marked `_removedAt`.

  This is what Sheets and webhooks sync from, so the sheet shows the current state, not 50 copies.

### 3.4 Webhooks

A dataset or a monitor can have one webhook target, built like the Sheets sync.

```ts
interface WebhookTarget {
  url: string;
  /** What is sent: every new row, or only a monitor run's changes. */
  send: 'rows' | 'changes';
  /** Signs each request: `X-CrawlPilot-Signature: sha256=<hex HMAC of the body>`. */
  secret?: string;
  format: 'json' | 'slack';   // slack: one text message per run (Slack, Discord-compatible)
}
```

- **Body:** `{ dataset, job: { id, url, finishedAt }, rows: [...] }`, or `{ …, changes: {...} }`, in batches of at most 500 rows.
- **Delivery.**
  - Sent from the service worker.
  - Retried 3 times with backoff (5 s, 30 s, 2 min).
  - Rows sent so far are counted on the dataset (`view.webhook.sent`), so a delivery cut short resumes.
  - The last error is kept and shown on the dataset, as Sheets errors are.
- **Permission.** The webhook's origin is requested with `chrome.permissions.request` when the target is added, through the existing banner flow. Without it, the worker's `fetch` would need the server to allow CORS.
- **Screen.** "Send to a webhook" next to "Sync to Google Sheets" on a dataset and in the Watch dialog, with **Send test**: one sample row, and the HTTP status shown.
- **Privacy.** This is the first feature that sends scraped data to a server the user names. The dialog says so in one line, and the privacy page gets a sentence.

### 3.5 Table extractor

- **Finding tables (content, `content/services/tables/findTables.ts`):**
  - Visible `<table>` elements with at least 2 data rows and 2 columns.
  - ARIA grids (`role="table"`/`"grid"` with `row` and `cell` roles), where many modern sites build their tables from divs.
  - Layout tables are skipped: a table with block content in most cells, or a single row of cells holding the page.
  - Nested tables are read as their own tables.
- **Reading a table:**
  - **Header:** `thead`, else a first row of `th`, else the first row when its style or type differs from the rows below. Multi-row headers are joined ("Q1 › Revenue").
  - **Merged cells:** `colspan`/`rowspan` are expanded so every row has every column.
  - **Links and images:** a cell holding a link or an image gets an extra column with the URL ("Name (link)").
  - **Name:** the `caption`, else the heading above the table, else "Table 3".
- **Screen** (This page → **Tables**): one card per table with name, size (12 × 5) and the first 3 rows. Each card has:
  - **Copy** (TSV, pastes into Sheets and Excel as cells);
  - **CSV**;
  - **Save to My data**;
  - **Highlight** (scrolls to it on the page).
- **Many pages** (a `tables` run kind in `JobRunner`):
  - The user picks a table on this page.
  - On each URL, the table with the most similar header (Jaccard over header names ≥ 0.6, else the same position) is read into one dataset, with `source_url`.

### 3.6 Full-page screenshot (this page only)

- **How:**
  1. Scroll the page and `captureVisibleTab` each screen.
  2. After the first screen, hide fixed and sticky elements so a sticky header appears once.
  3. Stitch the screens in an `OffscreenCanvas`.
  4. Restore the scroll position and the hidden elements.
- **No new permission:** `captureVisibleTab` works on the active tab with `activeTab` or the host permission the panel already has.
- **Limits:**
  - About 2 captures a second (Chrome's rate limit), so a very long page takes a few seconds, with progress shown.
  - Pages taller than 16,000 px are saved as numbered parts.
  - The tab must stay visible while it captures; switching tabs stops it with a message.
- **Output:** PNG or JPEG, downloaded or copied to the clipboard.
- **Options:** full page or the first screen, hide cookie banners (reuse the `CHROME` and consent selectors), "Load everything first" (§3.9).
- **Out of scope:**
  - PDF;
  - screenshots of many pages, or of background tabs.

  Both need the `debugger` permission, and Chrome shows "CrawlPilot started debugging this browser" while it's used.

### 3.7 Page to Markdown

- **This page → Markdown:** a preview, then **Copy** and **Download .md**. Options:
  - main content or the whole page (`mainContent`);
  - pruned (`fit`);
  - links and images on or off;
  - open hidden sections first (the reveal from AI Extract v2 §3.1a, on by default);
  - front matter: title, URL, date, description, author from metadata.
- **Many pages:** the metadata extractor already returns markdown per page. It gets two new exports in the data table and the run's result:
  - **a zip with one `.md` per page**, front matter included;
  - **`.jsonl` for LLM datasets**, one line per page with `url`, `title`, `markdown`, `lang`, `fetched_at`, plus an option for chunked lines (`chunkMarkdown` with heading trails) of a chosen size.
- **Link with the crawler.** A start URL plus the sitemap or link discovery (`SiteDiscoveryDialog`, `sitemap.ts`) gives "a whole docs site as markdown". This is a preset of the existing many-pages flow, not a new engine.

### 3.8 Structured data viewer

- **Where:** a tab in the Toolkit (**Data on this page**). It replaces Recon's embedded-JSON list, and Recon links to it.
- **Contents:** JSON-LD, microdata, RDFa-lite, Open Graph / Twitter / meta, and app state (`__NEXT_DATA__`, `__NUXT__`, Apollo, `window.__INITIAL_STATE__`, from `collectEmbedded`).
- **Tree:** collapsible, typed and coloured; each entity shown by `@type`.
- **Search:** over keys and values; matches expand.
- **Copy:** each node copies its value, its JSON pointer, or a dotted path usable in AI Extract and Selector Lab.
- **Checks** (one line each, from schema.org's required and recommended properties for the common types): a `Product` with no `offers.price`, an `Article` with no `datePublished`, invalid JSON in a block.
- **Use in AI Extract:** an entity becomes schema lines (`name`, `offers.price`, `aggregateRating.ratingValue`…), so T0 answers it with no model.

### 3.9 Load everything first

- **One step, `loadEverything({ mode: 'auto' | 'scroll' | 'loadMore', maxRounds, maxMs })`.** It runs the existing scroll and load-more actions until no new content arrives:
  - "no new content" means item count or page height unchanged for 2 rounds;
  - default caps: 30 rounds and 60 s.
- **Report:** "Loaded 4 more times: 24 → 120 items".
- **Used by:** the Images tool, Emails and contacts on this page, Tables, Markdown and Screenshot each get a **Load everything first** switch. Inside list runs the step already exists, unchanged.
- **Safety:** the same deny list as the reveal (`expand.ts`). Nothing that buys, signs in or leaves the page is clicked. "Load more" is clicked; "Next page" links are not followed (that's pagination).

### 3.10 Request to code: whole series

Already built for one request. Added:

- **A script that pages through everything.** For a call with detected paging params (`detectPagingParams`: page, offset, cursor, next URL), the Python and Node exports produce a loop. It:
  - requests each page, stopping when the list is empty or the cursor ends;
  - picks the array (the API Finder's chosen JSON path);
  - writes CSV;
  - waits between requests (the run's delay).
- **Node with `undici`/`fetch`, and `httpx`** as targets alongside the four existing ones.
- **The API recipe itself** (`ApiSpec`) exports the same way from History, so a run made in CrawlPilot can be scheduled on a server.

### 3.11 Recipe to Playwright or Puppeteer

- **Targets:** Playwright (TypeScript and Python) and Puppeteer (JavaScript). One generator per target from a `ListSpec` or `PageSpec`.
- **What the script does:**
  1. Opens the URL(s).
  2. Waits for the list's container.
  3. For each item, reads each field through its selector chain: a small `first(page, [chain])` helper tries each selector in order, as the extension does.
  4. Follows pagination: clicks Next or Load more, or scrolls, with the recipe's page cap.
  5. Writes CSV or JSON.
- **XPath** selectors use Playwright's `xpath=` prefix and Puppeteer's `::-p-xpath`.
- **Field types:** attributes (`href`, `src`) and types (number, date) keep their transforms where they are plain (trim, parse number). Complex transforms become a commented `TODO` with the original setting, never silently dropped.
- **Logged-in pages:** the script can load a Playwright `storageState` (§3.12).
- **Where:** "Export as script" on a recipe in History and on the List and Page Extractor results.

### 3.12 Cookie and header export

- **Permission:** the optional `cookies` permission, asked the first time with the reason.
- **Scope:** only the current site's cookies (its domain and parent domains), never all cookies.
- **Formats:**
  - `cookies.txt` (Netscape: curl `-b`, wget, yt-dlp);
  - JSON;
  - **Playwright `storageState`** (cookies + this origin's `localStorage`), which Playwright and the §3.11 scripts load directly.
- **The warning.** A confirm dialog, every time, before anything is copied or saved: "These let anyone who has the file use your signed-in session on <site>. Don't share them." The cookies are:
  - never stored by CrawlPilot;
  - never put in a webhook, a sync or a script by default (the script refers to the file by name);
  - never included in a bug report.
- **Headers:** the API Finder already copies a request's headers with an "include auth" opt-in; it links here for the cookie part.

### 3.13 Anti-bot check (Recon)

Added to Recon's report, from what it already fetches (the page and `robots.txt`):

- **Who guards the site.** Named from the response headers and cookies of Recon's GET, and the page's scripts:
  - Cloudflare: `server: cloudflare`, `cf-ray`, `__cf_bm`, Turnstile;
  - Akamai Bot Manager: `_abck`, `ak_bmsc`;
  - DataDome: `x-datadome`, `datadome` cookie;
  - PerimeterX / HUMAN: `_px*`, `/px/` scripts;
  - Imperva: `incap_ses`, `visid_incap`;
  - AWS WAF: `aws-waf-token`;
  - reCAPTCHA, hCaptcha and Turnstile widgets.
- **Rate limits:** `Retry-After`, `X-RateLimit-*` and `RateLimit-*` headers, read and explained ("100 requests per hour, 37 left").
- **Signed in or not:** a second GET with `credentials: 'omit'`. If the logged-out page is a sign-in page, much shorter, or a challenge, the report says "This page needs your sign-in: a server scraper needs your cookies (export them) or will see less".
- **Verdict for a server scraper:** one line each, using the existing `approach`:
  - plain HTTP works;
  - HTTP with cookies;
  - a headless browser;
  - a headless browser and likely blocked (bot wall), meaning use this extension or a scraping API.

## 4. Permissions

| Permission | Why | When |
|---|---|---|
| `notifications` | Change and run notifications | Added to `permissions` (no install warning) |
| Host access to the webhook's origin | POST to it from the worker | Optional, asked when the webhook is added (existing banner flow) |
| `cookies` | Cookie export | Optional, asked on first export |

Optional permissions keep the install prompt as it is. The Chrome Web Store listing needs a sentence for each in its permission justifications.

## 5. Where it lives in the panel

- **Home → More tools, "This page" group:** Tables, Screenshot, Page as Markdown. The "Load everything first" switch is inside each tool.
- **Toolkit:** Data on this page (§3.8), and in Recon the anti-bot check, cookie export and Request to code (API Finder).
- **History:** Monitors (list, Watch dialog, Changes tab), "Export as script" on recipes, and the webhook next to Sheets on datasets.
- No new home tiles. The four top tiles stay as they are (the UX simplification and Home decisions).

## 6. Code layout

```
background/runs/listJob.ts            list recipes in a background tab (§3.1)
background/runs/tablesJob.ts          the same table over many pages (§3.5)
background/monitors/scheduler.ts      alarms, catch-up, one-at-a-time queue (§3.2)
background/monitors/afterRun.ts       diff → store → notify → webhook (§3.3, §3.4)
shared/monitor/diff.ts                run diff, row identity, number-aware compare
shared/monitor/rules.ts               WatchRule evaluation, notification text
shared/integrations/webhook.ts        batches, HMAC, retries, resume (like sheetsSync.ts)
shared/db/monitors.ts                 the monitors store (DB_VERSION 8)
content/services/tables/findTables.ts tables and ARIA grids, headers, spans
content/services/capture/stitch.ts    scroll-and-capture plan, fixed elements hidden
content/services/loadEverything.ts    scroll / load more until nothing new (§3.9)
shared/export/markdownExport.ts       front matter, zip of .md, .jsonl
shared/export/scripts/                playwright-ts.ts, playwright-py.ts, puppeteer.ts, api-paging.ts
shared/export/cookies.ts              Netscape, JSON, storageState
shared/recon/botWall.ts               vendor, CAPTCHA and rate-limit signals
sidepanel/pages/TablesPage.tsx, CapturePage.tsx, MarkdownPage.tsx
sidepanel/components/toolkit/StructuredDataPanel.tsx
sidepanel/components/history/MonitorsList.tsx, WatchDialog.tsx, ChangesView.tsx
```

## 7. Steps

The quick wins come first, so each step ships something on its own. Each step keeps the e2e suite green and adds its tests.

| Step | What | Done when |
|---|---|---|
| **T1 Tables** | §3.5 on this page: find, headers, spans, link columns, Copy / CSV / Save | On new fixtures (a plain table, a `thead` + `rowspan` table, a 2-row header, an ARIA div grid, a layout table) and on the corpus Wikipedia and MDN pages, every data table is found with the right header and cell count; the layout table is not; Copy pastes as cells (TSV) |
| **T2 Markdown** | §3.7: screen, front matter, `.md` zip and `.jsonl` from metadata runs, chunked `.jsonl` option | e2e: this page → Download gives front matter + the hidden-sections fixture's opened text; a 3-URL metadata run exports a zip of 3 `.md` and a `.jsonl` of 3 valid lines |
| **T3 Data on this page** | §3.8: tree, search, copy path, checks, Use in AI Extract | On the 4 corpus product pages: the `Product` entity shows with price; copy-path round-trips through `getDotted`; "Use in AI Extract" schema answers price and title by T0 with the model off |
| **T4 Load everything** | §3.9 as a shared step and a switch in Images, Emails, Tables, Markdown | On the e2e infinite-scroll and load-more fixtures: items go from the first batch to all of them, then stop; the cart button and links are never clicked |
| **M1 Background list runs** | §3.1 `list` run kind; the panel's list runs use it | The listing e2e suite passes through the new path; a list recipe runs from the worker with the side panel closed and gives the same rows as from the panel |
| **M2 Monitors** | §3.2 store, scheduler, Watch dialog, Monitors list | With a fake clock: a monitor runs at its times, catches up once after a gap, never runs twice at once, survives a worker restart; e2e: Watch → Run now → a second job with `monitorId` |
| **M3 Changes and notifications** | §3.3 diff, rules, incomplete-run guard, notifications, Changes view, "Keep one table" | Unit: added / removed / changed by key; `$1,299.00` vs `1299` is no change; a half run isn't diffed. e2e: an e2e site page whose prices change between runs → a notification and the Changes tab shows old → new |
| **M4 Webhooks** | §3.4 target, batches, HMAC, retries, resume, Slack format, Send test | Against a local test server in e2e: rows arrive in batches with a valid signature; a 500 then 200 is retried and nothing is sent twice; `changes` mode sends only a monitor run's changes |
| **C1 Screenshot** | §3.6 stitched full-page PNG/JPEG of this page | A long fixture page stitches to its full height with its sticky header once and the scroll position restored; a page over 16,000 px saves as parts; switching tabs mid-capture stops with a message |
| **D1 Request to code, whole series** | §3.10 paging loop scripts, Node and httpx targets, API recipe export | The generated Python script, run against the e2e API fixture (page, offset and cursor), writes every row the API Finder run got |
| **D2 Recipe to script** | §3.11 Playwright TS / Python, Puppeteer | Golden test: the generated Playwright script, run by the e2e harness against 3 listing fixtures (paged, load more, infinite scroll), gives the same rows as the extension's run |
| **D3 Cookies** | §3.12, the `cookies` permission, three formats, the warning | Unit: Netscape and `storageState` formats (expiry, `httpOnly`, `sameSite`); e2e: a cookie set by a fixture site appears in `storageState`, another site's doesn't |
| **D4 Anti-bot check** | §3.13 vendors, CAPTCHA, rate-limit headers, logged-out GET, server verdict | Unit on recorded headers and HTML for each vendor; e2e: fixture routes that send `cf-ray` + a challenge page, `Retry-After`, and a sign-in-only page are each reported correctly |

Suggested order: T1–T4 (small, visible), then M1–M4 (the biggest value; M1 first since the rest need it), then C1 and D1–D4.

## 8. Tests

- **Unit:**
  - diff and rules (identity, number-aware, incomplete run);
  - the scheduler with a fake clock and fake `chrome.alarms`;
  - webhook batching, signature and retry;
  - table header and span reading;
  - markdown export (front matter, `.jsonl`);
  - the script generators (snapshot + syntax check);
  - cookie formats;
  - bot-wall signals.
- **e2e** (the harness's `e2e/site` pages and a local webhook / API server):
  - one spec per step, as listed in §7;
  - D1 and D2 run the generated scripts for real against the fixtures and compare rows.
- **Manual:** a real monitor over two days on a store page (missed runs while asleep, notifications), and a real Cloudflare-protected page in Recon.

## 9. Risks and decisions

- **Decided: no `debugger` permission.** Screenshots are of the current tab only, stitched; PDF and bulk capture are out of scope.
- **Decided: scheduled runs only run while Chrome is open.** The screen says so and offers script export (D1, D2) for always-on runs. A hosted runner is out of scope.
- **Decided: monitors notify by default, only when something changed** (`notify: 'changes'`). The Watch dialog can switch to every run or never.
- **Unattended runs on someone's site.** Monitors use the recipe's pacing and one run per host at a time. They don't solve bot checks; they stop and notify. Minimum interval: 15 minutes.
- **Data leaving the device.** Webhooks are the first feature that sends scraped data to a server. They are opt-in per dataset, the origin permission is explicit, and the privacy page is updated.
- **Cookies are credentials.** They are asked for and warned about each time, never stored, and never sent anywhere by CrawlPilot.
- **Moving panel list runs to the background (M1)** changes the most-used flow. The listing e2e suite is the gate, and the panel keeps its live preview through progress messages.
- **Store review.** `cookies`, even as an optional permission, gets closer review; it needs a clear justification and a visible use.

## 10. Progress

| Step | State | Issue |
|---|---|---|
| T1 Tables | **Done** | |
| T2 Markdown | Open | #38 |
| T3 Data on this page | Open | #39 |
| T4 Load everything | Open | #40 |
| M1 Background list runs | Open | #41 |
| M2 Monitors | Open | #42 |
| M3 Changes and notifications | Open | #43 |
| M4 Webhooks | Open | #44 |
| C1 Screenshot | Open | #45 |
| D1 Request to code, whole series | Open | #46 |
| D2 Recipe to script | Open | #47 |
| D3 Cookies | Open | #48 |
| D4 Anti-bot check | Open | #49 |

What T1 built:

- **`content/services/tables/findTables.ts`.** It finds `<table>`s and ARIA grids.
  - **Spans:** `colspan`/`rowspan` (and `aria-*span`) are expanded.
  - **Headers:** the `thead`, else the leading rows of header cells. Several header rows are joined ("Q1 › Revenue"). With no header: "Column N".
  - **Link and image columns:** a column whose cells mostly hold a link or an image gets a "(link)" / "(image)" column next to it. In-page `#` and footnote links don't count.
  - **Footnotes:** citation markers ("[12]", "[citation needed]") are dropped from the text.
  - **Names:** caption, else `aria-label`, else the heading above, else "Table N".
  - **Left out:** hidden tables, navigation (menus, Wikipedia's navboxes), `role="presentation"`, one-column tables (lists), tables with no data row (2 with no header), and layout tables (most cells hold blocks of content).
  - At most 10,000 rows per table, with the total reported.
- **Messages:** `TABLES_FIND` and `TABLES_SHOW` (scrolls to a table and outlines it).
- **`shared/export/tables.ts`:** TSV (pastes as cells), CSV, and the saved-table shape (link and image columns typed, `source_url` on each row).
- **Screen:** `TablesPage` (`?view=tables`), from Home → More tools → "Tables on this page". Each table has a card with:
  - its size and a 3-row preview;
  - Copy, CSV and Save to My data;
  - Show on page.

  An empty state points to the List Extractor. The strings are in the new `tables` i18n namespace (English, other languages fall back).
- **Tests:**
  - `findTables.test.ts` (9): the fixture's plain, spans, two-row header, ARIA grid, header-less and one-row tables; the Table N fallback; Wikipedia's 3 data tables with no navboxes or footnote links; MDN's one-column table left out.
  - `tables.test.ts` (3): the exports.
  - `e2e/tables.spec.ts` (2): the finder on a live page, and the screen (cards, Show on page, Save to My data).
- **Differs from the plan:** a "many pages" table run (§3.5, last bullet) isn't built; it belongs with the bulk-run work. A one-column table counts as a list, not a table.
