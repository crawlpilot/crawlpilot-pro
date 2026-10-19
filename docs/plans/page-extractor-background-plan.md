# Page Extractor: runs that stay in the background, and fields that are found

## Context

Two problems with Page Extractor runs over many URLs, for example the user's recipe "walmart.com · 47 URLs":
- **Steps:** extract price; extract h1; click a button; extract a `ul`; click an `i`; click a button; extract a table.
- **Problem 1, windows on screen.** Any recipe with a click step runs every URL in a popup window. The popup is unfocused, but it sits over the user's own window (`TabPool.createPopup`). Chrome only runs animations and rendering at full speed in a visible tab, which is why popups were used.
- **Problem 2, low field coverage.** Fields revealed by clicks often come back empty.

**Causes found in the code:**

| # | Where | What goes wrong |
|---|---|---|
| 1 | `bulkJob.extract` (`src/background/runs/bulkJob.ts`) | Runs **all clicks first, then all extracts**, so the recipe's order is lost. "Click Specs → read list → click Reviews → read table" becomes "click Specs, click Reviews, read both". A tab switch or accordion toggle then hides what the first click showed. |
| 2 | `bulkJob.extract` | After the clicks there is a fixed wait (`max(clickWaitMs, 3000)`). Nothing checks that a click changed anything, and a click that misses its element is silent. |
| 3 | `forceExpandInPage` | Site rules (`.sui-collapse-root`, `accordion__input`), against the no-site-rules convention. |
| 4 | `ElementProcessor.containerRows` (`src/content/services/page/processors/ElementProcessor.ts`) | Drops rows that are `display:none` or have no `innerText`. A table inside a collapsed section gives zero rows, and the field falls back to `innerText`, which is `""` for hidden content. Data already in the DOM is lost because it isn't shown. |
| 5 | `ElementProcessor.extract`, text case | Reads `innerText`, which is empty for hidden elements, and `textContent` merges words. |
| 6 | `ElementProcessor.find` | Uses only the stored selectors. A redesign or an A/B variant gives "not found", with no healing like list fields have (`fields/health.ts`). |
| 7 | Run results | No per-element coverage, so the user can't see which field failed on which URL, or why. |

## Approach: don't depend on clicks or a visible window

Each recipe step is resolved by the cheapest way that works, in this order:
- **Read the data.** No click, no window. Most clicked-open content is already in the page's HTML, in its JSON state, or behind a request the page makes.
- **Click in a hidden tab.** For anything that still needs a click: a background tab, no window, and a small script that makes the hidden tab behave like a visible one.
- **Popup as last resort.** Only if a site provably ignores script clicks: an unfocused popup parked at the screen edge.

No debugger API: enterprise policy can block it, it shows a "debugging" bar, and sites can detect it.

### P1. Correct order and checked clicks (fixes 1–3)

- **Order:** run the recipe's steps in their own order in one content-script pass. Add a `CMD_RUN_PAGE_STEPS` handler next to `CMD_EXTRACT_PAGE_BACKGROUND` in `src/content/handlers/pageData.ts` and drive it from `extractPage.ts`. `bulkJob` sends the whole recipe instead of splitting clicks from extracts.
- **Click effect:** after each click, wait for an effect with `settle()` (`src/content/utils/settle.ts`): mutations near the target, `aria-expanded`/`aria-selected` changes, or the next extract's element appearing (the existing `waitForElement`). This replaces the fixed 3 s. A click with no effect is retried once with `clickElementRobust`, then recorded as `no-effect`.
- **Already open:** a click whose target is already open (`aria-expanded="true"`, `aria-selected="true"`, `<details open>`) is skipped, so a click never closes a section.
- **Site rules removed:** replace `forceExpandInPage` with a generic opener that, after the clicks, sets `<details open>`, opens `aria-expanded="false"` controls by their `aria-controls` target, and shows `hidden` and `[aria-hidden]` regions the clicked control owns.

### P2. Read what is already there (fixes 4–5)

