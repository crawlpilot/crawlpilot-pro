# Simplify and restructure the extension

Goal: less code, one way to do each thing, and an obvious place to put new features.
No backward compatibility is kept. Each phase replaces the old mechanism outright and deletes it.

## 1. Where things stand (measured 2026-10-17)

- 166 source files and about 30.8k lines (tests not counted).
- **Dead code.** Three files have no importers:
  - `VisualFeatureExtractor.ts` (179 lines);
  - `IExtractionStrategy.ts` (36 lines);
  - `PaginationStrategySelect.tsx` (58 lines).
  
  The `clsx` and `tailwind-merge` packages are unused. About 17 exports and 22 exported types are not used anywhere (from a `knip` run).
- **Two element processors.** `ElementProcessor` (389 lines) and `BackgroundElementProcessor` (324 lines) have the same method set: find, scroll, highlight, extract, click and container rows. They are written twice and have drifted apart (281 differing lines).
- **Two run orchestrators.** `BulkExtractionOrchestrator` (953 lines) and `MetadataExtractionOrchestrator` (485 lines) share the same skeleton: a queue, workers, `TabPool`, preview saves, persist and recover, keep-alive, progress broadcast, finish, and handling a closed tab. Only the per-URL step differs.
- **Three messaging layers, and the message types aren't enforced.**
  - The layers are `MessageClient`, `shared/utils/messaging.ts` and `toolkit/tabMessaging.ts`.
  - There are also 45 raw `chrome.*.sendMessage` calls spread over 21 files.
  - `MessageType` lists 45 types, but handlers register with plain strings. For example, `PICKER_ACTION` isn't in the union.
- **Selector generation is spread over 8 files**, with two XPath generators:
  - `domBase.generateXPath` and the `XPathGenerator` class;
  - plus `SelectorGenerator`, `CommonSelectorGenerator`, `PaginationSelectorGenerator`, `NextButtonSelector`, `domUtils` and `shared/selectors`.
- **"Which elements are the repeated items" is decided in several places:**
  - `ContainerDetector`, `FingerprintContainerDetector` and `GroupParentContainerDetector`;
  - `utils/similarity.ts` and `ItemSelectorRefiner`;
  - and now the row profile and gate in `fieldSchema.ts`.
- **Large files that do too much:**
  - `ContentScriptController` (933 lines, 30 handlers inline);
  - `DataTable.tsx` (1,091 lines);
  - `HistoryPage.tsx` (871 lines);
  - `fieldSchema.ts` (775 lines; all inference stages in one file).
- **Types:**
  - two `SelectorConfig` interfaces;
  - four column shapes: db `Column`, `ReaderColumn`, `MappableColumn` and `EditableColumn`;
  - 307 uses of `any`.
- **Small helpers copied around:**
  - `slug` (3 copies);
  - JSON/file download (2 copies);
  - `chrome.storage` accessed directly in 8 files.
- **Logging:** 211 `console.*` calls with no shared switch. They are stripped in production but noisy in development.

## 2. Principles

1. **One mechanism per job:** one processor, one run engine, one message bus, one selector module, one item finder.
2. **Features plug in; the core stays small.** A new feature adds a handler module and a typed message. It doesn't edit a god-class.
3. **Types are shared at the boundaries.** Messages, rows and columns each have one definition, in `src/shared/`.
4. **Delete instead of deprecating.** Callers move in the same commit.
5. **Every phase is one commit.** `npm test` and `npm run build` must pass, and the smoke check in §5 must pass.

## 3. Target layout

```
src/
  shared/
    messages/      typed message map + send/on helpers (content, background, side panel)
    model/         Row, Column, SelectorConfig, ExtractionResult: the single definitions
    selectors/     generate (css, xpath, robust) + resolve + stability + grade
    extraction/    shape, fieldEdits (unchanged)
    utils/         slug, download, storage (typed settings), log, hash
  content/
    core/          ContentScriptController (bootstrap + router only)
    handlers/      picker.ts, scroll.ts, pagination.ts, pageExtract.ts, images.ts, lab.ts, recon.ts, network.ts
    extraction/    atoms, items (repeated-item finder), fields (inference stages), structured, read
    page/          ElementProcessor (one), PageExtractionStrategy
  background/
    runs/          JobRunner (queue, workers, tabs, persist, progress) + bulkJob.ts + metadataJob.ts
  sidepanel/       pages split into page + feature components + hooks
```

