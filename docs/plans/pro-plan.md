# CrawlPilot Pro: plan

Status: 2026-10-24. Planned, nothing built.

## What it is
CrawlPilot Pro is an internal extension for the team that builds and maintains crawl recipes. It is not published.
- **Build** a recipe on a live page, using the public extension's extractors.
- **Edit** a recipe's fields, clicks, cleanup steps and pages.
- **Test** a recipe on a few pages before it is sent anywhere.
- **Version** a recipe: every saved change is a new version with a note, and older versions stay readable.
- **Submit** a version to the crawler backend, which runs it at scale.
- **Maintain** recipes: see each crawl's health from the backend, then repair the failing fields on the page.

Extraction happens in Pro only for tests. The backend runs every real crawl.

## Decisions
1. **Start as a fork of the public repo, kept in sync.**
   - Clone `crawlpilot/crawlpilot` into this repo and add it as the `upstream` remote. Fixes to selectors, page data and extractors are merged in from upstream regularly.
   - Pro code goes in its own folders (`src/pro/…`), so merges from upstream stay clean.
   - Move to a shared package (`@crawlpilot/core`: the extractors, the recipe spec, transforms) only if keeping the two in sync starts to hurt.
2. **The recipe file is the contract between Pro and the backend:** `.crawlpilot.json`, the format the samples already use (`src/shared/samples/recipes/*.json`), versioned with a `format` number.
   - The public extension never reads or writes this file (see the public scope plan).
3. **It ships as a separate extension.**
   - Its own name ("CrawlPilot Pro") and extension ID.
   - Installed unpacked, or force-installed through Chrome policy. Not in the Chrome Web Store.
4. **Sign-in uses the backend's auth.** `chrome.identity` with the company login, and a token for backend calls. No backend keys inside the extension.
5. **No thenos code.** Thenos is only a design reference, as in the public repo.

## Recipe model (Pro)
Pro's own IndexedDB stores, in `src/pro/db`:
- **`recipes`**: `{id, name, site, kind, latestVersion, remoteId?, status: 'draft' | 'submitted' | 'live' | 'paused'}`.
- **`versions`**: `{recipeId, version, spec, settings, pages, output, note, createdAt, author, submittedAt?}`. A version cannot be changed once it is saved or submitted.
  - `spec` holds what to extract and nothing else: elements or lists, pagination, details. No settings and no URLs, so the hash means the same fields.
  - `settings`: pace, waits, viewport.
  - `pages`: the default pages, given as URLs, a sitemap filter, or a start page.
  - `output`: field names, types, and an optional output contract.
- **`tests`**: `{versionId, url, record, steps, at}`. The latest test results for each version.

**Reused from the public repo:**
- `pageSpec`/`listSpec`/`specHash` (with its two bug fixes);
- `DataBinding`, `TransformOp`, `extractPage`, `ElementProcessor`;
- the list extractor;
- `contracts/contract.ts`.

## Work, in order (one slice at a time)
The recipe features for each slice (versions with digests and labels, typed fields, fallbacks, checks, samples and golden records, targeting, health and repair) are in [recipe-improvements-plan.md](recipe-improvements-plan.md).

### 1. Fork and rename
- Clone upstream and give it a new name, icon and extension ID.
- Remove the public onboarding (welcome page, store links).
- Keep the public test suites running in CI.

### 2. Recipes and versions (local only)
- **A Recipes screen**, the Pro home. It lists every recipe with:
  - its status;
  - its latest version;
  - its last test result.
- **The Page and List Extractors save drafts instead of running.** "Save version" opens a version note and writes a new version. Nothing runs.
- **Open a version to edit it.**
  - The extractor loads the version's elements, pages and settings.
  - The page opens on the recipe's first page.
  - Saving writes version N+1.
- **Fields panel.** In this panel the user can:
  - rename a field, set its type, remove it, and reorder fields and clicks;
  - add cleanup steps (`ops`), using the existing `ColumnCleanDialog` chips;
  - add new ops: `splitList` (text to list) and `toObject` ("Name: value" lines to an object).
- **History.** Versions are listed with their notes. The user can compare two versions, field by field (added, removed or changed), and restore an old version as a new version.
- **Export and import of `.crawlpilot.json`.** The UNIQLO and ZARA samples are imported as the first recipes.

### 3. Test before submit
- **Test on this page:**
  - runs `extractPage` on the open tab, clicks included;
  - each field shows its value or "not found", and its step status (ok, data, healed, empty).
- **Test on N pages:** a background run over the version's first N pages (5 by default). It saves no table, only the test results.
- **Contract check.** If the version has an output contract, the test records are checked against it, as in `contracts/contract.ts`: required fields present, the floor share filled, types converted.
- **Ready to submit** means the last test passed on at least 3 pages and the contract check passed.

### 4. Submit to the backend
- **The client.** It is written against an API that the backend team owns. Pro does not define the backend; it uses these calls:
  - `POST /recipes`: create the recipe on the backend.
  - `POST /recipes/{id}/versions`: upload a version's `.crawlpilot.json`.
  - `POST /recipes/{id}/crawls`: start a crawl with a version, pages and a schedule.
  - `GET /crawls/{id}`: get the crawl's status, page counts, failing fields, and sample records.
  - `POST /recipes/{id}/pause` and `POST /recipes/{id}/resume`.
- **Submit.** The user picks a version, its pages (or a sitemap filter), and a schedule (once, daily, weekly), then confirms.
  - The submitted version is locked.
  - The recipe's status becomes `submitted`, and then `live` once the backend accepts it.
- **Crawls panel on a recipe.** It shows each crawl's status, pages done and failed, field fill rates, and the newest sample records.

### 5. Maintain
- **Health from the backend.** A field whose fill drops (for example, price from 98% to 10%) marks the recipe "needs repair".
- **Repair:**
  1. Open a page that failed, in a tab.
  2. The extractor loads the live version.
  3. The failing fields are highlighted.
  4. Re-pick them, test, save version N+1, and submit.
- **Promote and roll back.** The backend runs the version Pro marks as live, and switching back to an earlier version is one action.

## Out of scope
- The backend itself: its queue, browsers, proxies and storage.
- Running large crawls inside the extension.
- AI-written recipes.
- Getting past bot checks. Sites that block automation are handled by the backend team's policy, not by the extension.

## Verification for each slice
- **Vitest:**
  - version saving, which is immutable and numbered;
  - the field-by-field compare;
  - the `.crawlpilot.json` round trip, using both samples;
  - the contract check;
  - the API client against a mock server.
- **Playwright:**
  - build a recipe on `e2e/site/json-product.html`, save version 1;
  - edit a field, save version 2, compare 1 with 2;
  - test on this page, test on 3 local pages;
  - submit to a mock backend and see the crawl status.
- The upstream e2e suites still pass after each upstream merge.
