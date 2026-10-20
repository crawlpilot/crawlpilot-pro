# Product improvements and new features

Status: plan (2026-10-20), for the user to choose from (§6). Branch `plan/product-improvements`, from `main`.

This plan reviews the product as it is on `main` and on the open branches. It proposes three things:

- **Fixes:** gaps found in the code that no plan or issue covers yet.
- **New features:** what users of a browser scraper expect and CrawlPilot doesn't have.
- **An order of work:** across these and the 50 open issues.

It doesn't repeat the work already planned. §1 lists where that work stands.

## 1. Where things stand

| Area | Shipped on `main` | Planned or on a branch |
|---|---|---|
| **Lists** | Pick one card, get the list. Next / Load more / infinite scroll. Duplicates dropped. Per-page stats. The run goes on when the panel shows another screen | Virtual lists, feeds, Instagram-class pages (`feat/virtual-feeds`, V0–V3 built, V4–V7 to do) |
| **Pages** | Same fields over many URLs in background tabs. Site discovery. AI-filled fields. Page checks (bot walls, login walls, soft 404s) | Background list runs (M1, #41) |
| **AI** | AI Extract v2 to A3: input chooser, list region, evidence report | A4–A6 (#50–#52), many pages (#20), recipes (#19), eval (#21) |
| **Toolkit** | Recon, Selector Lab, API Finder (to cURL / Python / Scrapy), Data on this page | Request to code (#46), recipe to script (#47), cookies (#48), anti-bot check (#49) |
| **Page tools** | Tables, Page as Markdown, Images, Emails, Summarizer, right-click unlock | Load everything (#40), screenshot (#45) |
| **Data** | Data table with typed columns and merges. CSV / JSON / Markdown / zip / JSONL. Sheets, webhook, Airtable. History with reruns | Tables over many pages (#53), Ask your table (#28), AI columns (#26), translate (#27) |
| **Automation** | none | Monitors, change diffs, webhooks (M2–M4, #42–#44) |

## 2. Housekeeping first

- **Close or merge duplicate issues**, so the backlog says what is left:

  | Issue | Overlaps | Proposal |
  |---|---|---|
  | #14 Change monitor | #42, #43 | close as duplicate |
  | #16 Session export | #48 | close as duplicate |
  | #9 Recipe files and code export | #47 (code) | keep for the files part only, retitle |
  | #15 LLM-ready Markdown | #38 (built) and #25 | close what #38 shipped; move the rest to #25 |
  | #17 Translate toolkit screens | #55 | close as duplicate |
  | #38, #39 | built (T2, T3) | close |
  | #22 Embedded app state for AI Extract | T0 reads JSON-LD and microdata; V3 reads bootstrap JSON for lists | narrow to AI Extract's single-page read |
  | #18 Verify `feat/scraper-toolkit` | merged long ago | close |

- **Old local branches:** `crawl_config`, `experiment-multirowexports`, `new_flow` and `releas-1.1` are 1–6 commits ahead of `main`, last touched February–July. Decide keep or delete. `experiment-multirowexports` (rows in more than one layout) may be worth a look.
- **The e2e suite runs green only one spec at a time** (#58). Under load, tests time out: 6 failed in a full run on 2026-10-20, and all passed when run alone. Running in CI (#23) needs this fixed first.
  - Run the suite with `workers: 1` and a per-test timeout scaled to the machine.
  - Give each test its own extension context, not a shared worker.

## 3. Fixes found in the code

| # | What | Where | Effect today | Fix |
|---|---|---|---|---|
| F1 | **Cell edits are not saved.** Grid cells are `editable: true`, but no `cellValueChanged` handler stores them | `components/ui/DataTable.tsx` | An edited value shows until reload, then it's gone, and exports never include it | Save edits to the row (`db.tables.updateRow`), keep the original value for "Revert", mark edited cells |
| F2 | **"Premium" exports aren't gated.** Webhook, Zapier and Airtable are called "premium" in the code, but there's no plan or licence check | `pages/DataTablePage.tsx` | All free (fine if intended) | Decide (§6, D4): drop the word, or add licensing (§4.8) |
| F3 | **List runs need the side panel open.** Since 2026-10-20 a run survives screen changes, but closing the panel still ends it | `hooks/useExtractionProcess.ts` | A long scroll run dies with the panel | M1 (#41) moves list runs into the service worker. Until then, warn "Keep the side panel open" while running |
| F4 | **Responses before the pick aren't captured.** The API hook starts at the list pick (V3) | `content/handlers/picker.ts` | The first page loaded by scrolling, before the pick, has no API fields | Offer "Reload and record" (the API Finder's) when a run finds rows with no data |
| F5 | **Live table reloads read only the first page of rows** (`ROW_PAGE_LIMIT`) | `hooks/useDatabase.ts` | A preview past the limit doesn't show its newest rows | Load more as you scroll, or show the newest rows during a run |

## 4. New features

Effort: S = days, M = 1–2 weeks, L = more.

### 4.1 Extraction

| Feature | Why | Effort |
|---|---|---|
| **URL-pattern pagination** (`?page=N`, `/page/N/`, `offset=`): found from the Next link or the address bar, run by loading URLs, no clicks | The most reliable way through numbered listings. No click to miss, and pages can run in background tabs in parallel. Today only click / load more / scroll exist (`PaginationMode`) | M |
| **List + details in one run.** After a list, open each row's link, read the detail fields, and join them **back onto the list rows** (by URL) | The commonest job, "products with their full specs", takes two runs and a manual join today. The Page Extractor already runs URLs from a table; this adds the join and one flow | M |
| **Only new rows** (incremental runs): a rerun keeps the rows it hasn't seen before (by row key) and stops a feed or next-button run when a page is all known | Monitoring news, jobs and listings without re-reading everything; the base for M3 | S–M |
| **Open each item** (virtual-feeds V6): click a card, read the dialog or route it opens, close it | Modal-detail sites (Instagram, LinkedIn jobs, Airbnb) | M |
| **Several lists on one page, joined** (a table of prices beside a table of names; a grid with a filter sidebar's counts) | Picks are one section by design (`picker-container-bound-plan.md`); a join step keeps that rule | M |
| **Shadow DOM and same-origin iframes** (#8) | Shopify apps, embedded widgets, Salesforce pages | M |

### 4.2 Data table and exports

| Feature | Why | Effort |
|---|---|---|
| **Excel (.xlsx) export**, typed: numbers as numbers, dates as dates, links as links | The format most business users ask for first. CSV loses types and breaks on commas and encodings in Excel | S |
| **Save cell edits** (F1), **undo**, **find and replace** in a column | Light cleaning without leaving the extension | S |
| **Combine datasets**: append runs of the same recipe, dedupe by row key, or join two tables by a column | Today each run is its own table; weekly runs of one list can't be one sheet | M |
| **Formula / derived columns** (`price * 0.9`, `split(title, " - ")[0]`, regex extract) beside the typed columns | Common cleanup without exporting to a spreadsheet | M |
| **Nested JSON export** (rows with their list columns as arrays) and **NDJSON** for every dataset | Developers loading into scripts and databases | S |
| **Notion and Google Drive** export, alongside Sheets and Airtable | Where many non-developers keep research | M |

### 4.3 Automation (after M1–M4)

- **"Run on this page" from the right-click menu and a keyboard shortcut.** Rerun the last recipe matching this site (`contextMenus`, `commands` in the manifest).
- **Run notifications** (`notifications` permission): done, failed, needs you (a bot check paused it).
- **Chained recipes:** a list run feeds a details run, then a webhook. This is §4.1's join, saved as one recipe.

### 4.4 Recipes and sharing

- **Recipe files** (#9, narrowed): export and import a recipe as JSON, with its selectors, fields, pagination and checks. Share it, back it up, or put it in git.
- **Recipe library in the panel:** the user's recipes by site, last run, health ("2 fields broke on the last run"), with one-click rerun. History has the runs; recipes have no screen of their own.
- **Recipe health checks:** before a scheduled rerun, test the recipe on its first page and heal what broke (selector fingerprints, #7), or ask the user.

### 4.5 First use and everyday use

- **A guided first run** on a built-in demo page (a shop listing shipped with the extension): pick, run, see the table, export. No live site needed. The welcome screen points to it.
- **Command palette** (`Ctrl/Cmd+K` in the panel): every tool, recipe and dataset by name.
- **Empty and error states that say what to do next**, in the style of the run-stopped messages: "No list found here: try pointing at one card", "This site needs you to log in".
- **Keyboard support across the picker and the table** (the picker has `Alt+↑/↓`; the table and wizards need focus order and shortcuts). Plus an accessibility pass (#57 covers usability, not a11y).

### 4.6 Reliability and support

- **"Report a problem" bundle.** One click saves:
  - the page as a corpus capture (as `scripts/corpus/prepare-listing.mjs` makes);
  - the pick and recipe;
  - the run log and stats;
  - the extension version.

  The user attaches it to an email or issue. Today a failure on a new site needs the user to save the page by hand. Personal data stays out by default, with a warning before including a logged-in page.
- **Opt-in local diagnostics:** a ring buffer of errors and run outcomes, shown in Settings and included in the bundle. Nothing is sent anywhere.
- **Selector fingerprints and self-heal on rerun** (#7): the heal already happens within a run (`healItems`, field checks). This keeps what was healed and reports it.

### 4.7 Reach

- **Edge Add-ons listing:** the MV3 build runs as is. It needs store assets and a check of the on-device AI paths, which don't work there.
- **Firefox** (`sidebar_action` for the side panel, no `chrome.sidePanel`, no on-device model): L. Only if users ask.
- **Translations:** #55 (screens) and the store listing in the 5 biggest languages.

### 4.8 If CrawlPilot is sold (decision D4)

- **Free:** single-page tools, lists, exports to files.
- **Pro:** monitors, background and scheduled runs, webhooks / Sheets / Airtable / Notion, AI Extract over many pages, recipe library with health.
- **Licensing:** a license key checked against a small server (or Chrome Web Store payments' successor, a Lemon Squeezy / Paddle key), cached offline.
- **Pricing page** on crawlpilot.tech.

## 5. Order of work

| When | What | Why first |
|---|---|---|
| **Now** | §2 housekeeping; F1 (save cell edits); F3's warning; finish virtual feeds V4–V7 | Cheap; stops data loss; finishes work in flight |
| **Next** | URL-pattern pagination; list + details in one run; .xlsx; only-new rows; M1 background list runs (#41) | The everyday jobs: numbered listings, products with specs, Excel, reruns |
| **Then** | M2–M4 monitors and webhooks (#42–#44) on top of only-new rows; right-click / shortcut runs; notifications; recipe files and library | Automation once runs are background and incremental |
| **Later** | Combine datasets; formulas; Notion / Drive; Report a problem bundle; command palette; guided first run; Edge listing; AI Extract A4–A6 and many pages | Breadth and polish |
| **If asked** | Firefox; several lists joined; Pro licensing | Depends on users and the business decision |

## 6. Decisions

| # | Decision | Options | Plan assumes |
|---|---|---|---|
| D1 | Which of the "Next" features first | URL pagination · list + details · .xlsx · only-new | **list + details**, then URL pagination: they cover the most jobs |
| D2 | Duplicate issues (§2): close them? | close · keep | close, with a link to the one that stays |
| D3 | Old branches | delete · look at `experiment-multirowexports` first | look first, then delete |
| D4 | Paid tier | free product · Pro tier (§4.8) | none: decide before M2–M4, which are the natural Pro features |
| D5 | Report a problem bundle: include page captures by default? | yes, with a warning on logged-in pages · only when the user ticks it | only when ticked |