## 4. Phases

### Phase 1: Remove dead code and add a guard

*(small; about −350 lines)*

- Delete:
  - `VisualFeatureExtractor.ts`, `IExtractionStrategy.ts` and `PaginationStrategySelect.tsx`;
  - the `clsx` and `tailwind-merge` packages.
- Remove the unused exports, or make them file-private:
  - `SelectorGenerator`'s 7 strategy classes;
  - `FIELD_SCHEMA_VERSION`, `isDeadVerdict`, `STOP_REASON_LABELS`, `globToRegex`, `getClassPattern`, `DBManager`;
  - the unused types listed by knip.
- Add a `knip.json` that declares the manifest entry points:
  - `src/background/index.ts`, `src/content/*.ts`, `sidepanel.html` and `public/net-hook.js`.
  
  Add an `npm run deadcode` script, so dead files are reported instead of piling up.

### Phase 2: One typed message bus

*(medium; about −300 lines; touches 21 files)*

- Add `shared/messages/`:
  - a `Messages` map of `type → { req, res }`;
  - `send(type, payload, { tabId? })`, which returns a typed `Promise<res>`;
  - `on(type, handler)`, where the handler returns its response or a promise.
  
  Everything goes through one listener per context.
- Replace the 45 raw `sendMessage` calls and the three wrappers:
  - delete `shared/utils/messaging.ts`, `toolkit/tabMessaging.ts` and `shared/types/messages.ts`;
  - fold `MessageClient` into the new module.
- Unknown message types become a compile error. That ends the current drift (`PICKER_ACTION` and others).

### Phase 3: Split `ContentScriptController` into handlers

*(medium; 933 lines → about 120 in the controller)*

- The controller keeps only bootstrap, auto-resume and the auth bridge.
- Each feature becomes a module in `content/handlers/` that registers its own `on(...)` calls and owns its state:
  - picker;
  - auto-scroll (including the scroll buffer and `scrollColumns`);
  - pagination;
  - page extraction;
  - images;
  - lab;
  - recon and AI view;
  - network.
- A new feature means a new file plus one line in `handlers/index.ts`.

### Phase 4: One element processor

*(medium; about −300 lines)*

- Merge `ElementProcessor` and `BackgroundElementProcessor` into one class with a `mode: 'visible' | 'background'` option. Only highlighting, scrolling into view and wait timing differ between the two.
- Keep the better half of each method:
  - finding: the visible processor's `findView`, plus the background `waitForElement`;
  - container rows: both already call `extractRows`.
- `PageExtractionStrategy` and the background command both use it.

### Phase 5: One background run engine

*(large; about −400 lines)*

- `background/runs/JobRunner.ts` handles:
  - the queue and workers;
  - `TabPool`, domain pacing and back-off;
  - preview saves (a serial chain);
  - persist, recover and keep-alive;
  - progress broadcast;
  - finish and stop;
  - a closed tab.
- A job supplies only the following:

  ```ts
  interface Job<R> {
    kind: 'bulk' | 'metadata';
    columns(): Column[];
    run(tabId: number, url: string, ctx): Promise<R | 'retry'>;   // per-URL work
    toRows(url: string, result: R): Row[];
  }
  ```

- `bulkJob.ts` keeps the verdict, challenge and click logic. `metadataJob.ts` keeps the metadata step. Both orchestrator classes are removed.
- A future job type (sitemap crawl, API replay) is then a small `Job`.

### Phase 6: One selector module

*(medium; about −250 lines)*

- Move generation into `shared/selectors/generate.ts` next to `resolve`, `stability` and `grade`:
  - one `cssFor(el, { generalized })`;
  - one `xpathFor(el)`;
  - one `robustSelectors(el)`, which returns graded candidates.