- **Hidden rows:** `containerRows` keeps hidden rows when the container itself is hidden, so a collapsed section still gives its rows. Row filtering still drops empty rows.
- **Hidden text:** text extraction uses `atomText` (`extraction/atoms.ts`), which reads hidden content, keeps words apart and prefers the visible copy over screen-reader text. It replaces `innerText || textContent`.
- **Lists:** `text_array` and `table` read through the same atoms, so list items with nested markup are read whole.

### P3. Bind fields to the page's data at pick time (no click on a run)

When the user picks a field in the foreground, after clicking to reveal it, record where its value comes from:
- **Page JSON:** search `pageSources()` (`structuredRows.ts`: JSON-LD, `__NEXT_DATA__` and other JSON state) for the picked value and store the JSON path. This reuses `jsonValueAt`/`getDotted` and the `JsonSpec` reader shape that list fields use (L5).
- **The request a click makes:** if the value appeared only after a click, look for it in the responses `refreshNetSources` captures (`api` kind). Store the request (URL template with the page's ID, method), not the response.
- **On a run:** each field tries the JSON path, then the recorded request (fetched from the page, with its cookies), then the DOM selector. A click step whose revealed fields all resolve from data is skipped.
- **Review step:** shows where each field reads from ("page data", "request", "page").

### P4. Hidden tabs that behave like visible ones (fixes problem 1)

- **No popups:** `TabPool.acquireTab` opens background tabs (`active:false`) for every run. The `interactive` flag no longer creates a popup. `chrome.tabs.update(tabId, { autoDiscardable: false })` stops Chrome discarding them.
- **Visible-tab shim:** before any page script, in the page's main world, the run injects a shim with `chrome.scripting.registerContentScripts`, scoped to run tabs by a run marker and removed at the end of the run. It:
  - reports the tab as visible and focused (`visibilityState`, `hidden`, `hasFocus`), and suppresses `visibilitychange`/`blur`;
  - runs `requestAnimationFrame` from a `MessageChannel` loop, which hidden tabs don't throttle the way they throttle timers.

  React and CSS-in-JS accordions then finish opening in a hidden tab.
- **Waiting:** waits stay in the service worker or use mutation observers, never page timers, which hidden tabs throttle.
- **Popup as last resort:** if a click step records `no-effect` on 2 or more of a run's first URLs, the run moves those URLs to the popup mode. The popup is 400×300 and parked at the screen's bottom-right corner, never over the user's window. The step's result notes it.

### P5. Healing and coverage (fixes 6–7)

- **Healing:** a page element not found by its selectors is looked for again by its meaning and its value's shape, as list fields are healed (`fields/health.ts`, `meaning.ts`). For example, a price field finds the nearest price-shaped value under the same heading. The healed reader is kept as an alternate.
- **Coverage:** each URL's result records per element: `ok`, `from data`, `healed`, `not found`, `click had no effect`, or `empty`. Job details (`JobDetailsDialog.tsx`, `runStats.ts` `columnCoverage`) shows fill per field and the failing URLs per field.

## Files

- **Run side:**
  - `src/background/runs/bulkJob.ts`: send the whole recipe; delete `forceExpandInPage`; per-URL step results.
  - `src/background/runs/TabPool.ts`: background tabs only, `autoDiscardable:false`, parked popup as last resort.
  - `src/background/runs/JobRunner.ts`: register and unregister the shim per run; demote URLs to the popup mode.
- **Page side:**
  - `src/content/handlers/pageData.ts`, `src/content/services/page/extractPage.ts`: ordered steps, click effects.
  - `src/content/services/page/processors/ElementProcessor.ts`: `atomText` reads, hidden rows, heal.
  - `src/content/services/page/visibleShim.ts` (new, main world).
  - `src/content/services/extraction/structuredRows.ts`: value-to-JSON-path and value-to-request search for page fields.
- **Shared and UI:**
  - `src/shared/messages.ts`, `src/shared/recipes/spec.ts`: step results; per-field data source.
  - Side panel Page Extractor review and `JobDetailsDialog.tsx`: field source and coverage.
- **Docs:** `docs/plans/page-extractor-background-plan.md`, with this plan as phases P1–P5.

## Verification

- **Unit tests (Vitest, jsdom):**
  - ordered steps (click, read, click, read) on a tabs fixture where the second click hides the first panel;
  - hidden table rows read;
  - `atomText` on hidden text;
  - generic opener with `aria-controls` and `<details>`;
  - JSON-path binding on `pdp-walmart.html.gz` (specs present in `__NEXT_DATA__`);
  - healing of a renamed price class.
- **E2E (`e2e/harness.ts`), new fixtures in `e2e/site/`:**
  - a React-like accordion that opens via `requestAnimationFrame` and transitions;
  - tabs that swap panels;
  - a section that fetches its content on click.

  A bulk run over 5 URLs in **background tabs** must:
  - open no window (`chrome.windows.getAll` count unchanged);
  - fill every field;
  - report coverage per field.

  The fetch-on-click page must run with no click, reading the recorded request.
- **Manual:** re-run "walmart.com · 47 URLs" (id 13/14) and compare field fill before and after in Job details. Ask the user before any live captures.

## Progress

| Phase | Status |
|---|---|
| P1 | Done. `extractPage` runs the recipe's steps in order (one `CMD_EXTRACT_PAGE_BACKGROUND` call with every step; no separate message was needed) and returns `steps` (each step's status). `ElementProcessor.click` skips open controls, checks each click for an effect (mutations other than our highlight, `aria-*`/`open` state, URL), retries with the pointer sequence, then follows the control's markup (`<summary>`, `aria-controls`); else `no-effect`. An extract after a click waits for its element. `bulkJob` lost its click split, fixed waits and the site-specific `forceExpandInPage`. |
| P2 | Done, smaller than planned. Measured on `e2e/site/product-hidden.html`: hidden content already read (`innerText` of a `display:none` element is its text; tables and lists read the same), so cause 4–5 was mostly not real. Kept: text reads through `atomText` for one-value elements (the shown copy, not screen-reader text), list items keep their word spacing, and `reveal.ts` `whileShown` shows collapsed / `visibility:hidden` / `content-visibility` ancestors for the length of a read, as a guard. The losses were the step order (P1) and fields bound to the page rather than its data (P3). |
| P3 | Done for the page's JSON (JSON-LD, `__NEXT_DATA__`, inline state): `page/dataBinding.ts`. At pick, the detail picker looks for a text value, a text list or a table's rows in the page's data; the path must hold on other pages (no item-ID keys; an array item is chosen by its label, `{ where: "name", is: "Btu" }`, not its position) and keeps the value's format ("$" before a bare number). The element stores it as `data`; a run reads it first, falls back to the DOM, and skips a click whose following fields all came from data (`skipped`). Walmart product page: price → `product.priceInfo.currentPrice`, specs table → `idml.specifications`. **Not done:** binding to a request a click makes (needs the API Finder hook at pick time); left for a follow-up. |
| P4 | Done. Every run opens background tabs (`autoDiscardable: false`); no popup unless needed. A run with click steps registers `public/visible-shim.js` (MAIN world, document_start, only the run's hosts, only in a tab that starts hidden, removed when the run ends): the page sees itself visible and focused, `visibilitychange`/`blur` are swallowed, and `requestAnimationFrame` runs (a `MessageChannel` frame when 16 ms have passed, else a timer). A page whose click had no effect is read again in an unfocused popup at the screen's bottom-right corner; after 2 such pages every later page of the run opens there. **Testing limit:** headless Chromium shows background tabs as visible (even without Playwright's anti-throttling flags), so the e2e checks "no window opens" and the window fallback; the shim's behaviour is unit-tested (`visibleShim.test.ts`). Verify by hand on a live site in a normal Chrome. |
| P5 | Done. **Healing:** an element its selectors no longer find is looked for with each CSS selector loosened (nearest steps, positions dropped), taken only when exactly one element matches and, for text, its value is the kind picked (`shape`, stored on the recipe element). **Coverage:** each page's step results (`ok`, `data`, `healed`, `empty`, `not-found`, `clicked`, `already-open`, `opened`, `no-effect`, `skipped`) are kept per URL; the job's `stats.steps` (`shared/listing/stepStats.ts`) gives each step's pages, counts by status, the share it worked on and up to 5 failing URLs, shown in Job details ("Pages each step worked on"). Healing by meaning (a price found under its heading) was not needed for the selector-loosening cases and is left out. |
