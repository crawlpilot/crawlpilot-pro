# Product review: fixes and features that sharpen what makes CrawlPilot different

Status: plan (2026-10-20), for the user to choose from (§8). Branch `plan/product-improvements`, from `main`.

**Scope.** A review of the product as it is on `main` and on the open branches: what makes it different, what's
broken or missing, and the non-AI work that makes those strengths stronger. **AI is out of scope**:
- AI Extract and its follow-ups (#10, #19–#22, #50–#52);
- the Summarizer and the model host (#24);
- AI columns, translation and Ask your table (#26–#28);
- image AI (#29, #31);
- AI-filled fields in the Page Extractor.

Those stay as they are and aren't planned here.

## 1. The market

What the leading browser scrapers offer (2026 roundups: [Thunderbit](https://www.thunderbit.com/blog/best-web-scraper-chrome-extensions),
[Bright Data](https://brightdata.com/blog/web-data/best-web-scraping-extensions),
[Web Scraper's own list](https://surveys.webscraper.io/blog/best-web-scraping-browser-extensions),
[AIMultiple](https://aimultiple.com/web-scraper-chrome-extension),
[Composite](https://composite.com/blog/best-web-scraper-chrome-extensions)):

| Product | Strength | Weakness |
|---|---|---|
| **Web Scraper** (webscraper.io) | Reusable "sitemaps": a tree of selectors that walks list → detail pages ([docs](https://webscraper.io/documentation/sitemaps)); click, scroll and pagination selectors; XLSX; paid cloud runs on a schedule | A steep learning curve. Runs that stop after a page or a few minutes with no error when a site changes ([forum](https://forum.webscraper.io/t/webscraper-pagination-used-to-work-but-now-stops-after-a-few-minutes/13596), [forum](https://forum.webscraper.io/t/pagination-stops-after-1-click/3241)). Shifted columns in exports ([Capterra](https://www.capterra.com/p/240618/Web-Scraper/reviews/)). Cloud credits spent per page |
| **Instant Data Scraper** | One click, a table, free | No reuse, no schedules, weak on custom layouts |
| **Data Miner** | CSV, Excel and Google Sheets exports | Rated lowest of the four in one roundup (about 3.9) |
| **Thunderbit** and other AI scrapers | Describe columns in words; Excel, Sheets, Airtable, Notion | Paid by volume: a free tier of about 6 pages a month, paid plans from $15 a month |

**What users complain about** across all of them:
- **Silent breakage:** a selector or pagination stops working and the run ends early, with no error.
- **Setup effort:** sitemaps and selector trees take a long time to build.
- **Paid volume:** cloud credits, rows or pages run out.

## 2. CrawlPilot's strengths, and the case for each

| # | Strength | What backs it in the code today |
|---|---|---|
| **S1** | **Picks that last.** Selectors are built not to break | Chains of up to 3 selectors from different families, one an XPath, never positional when a name exists (`selectors/list.ts`, `stability.ts`). Strong / Fragile / Broken grades. Items healed during a run when their chain stops matching (`healItems`), fields checked and healed by meaning (`checkPage`). Tested on real retail pages (BestBuy, Walmart, Amazon, Home Depot, Chewy, Nike, Instagram) with a pinned report |
| **S2** | **Runs that tell the truth.** No silent stops | Each page classified: bot wall (paused for the user), login wall, rate limit (back off), waiting room, soft 404 (`verdict/`). Per-page rows and a stop reason for every run, plus field coverage (`listing/runStats.ts`). A Stop that misses the page still ends the run |
| **S3** | **Your own browser and session.** Logged-in pages work | Runs use the user's cookies. Background tabs don't steal focus (`TabPool`, `visible-shim.js`). The service worker's clock keeps hidden tabs on time. The run goes on when the panel changes screen |
| **S4** | **No setup for common jobs** | Point at one card: the list, its fields and its Next / Load more control are found. One click runs every page (Quick run). Site discovery from sitemaps for many pages |
| **S5** | **Builds real scrapers** | Recon (rendering, embedded data, bot vendor, robots, sitemaps). Selector Lab with code for Playwright, Puppeteer, Selenium, Scrapy, BeautifulSoup and Cheerio. API Finder to cURL / Python / fetch / Scrapy. API recipes that page through a JSON API |
| **S6** | **Free, unlimited, private** | No account, no credits, no cloud. Data in IndexedDB; nothing leaves the browser unless exported |

**The pitch these add up to:** *"Point at it once. It keeps working, tells you when it can't, runs in your own
browser, and hands you the scraper code when you outgrow it. Free and unlimited."* Every competitor has some of
these; none has all six. The plan strengthens each one and fixes what currently undercuts them.

## 3. Review findings: what undercuts the strengths today

Ranked by harm. Each was checked in the code on 2026-10-20.

| # | Finding | Where | Effect | Undercuts |
|---|---|---|---|---|
| **R1** | **Exports from the data table stop at 2,000 rows.** The table loads `ROW_PAGE_LIMIT = 2000` rows, and its CSV, JSON, Markdown, JSONL, webhook and Airtable exports use `getProcessedData()` over the rows on screen | `hooks/useDatabase.ts`, `components/ui/DataTable.tsx` | A 10,000-row run exports 2,000 rows with no warning. (History's Download reads every row, so the two disagree) | S2, S6 |
| **R2** | **Cell edits aren't saved.** Cells are `editable: true` with no `cellValueChanged` handler | `DataTable.tsx` | An edit shows until reload, then it's gone, and it's never exported | data trust |
| **R3** | **Integrations are a dead end.** Settings shows the webhook, Zapier and Airtable fields **disabled** behind "Upgrade to PRO", with no upgrade path. The data table's export menu still offers all three; they fail with "No URL configured. Please go to Settings" | `SettingsPage.tsx`, `DataTablePage.tsx` | Three menu items that can't work | S6 |
| **R4** | **List runs end when the side panel closes.** The run lives in the panel (it survives screen changes since 2026-10-20) | `hooks/useExtractionProcess.ts` | A long scroll or next-button run dies if the panel is closed | S3 |
| **R5** | **Recipes have no screen.** A recipe is saved for every run (`db.jobs.saveRecipe`), but only reachable as "Run again" on a dataset card | `HistoryPage.tsx` | No list of what can be rerun, no health, no edit | S1, S4 |
| **R6** | **Live previews show the first 2,000 rows** | `useDatabase.ts` | A run's newest rows aren't visible while it runs past 2,000 | S2 |
| **R7** | **No numbered-URL pagination.** Only click Next, Load more and scroll (`PaginationMode`) | `types/extraction.ts` | Numbered listings run one page at a time through clicks, in one tab, and break when the Next button changes | S1, S4 |
| **R8** | **List and detail pages take two runs and a manual join.** The Page Extractor can take URLs from a table, but its rows aren't joined back | Page Extractor | The commonest job ("products with their specs") is the most work. Web Scraper's sitemaps do it in one | S4 |
| **R9** | **The e2e suite passes only one spec at a time** (#58), with no CI (#23) | `playwright.config.ts` | Regressions in S1/S2 can ship unnoticed | S1, S2 |
| **R10** | **Backlog noise.** Duplicate or finished issues: #14 (≈ #42/#43), #16 (≈ #48), #17 (≈ #55), #18 (merged), #38 and #39 (built), #15 (mostly #38). Four stale local branches (`crawl_config`, `experiment-multirowexports`, `new_flow`, `releas-1.1`) | GitHub, git | The backlog overstates what's left | - |

## 4. Fixes (do first)

| Fix | For | What | Effort |
|---|---|---|---|
| **X1 Exports read every row** | R1 | Every export from the data table reads the whole table from the database in pages (as History's Download does), applying the view's renames, merges and types. Filters and sorts apply when the user exports "what's shown", which is offered as its own choice | S |
| **X2 Save edits** | R2 | `cellValueChanged` writes the row (`db.tables.updateRow`), keeps the original for Revert, marks edited cells; edits go into exports; Undo for the last 20 | S |
| **X3 Integrations work** | R3 | Enable the webhook, Zapier and Airtable settings (or hide the menu items until D3 decides); test-send buttons as Sheets has | S |
| **X4 Keep-the-panel warning** | R4 | While a list run runs: "Keep this panel open (closing it ends the run)". Removed by F2 below | S |
| **X5 E2E green in one run** | R9 | `workers: 1`, a per-test timeout scaled to the machine, its own extension context per spec; then CI on every push (#23) | M |
| **X6 Backlog** | R10 | Close the duplicates with a link to the issue that stays; decide the stale branches (look at `experiment-multirowexports` first) | S |

## 5. Features, by strength

Effort: S = days, M = 1–2 weeks, L = more.

### S1 Picks that last → "it keeps working"

| Feature | What | Effort |
|---|---|---|
| **Recipes screen** (R5) | Every recipe by site: last run, rows, stop reason, a health dot (fields healed, broken, pages short), Run, Edit fields, Rename, Delete | M |
| **Pre-flight check** | Before a rerun or a scheduled run: open the first page, check the item chain and every field (`checkPage`), heal by meaning, and say what changed. "Price moved; found it again" or "Rating is gone: re-pick it?" | M |
| **Repair on the page** | A field that broke on page 7: one click opens page 7 with the picker on that field; the new chain is added to the recipe (a new revision), the run resumes | M |
| **Kept fingerprints** (#7) | What a run healed is stored with the recipe, so the next run starts from the healed chain and History shows "healed 2 fields on 2026-10-20" | S |
| **Recipe snapshot** | Each recipe keeps a small capture of its first page (as the corpus captures are made); the pre-flight compares against it to tell "the site changed" from "the page didn't load" | M |

### S2 Runs that tell the truth → "it tells you when it can't"

| Feature | What | Effort |
|---|---|---|
| **Run report** | One screen per run: pages read with rows each, the expected rows per page (from page 1), short pages flagged, fields' coverage, verdicts (walls, rate limits), why it stopped. Exportable with the data | M |
| **Expected-rows guard** | A page with far fewer rows than page 1 (or none) is checked again after a settle, then flagged, not taken as "the end" | S |
| **Pause on a wall, resume after** | A login wall or bot check pauses the run on that page with a notification; the user solves it in the tab, and the run goes on from there | M |
| **Notifications** | Done, failed, needs you (`notifications` permission) | S |

### S3 Your own browser → "it runs where you are logged in"

| Feature | What | Effort |
|---|---|---|
| **Background list runs** (M1, #41) | List recipes run from the service worker in a background tab, panel closed (ends R4) | L |
| **Monitors** (M2–M4, #42–#44) | Scheduled reruns with `chrome.alarms`, diffs (new, changed, gone), notifications, webhooks | L |
| **Only new rows** | A rerun keeps rows not seen before (by row key) and stops a feed or next-button run at a page that is all known. Cheap reruns, and the base for monitors | S–M |
| **Per-site pace profiles** | Careful / normal / fast per site, remembered; a site that rate-limited once starts careful next time | S |

### S4 No setup → "point at it once"

| Feature | What | Effort |
|---|---|---|
| **Numbered-URL pagination** (R7) | From the Next link and the address (`?page=2`, `/page/2/`, `offset=24`, `start=`), the page URLs are known: pages load directly, in background tabs, several at once, and keep working when the Next button changes. Offered when the pattern is found, else click Next as today | M |
| **List + details in one run** (R8) | After a list pick: "Also open each item" → pick fields on one detail page → the run reads the list, then each row's page, and **joins the detail fields onto the list rows**. One recipe, one table; Web Scraper's list → detail sitemap with no tree to build | M–L |
| **Open each item** | Items that open a dialog or an in-page route (no new page): click, read, close (virtual feeds V6) | M |
| **Feeds and virtual lists** | Finish virtual feeds V4–V7 (`feat/virtual-feeds`): promoted posts left out, limits, post details, run report | M |
| **Load everything first** (#40) | One scroll / load-more step shared by Images, Emails, Tables, Markdown | M |
| **Tables over many pages** (#53) | The same table from every URL into one dataset | S |
| **Shadow DOM and same-origin iframes** (#8) | Picks and reads inside open shadow roots and same-origin frames | M |

### S5 Builds real scrapers → "and hands you the code"

| Feature | What | Effort |
|---|---|---|
| **Recipe files** (#9, narrowed) | Export and import a recipe as readable JSON (selectors, fields, pagination, pacing); git-friendly, shareable | S |
| **Recipe to script** (#47) | A recipe as a Playwright or Puppeteer script that does what the run does: chains with fallbacks, pagination, the same fields | M |
| **`crawlpilot run recipe.json`** | A small open-source Node CLI (Playwright) that runs a recipe file headless, with the extension's selector resolver and field readers, CSV / JSON out. Build in the browser, run on a server or in CI: no other extension offers this | L |
| **Request to code** (#46), **cookie / storageState export** (#48), **anti-bot check** (#49) | As planned in `automation-and-page-tools-plan.md` | M each |

### S6 Free, unlimited, private → "and costs nothing"

| Feature | What | Effort |
|---|---|---|
| **Excel (.xlsx), typed** | Numbers as numbers, dates as dates, links as links; the first thing business users ask for, and Web Scraper has it | S |
| **Combine datasets** | Append runs of one recipe into one table with dedupe, or join two tables by a column | M |
| **Formula columns** | `price * 0.9`, `split(title, " - ")[0]`, regex extract, beside the typed columns | M |
| **Nested JSON and NDJSON** for every dataset | For scripts and databases | S |
| **Notion export** | Beside Sheets and Airtable | M |
| **Say it in the product** | Welcome and the store listing say: no account, no credits, unlimited, local. The Settings storage section shows what's kept and a one-click export of everything | S |

## 6. Everyday use

- **Guided first run** on a demo shop page that ships with the extension: pick, run, table, export, in one minute
  with no live site.
- **Right-click "Get this list" and a keyboard shortcut** (`contextMenus`, `commands`): start the picker on the
  hovered list, or rerun this site's recipe.
- **Command palette** (`Ctrl/Cmd+K`): every tool, recipe and dataset by name.
- **Empty and error states that say what to do next**, in the style of the run-stopped messages.
- **Report a problem.** One click saves:
  - the page as a corpus capture (only when ticked: logged-in pages hold personal data);
  - the pick and recipe;
  - the run log and stats;
  - the version.

  The user attaches it to an email or issue. Today the user saves failing pages by hand.
- **Accessibility pass**: focus order in the wizards and the table, labels, contrast in both themes.
- **Edge Add-ons listing**: the MV3 build runs as is.

## 7. Order of work

| When | What | Why |
|---|---|---|
| **1. Now** | X1–X6; virtual feeds V4–V7 | Stops data loss and dead ends; finishes the work in flight; makes S1/S2 testable in CI |
| **2. Next** | Numbered-URL pagination; list + details in one run; .xlsx; only new rows; Recipes screen | The everyday jobs, with the least setup (S4), and recipes worth returning to (S1) |
| **3. Then** | Pre-flight check, repair on the page, run report, expected-rows guard, notifications; background list runs (M1) | "It keeps working and tells you when it can't" (S1, S2), the core of the pitch |
| **4. After** | Monitors and webhooks (M2–M4) on top of only new rows; pause on a wall; pace profiles; right-click and shortcut runs | Unattended runs in the user's session (S3) |
| **5. Later** | Recipe files, recipe to script, the CLI; combine datasets, formulas, NDJSON, Notion; guided first run, palette, Report a problem; Edge | Developers (S5), data polish (S6), reach |

## 8. Decisions

| # | Decision | Options | Plan assumes |
|---|---|---|---|
| D1 | The first "Next" feature | list + details · numbered URLs · .xlsx · only new · Recipes screen | **list + details**: the job competitors make hardest |
| D2 | Close the duplicate and finished issues (R10) | close · keep | close, linking the one that stays |
| D3 | Integrations (R3) and a paid tier | free for all · hide until a Pro tier exists · build a Pro tier | **free for all**: S6 is the pitch; Pro, if ever, is monitors and the CLI's hosted runs |
| D4 | The CLI (S5) | build · skip | build after recipe files, as a separate open-source repo |
| D5 | Stale branches | delete · look at `experiment-multirowexports` first | look first |