- Delete `domBase.ts`, `domUtils.ts` and `XPathGenerator.ts`.
- `PaginationSelectorGenerator` and `NextButtonSelector` merge into `pagination/nextButton.ts`, which uses the shared generator.
- `CommonSelectorGenerator` stays as `commonSelector(rows)`, the one function that generalizes a set of rows, in the same module.

### Phase 7: One repeated-item finder

*(large; about −400 lines)*

- `content/extraction/items.ts` combines:
  - "find the repeated siblings of this element" (from `similarSiblings`);
  - "is this row an item" (the row profile and gate);
  - "find the list container on the page" (from the detectors).
  
  All three use the row-profile similarity from `fieldSchema.ts` that was just tuned on Amazon and Walmart.
- Delete:
  - `ContainerDetector`, `FingerprintContainerDetector`, `GroupParentContainerDetector` and `IContainerDetector`;
  - `utils/similarity.ts`;
  - most of `ItemSelectorRefiner`.
  
  Move `ListSelectionStrategy` and `DetailSelectionStrategy` onto `items.ts`.
- **Risk:** this changes how the picker grows a selection. Check it by hand on Amazon, Walmart, a table page and a docs page before committing.

### Phase 8: Split `fieldSchema.ts` into stages

*(small; same code, easier to change)*

- Split it into `extraction/fields/`, one file per stage:
  - `gate.ts` (profile, core, `passesGate`);
  - `group.ts` (atoms → candidate fields, selectors);
  - `merge.ts` (canonical values, `sameField`, `variantOf`);
  - `prune.ts` (constants, labels, icons, composites);
  - `name.ts` (`baseName`, `tidyLabel`, `NOISE_WORDS`);
  - `table.ts` (`tableFields`);
  - `read.ts` (`readRow`, `readField`).
- `index.ts` holds the pipeline as five calls in a row.

### Phase 9: Single shared types and helpers

*(medium; mostly type changes)*

- **`shared/model/`:**
  - `Row = Record<string, unknown>`;
  - one `Column` (`id`, `name`, `type`, optional `reader`). `ReaderColumn`, `MappableColumn` and `EditableColumn` become `Pick`s of it;
  - one `SelectorConfig`, with the `content/services/extraction/ExtractionTypes.ts` duplicate deleted.
- **`shared/utils/`:**
  - `slug` (replaces 3 copies);
  - `downloadJson` and `downloadBlob` (replace 2 copies);
  - `log` (scoped and switchable, replacing the 211 raw `console.*` calls);
  - `settings` (typed `chrome.storage` get/set/watch, used by the 8 files that call storage directly).
- Remove `any` at the boundaries first (messages, rows, columns, job results). Inner `any`s go when their files are touched later.

### Phase 10: Break up the large side panel files

*(medium; no behaviour change)*

- **`DataTable.tsx` (1,091 lines):**
  - `useTableState` (sort, filter, selection, paging);
  - `ColumnHeader`, `CellRenderer` and `Toolbar` components.
- **`HistoryPage.tsx` (871 lines):**
  - `RunCard`, `RunStatsPanel` and the `useHistory` hook.
- **`ImageDownloaderPage.tsx` (566 lines):**
  - `useImageScan` and `ImageGrid`.
- **Shared hooks:** `useExtractionProcess` and `useBulkExtraction` keep their logic, but the message plumbing moves to the phase 2 bus.

## 5. Checks for every phase

- `npm test` (326 tests now) and `npm run build` pass, and `npm run deadcode` is clean.
- Manual smoke test on the built extension:
  1. List Extractor on amazon.com/s?k=laptop: 16 or more products, the same 9 to 10 columns, and auto-scroll plus pagination over 2 pages;
  2. Page Extractor with one list field, run as a bulk job over 3 URLs;
  3. Metadata extractor over 3 URLs;
  4. image scan;
  5. the History and Data Table export (including "JSON to a schema…").
- Phases 5 and 7 also run the real-page scratch tests (Amazon and Walmart HTML) before committing.

## 6. Order and size

