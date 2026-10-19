# Performance on low-end machines

Measured 2026-10-19 on the build at `64072bb`. Measuring script: `e2e/perf.spec.ts`.

```
npm run build
PERF=1 npx playwright test e2e/perf.spec.ts
```

Results go to `test-results/perf.json`. For the hot-function profile, build unminified (`npx vite build --minify false`) and run with `PERF=1 PROFILE=1 -g "where a pick"`.

## How "low-end" is simulated

Development runs on an Apple M4 (10 cores, 24 GB). Chrome's CPU throttling slows the page's renderer by a fixed factor:

| Rate | Stands for | Reasoning (single-core speed vs the M4) |
|---|---|---|
| **1×** | this Mac | — |
| **4×** | an older Core i3 / i5 laptop | about 4× slower single-core (Geekbench) |
| **8×** | a budget Celeron / Pentium laptop, or a Chromebook | about 9× slower single-core |

Limits of the method:
- **CPU only.** RAM, disk and GPU are not simulated. A 4 GB machine also swaps once Chrome holds several heavy tabs, which the numbers below don't show. The run section reasons about memory from the code instead.
- **Service worker not throttled.** It isn't slowed down, so run-side numbers come from code reading.
- **Medians of 3 runs** (2 for the data table), on saved pages from `src/test/fixtures/corpus` with their own scripts blocked. Real pages also run their own scripts, which competes for the same slow CPU.

## Results

### 1. Every page the user opens (content script)

| Page | Extension script time 1× / 4× / 8× | Extra JS memory |
|---|---|---|
| Walmart search | 1.9 / 6.4 / 14.7 ms | +0.7 MB |
| Amazon search | 1.7 / 7.2 / 15.1 ms | ≈ 0 |
| Walmart product | 1.6 / 7.6 / 16.3 ms | +0.6 MB |
| Wikipedia article | 1.7 / 7.3 / 13.3 ms | +0.5 MB |

Small. The 215 KB script only registers message handlers at load, and V8's code cache takes care of repeat parses. **Not a priority.**

### 2. Picker

| Page | Hover 1× / 4× / 8× | Click until the rows arrive, 1× / 4× / 8× |
|---|---|---|
| Walmart search (45 cards) | 8 / 22 / 45 ms | 0.65 / 3.5 / **5.7 s** |
| Amazon search (18) | 4 / 16 / 26 ms | 0.26 / 1.0 / 2.8 s |
| Chewy listing (36) | 12 / 30 / 38 ms | 1.0 / 3.2 / **4.8 s** |

- **Pick is the worst experience on a slow machine.** After the click, the user waits 5–6 s with nothing happening.
- **Hover goes over its budget.** At 4× and 8× it is above the picker's own 20 ms budget (`BUDGET_MS` in `items.ts`) and above one frame (16 ms). The search stops early once the budget is spent, so **a slow machine may highlight a different (smaller) section, not just a slower one**. This needs checking; see P2.

Profile of three picks at 1×: about 1,000 ms of extension work in all. Browser work (style, layout, selector matching) is charged to the extension function that asked for it.

| Where | Time | Share | Why |
|---|---|---|---|
| Screen-reader copy detection (`visualCopies`, `screenReaderTexts`, `isScreenReaderOnly`, `hasLayout`, `digitsOf` in `atoms.ts`) | ~570 ms | ~55% | `isAtomRoot` calls `visualCopies(row)` **uncached for every element inside an `aria-hidden` block**. Each call queries every leaf of the row and measures each one (`getBoundingClientRect`, `getComputedStyle`), so the work grows as elements × leaves. |
| `pageSources` (`structuredRows.ts`) | ~140 ms | ~14% | The parsed result is cached, but every call lists all inline scripts (`querySelectorAll('script:not([src])')`) to check the cache. It is called per row and field. |
| Not ours (`visitNode`, program) | ~190 + 250 ms | — | Serializing the pick's message and Chrome's own work. To check: the size of the `ELEMENT_SELECTED` payload. |

### 3. Side panel

| | 1× | 4× | 8× |
|---|---|---|---|
| Open until the home screen shows | 162 ms | 486 ms | 923 ms |
| JS memory | 24 MB | 42 MB | 61 MB |