| # | Phase | Size | Lines (approx.) | Depends on |
|---|-------|------|-----------------|------------|
| 1 | Dead code + knip guard | S | −350 | none |
| 2 | Typed message bus | M | −300 | none |
| 3 | Controller → handlers | M | −100, 933 → 120 | 2 |
| 4 | One element processor | M | −300 | none |
| 5 | Background run engine | L | −400 | 2 |
| 6 | One selector module | M | −250 | none |
| 7 | One item finder | L | −400 | 6, 8 |
| 8 | Split `fieldSchema` | S | ±0 | none |
| 9 | Shared model + helpers | M | −200, fewer `any` | 2 |
| 10 | Split large UI files | M | ±0 | 9 |

Expected result: about 2,300 fewer lines (about 7%). The bigger gain is that every concern has a single home:

- messages: `shared/messages`;
- selectors: `shared/selectors`;
- items and fields: `content/extraction`;
- runs: `background/runs`.

Suggested start: phases 1, 8 and 4, which are low-risk and quick. Then 2 → 3 → 5, then 6 → 7, then 9 → 10.

## 7. Progress

| Phase | Status | Commit |
|-------|--------|--------|
| 1 Dead code + knip guard | done | `7262e0c` |
| 8 Split field inference into `extraction/fields/` | done | `e538179` |
| 4 One element processor | done. The visible-tab path (`CMD_EXTRACT_PAGE`, `PageExtractor`, `PageExtractionStrategy`) had no sender and was deleted. Aggregation is now in `services/page/extractPage.ts`. | `995ed1c` |
| 2 + 3 Typed message bus; controller split into handlers | done. `shared/messages.ts` holds one map of every message (payload and reply) plus `send` / `sendToTab` / `sendToActiveTab` / `on` / `ok` / `fail`. `ContentScriptController` (933 lines) became `content/handlers/` (picker, listRun, images, pageData, toolkit) and is registered from `element-selector.ts`. Removed `MessageClient`, `shared/utils/messaging.ts`, `shared/types/messages.ts` and `tabMessaging.ts`. Also removed messages that had no sender or no receiver: `SCAN_IMAGES`, `EXTRACTION_COMPLETE`/`DATA_SAVED`, the background `PING`, `AUTO_SCROLL_STATUS`, `PAGINATION_STATUS`, `RESUME_EXTRACTION_REQUEST`, and the `AUTH_SUCCESS` bridge. | see git log |
| 5 One background run engine | done. `background/runs/JobRunner.ts` handles the queue, workers, tab pool, host pacing and backoff, the verdict policy (bot-check wait, rate-limit retry, dead-page skip), preview and final tables, the job record, progress, and recovery. `bulkJob.ts` (clicks, then extract) and `metadataJob.ts` (one row per page) only say what to do on each page. Metadata runs now get the same bot-check wait, rate-limit retries and host pacing as bulk runs. | see git log |
| 6 One selector module | done. `content/services/selectors/` has three files. `generate.ts` merges `domBase`, `domUtils` and `SelectorGenerator`, with one `isStableId` in place of 3 copies. `nextButton.ts` merges `XPathGenerator`, `PaginationSelectorGenerator` and `NextButtonSelector`. `common.ts` (list rows) was `CommonSelectorGenerator`. `clickElementRobust` moved to `content/utils/click.ts`. `services/dom/` is gone. | see git log |
| 7 One repeated-item finder | done. `services/extraction/items.ts` has `findList` (hover), `itemOf` (the card holding the element), `findListInside` (Page Extractor click) and `keepItems` (the field-inference row check). Removed `ContainerDetector`, `IContainerDetector`, `Fingerprint`/`GroupParent` detectors, `ItemSelectorRefiner`, `VisualBlockExtractor`, `utils/similarity.ts`, and the similarity score in `common.ts`. On the real Amazon page: results slot found, the hovered card resolved, 16 of 27 children kept. | see git log |
| 9, 10 | to do | none |

Found along the way, for phase 2: several message handlers in the content script have no sender. Phase 2's typed map will make them show up as unused.