It loads **2.26 MB of JS up front, and 77% of it doesn't run on the home screen**. All of it is in `sidepanel.html` as eager module preloads:

| Chunk | Size | What's in it |
|---|---|---|
| ag-grid | 975 KB | needed only by the data table |
| MUI + Emotion | 325 KB | |
| vendor | 262 KB | i18next, react-markdown, lucide, … |
| React | 190 KB | |
| side panel | 534 KB | every page of the app, plus **all 9 languages' translations** (`src/i18n/index.ts` imports each locale statically, 444 KB of JSON source) |

Nothing is lazy-loaded (`React.lazy` isn't used).

### 4. Data table: a 2,000-page Page Extractor table

The test table has two list columns, which expand to 38,000 rows in the grid.

| | 1× | 4× | 8× |
|---|---|---|---|
| Open | 0.35 s | 0.88 s | 1.87 s |
| JS memory | 81 MB | 90 MB | 65 MB* |

\*The 8× memory figure is lower only because garbage collection happened to run before the reading.

Acceptable for now. Rows load 2,000 at a time (`ROW_PAGE_LIMIT`), and list columns are expanded eagerly.

### 5. Runs (from the code; not measured)

- **Tab count ignores the machine.** Both the Page Extractor and the Metadata screens start at **3 tabs** (`useState(3)` in `PageExtractorPage.tsx` and `MetadataExtractorPage.tsx`). `JobRunner.defaultConcurrency()` already picks fewer tabs on low-memory or few-core machines, but it never applies because the panel always sends 3. Three retail pages at 300–500 MB each is too much for a 4 GB machine: it swaps, and Chrome discards tabs. Run tabs have `autoDiscardable:false`, so other tabs get discarded instead.
- **The service worker keeps every row of a run in memory** (`state.rows`), even though preview batches are already saved to IndexedDB.
- **Each page sends the status of every URL** (`broadcast` sends `urlStatuses`, the whole list). That is quadratic over a run: fine at 50 URLs, wasteful at 2,000.

## Plan

In order of benefit per effort. Each phase is committed on its own, with the before and after figures from `perf.spec.ts`.

### P1. Faster picks (target: click until rows ≤ 1.5 s at 8×; now 4.8–5.7 s)

- **Cache `visualCopies(row)`** for the scan, in the `withAtomCache` scope, the way `collectAtoms` is cached. This is the largest single win.
- **Cheapest checks first in `isScreenReaderOnly`.** Skip layout for elements with long text, since a screen-reader-only sentence is short and clipped. Cache the result per element for the scan.
- **`pageSources`:** check the cache once per scan (`atomScope()`), not on every call; or watch for new `<script>` elements with a `MutationObserver` on `head` and `body`, which is cheap.
- **Message size:** measure the `ELEMENT_SELECTED` payload. If it carries more than the panel shows (for example every row's full atoms), send the preview rows only.
- **Show progress at once.** Highlight the picked section the moment it is clicked and show "Reading 45 items…" while fields are worked out, so a slow machine never looks frozen.

**Done (P1):**
- **Per-scan caches** in `withAtomCache` for `isScreenReaderOnly`, `visualCopies` and `readValue`.
- **`pageSources`** lists the page's scripts once per scan.
- **Picker feedback:** the tooltip says "Reading N items…" from the click until the rows arrive, and further clicks wait (tested in `e2e/picker.spec.ts`).
- **Pick message size:** 53–211 KB. Not a cost, so nothing to change.
- **Results:** the listing scorecard is unchanged, and click → rows at 8× is 1.7–2.6× faster:

  | Page | 8× before | 8× after |
  |---|---|---|
  | Walmart | 5.7 s | 1.9 s |
  | Chewy | 4.8 s | 2.6 s |
  | Amazon | 2.8 s | 1.7 s |

**What's left:** 1.7–2.6 s, still above the 1.5 s target. Profile at 1× for the remaining ~115 ms per pick:
- field inference (`inferFields`): 55%, most of it grouping and the stray check of each candidate selector;
- reading the rows: 20%;
- the page-JSON search (`findStructuredSource`): 15%;
- list locators: 10%.

Next, if needed: test fewer candidate selectors per group, and give the JSON search an early exit (skip arrays whose first item has no anchor shared with the first row).

### P2. Hover gives the same answer on every machine

- **Check whether slow machines pick differently.** Add `THROTTLE=4|8` to `e2e/picker.spec.ts` (`Emulation.setCPUThrottlingRate`) and run the scorecard. It checks the section and card count on 8 pages.
- **If it fails, the budget is the cause.** `BUDGET_MS` makes the answer depend on CPU speed. Replace the wall-clock limit with a work limit (elements visited), so every machine climbs the same levels. Then make each level cheaper so that limit stays within a frame.
- **Reuse work between hovers.** Consecutive hovers in the same card share ancestors, so cache `cardsIn(el)` per ancestor until the DOM changes (a mutation counter).
- **Target:** at 8×, the scorecard passes and a hover takes ≤ 16 ms.

**Done (P2):**
- `THROTTLE=4|8` added to `e2e/picker.spec.ts`. At both rates **all 8 scorecard pages pick the same section and card count** as at 1×.
- The budget only stops the climb after a section has been found, so on these pages a slow machine gives the same answer. The budget stays as it is.
- Hover after P1 takes 22–37 ms at 8×: about two frames, within the 100 ms that feels instant. Caching between hovers isn't worth it yet.
- Run `THROTTLE=8 npx playwright test e2e/picker.spec.ts` before releases (it takes about 6 minutes).

### P3. Side panel starts light (target: home ≤ 400 ms at 8×, ≤ 700 KB of JS at start)

- **Load each page when it's opened** (`React.lazy` per view in `App.tsx`). The data table, and with it ag-grid's 975 KB, then loads only when a table is opened. The Page Extractor, Image Downloader, Toolkit and AI pages work the same way.
- **One language at start.** Load the user's locale, plus English as the fallback, with `import()`. Other languages load when the user switches.
- **Drop the eager preloads** that Vite adds for the lazy chunks: check `build.modulePreload` once the views are split.
- **MUI:** list where it is used. If only a few components need it, replace them with the Tailwind components already in the panel and drop the 325 KB chunk. Otherwise keep it, loaded with the views that use it.

### P4. Runs that fit the machine

- **Machine-aware default tab count.** The panel starts from `defaultConcurrency()` (memory and cores) instead of 3, and says why: "2 tabs at a time on this computer". The user can still raise it.
- **Ease off under pressure.** When pages take much longer to load than the run's first pages did, or a tab crashes or is discarded, lower concurrency for the rest of the run, and note it in Job details.
- **Bounded run memory.** The service worker drops rows once their preview batch is saved, keeping only unsaved rows and counts. The final save reads the preview table.
- **Smaller progress messages.** Send only the URLs whose status changed, plus the counts. The panel keeps the full list.

### P5. Later, if numbers call for it

- **Data table:** expand list columns lazily (only rows in view), using the ag-grid infinite row model, once tables of more than 2,000 pages are common.
- **Content script:** a small loader, with the picker, list run and image code loaded on first use (`import()` of web-accessible chunks). This saves about 0.6 MB per tab. Worth it only if many-tab users report memory pressure.

### P6. Keep it measured

- **Budget checks in `perf.spec.ts`** at 4×, run before each release (they don't run in the regular `npm run e2e`):
  - pick ≤ 1 s;
  - hover ≤ 16 ms;
  - side panel home ≤ 250 ms;
  - initial side panel JS ≤ 700 KB.
- **Optional manual check:** a real low-end machine, or Chrome's "low-end device" CPU throttle preset, with 4 GB of RAM. Run a 50-URL Page Extractor run at the default tab count and watch Chrome's Task Manager.

## Progress

| Phase | Status | Before → after (8×) |
|---|---|---|
| P1 Faster picks | done (more possible) | pick 5.7 → 1.9 s (Walmart), 4.8 → 2.6 s (Chewy); "Reading N items…" at once |
| P2 Same hover answer on every machine | done | scorecard passes at 4× and 8× (same sections); hover 22–37 ms at 8× |
| P3 Light side panel | — | home 923 ms, 2.26 MB JS |
| P4 Runs that fit the machine | — | fixed 3 tabs |
| P5 Later | — | |
| P6 Budgets | — | |
