# CrawlPilot: structured columns plan (stop columns merging at random)

**Status:** proposed · **Date:** 2026-10-17 · **Branch base:** `feat/scraper-toolkit` @ `0cbcaf1`

**Goal:** listing and page extractions should produce the right columns the first time. Each field
should get one column, with a stable ID and a sensible name, and the columns should not change from row
to row or page to page. Then nobody has to merge, hide or clean columns in the data table after a run.

**Same rule as the toolkit plan:** there is no integration with thenos. Its listing runtime is used only as a
reference, and everything is reimplemented in TypeScript. The ideas here come from three thenos files:

- `markdown/rows.py` and `recipes-spi/{listing,fields,verticals}.py` are Apache-2.0.
- `selector-agent/rows.py` is AGPL, so it is used for design ideas only and no code is copied.

---

## 1. What goes wrong today, and where

The extractor never decides what the fields are. It walks every node in a row and stores every text, `href`,
`src`, `alt`, `aria-label` and `title` under a key built from the **DOM path with sibling counters**
(`card > info > span (2) href`). Columns are then guessed from those keys, and the guess is repeated in
several places:

| # | Cause | Where | What the user sees |
|---|---|---|---|
| C1 | **A column's identity is a DOM path with counters.** When a row has an extra badge, `span (2)` becomes `span (3)`, and a sponsored card has different wrappers, so it gets different keys. | `DataExtractor.processNode` → `pathComponent` | The same field is spread over several sparse columns. |
| C2 | **Path counters are removed to group keys**, and keys that never appear in the same row are combined ("row-variant aliases", the first non-empty value wins). Brand in one row and the "Only 3 left" badge in another share a path, so they become one column. | `SchemaGenerator.generateSchema` (`normalizeSelector`, `sourceKeys`) | Unrelated values end up in one column, which is the **random merge**. |
| C3 | **Pagination builds a schema for each row** (`generateSchema([rowData])`). Whether two keys collide is decided inside a single row, so a field's column ID depends on what else that row contains. The saved columns are the preview's columns, so row keys that don't match them are hidden. | `PaginationAction.ts:306` | Page 2+ columns don't line up with page 1; values disappear or move. |
| C4 | **Image columns are grouped by their last 2 path segments only.** | `SchemaGenerator.processColumnInfo` | Carousel, badge and product images are combined. |
| C5 | **Names come from a substring of the class name.** Any class containing `title`, `price`, `date` or `review` gets that name, so `old-price` and `sale-price` are both "Price" and `candidate` becomes "Date". | `processColumnInfo` keyword checks | There are many columns with the same name. |
| C6 | **Columns are merged by name every time a table loads.** Any two columns with the same name and type that never hold different values in the same row are merged. This only looks at the first 2,000 rows, is never saved, and repeats on every open. | `TableUnifier.unifyTableData`, called in `useDatabase.ts:35` | "Price" (current) and "Price" (was) are merged in some tables and not in others. The cost is O(cols² × rows) on every load. |
| C7 | **Text is read one text node at a time.** `$<b>24</b><sup>99</sup>`, `4.5 <span>out of 5</span>` and `By <a>Acme</a>` each turn into 2–3 columns. | `processNode` direct-text read | The user rebuilds values with **Merge columns** (`columnMerges`). |
| C8 | **Page Extractor lists are flattened into numbered columns** (`Name 1 … Name N`) for each page. The columns come from that page's own schema, so in a bulk run every page adds its own set. | `ContentScriptController` `CMD_EXTRACT_PAGE_BACKGROUND`, `PageExtractionStrategy` | Hundreds of mostly empty columns. |
| C9 | **Workarounds in the view only.** "Hide mostly-empty columns", "Remove duplicate columns" (which samples 50 rows) and "Hide repeating data" hide the symptoms. | `DataTable.tsx` stage 3 | The data looks clean in the table but not in the export, or the other way round. |

There is also a performance cost:

- Every row walks its whole subtree and calls `offsetParent` and `getComputedStyle`.
- Every row is hashed as full JSON.
- Pagination builds a schema for each row.
- The unifier runs again on every load.

Reading K known fields per row replaces all of this.

## 2. The thenos approach (ideas we take)

| thenos idea | Source | What we take |
|---|---|---|
| **Columns are selectors relative to one row**, and each is read inside its own row. A column read across the whole document and zipped by position misaligns as soon as a row is missing a cell. | `markdown/rows.py` (docstring, `_cell`) | Each field is a row-relative selector plus an attribute (`.price`, `a@href`, `img@src`). |
| **Rank candidates across every row** (set cover): the candidate that fills the most rows goes first, then the one that fills the most rows still empty (the sponsored card's price behind the organic one), then the rest. Candidates that fill under a minimum share are dropped. | `selector-agent/rows.py` (design only) | A sponsored or variant card becomes a **fallback in the same field's chain**, not a second column that someone merges later. |
| **Checks on the result**: two columns reading the same thing, a column empty in ≥50% of rows, a column empty in every row, every row identical. | `markdown/rows.py` `_problems` | These appear as warnings in the review step, each with a one-click fix. |
| **Coverage for each column** and a **floor** from a contract (required columns ≥95%). | `recipes-spi/listing.py` `coverage`, `verticals.py` | Saved in job stats and History. Presets set floors (ties to #12). |
| **Fields are typed and checked** (money, number, date, url, assertions such as `sale_price ≤ list_price`). | `recipes-spi/fields.py` | Builds on `src/shared/transforms/*` (already shipped) and #11. |
| **Use the page's own JSON first**: an array of objects whose keys match the columns becomes the rows, with no DOM guessing. | `selector-agent/rows.py` step 1 (design), `json_index` | Use JSON-LD `ItemList`, embedded state, or an API Finder array as the row source when it lines up with the DOM rows. |
| **Count-aware dedup across pages** (`unseen`): a row counts again only when a page has more copies of it than were already collected. | `markdown/rows.py` `unseen` | Replace the "first hash wins" dedup in `ListingRunTracker`. |

## 3. The design: decide the fields once, then read them everywhere

```
pick rows ─▶ ① atomise each row ─▶ ② align atoms across rows ─▶ ③ rank row-relative selectors
          ─▶ ④ name + type ─▶ ⑤ quality checks ─▶ FieldSchema (frozen, saved on the recipe)
                                                        │
preview / auto-scroll / pagination / bulk pages ────────┴──▶ readRow(row, schema)  (no inference)
```

The **FieldSchema** is the contract for the run:
`{ version, rowSelector, fields: FieldDef[] }`, where each
`FieldDef = { id, name, type, attr, chain: RowSelector[], fill, origin: 'auto'|'user'|'preset', mergedFrom? }`.

- **`id` is a slug** made from the field's role (`title`, `price`, `price_was`, `image`, `url`), not a hash
  of a path. It is stable across runs, pages and redeploys.
- **Every reader** (preview, auto-scroll, pagination, Page Extractor list elements) calls one function:
  `readRow(rowEl, schema) → Record<fieldId, value>`.
- **No module builds a schema while a run is in progress.**

### ① Field atoms (fixes C7)
A field atom is the smallest element whose children are all inline (`b`, `span`, `sup`, `small`, `em`, …).
Its text is read as one value with whitespace collapsed. `ReferencedView.hasOnlyInlineChildren` already
does this for the AI view, so the logic moves to `src/content/services/extraction/atoms.ts` and both
callers use it. The atoms are:
- text atoms;
- link atoms (`a@href`);
- image atoms (`img@src`, `srcset` → largest, `data-src`);
- attribute atoms (`aria-label`, `title`, `datetime`, `content`, `value`), kept only when the attribute
  adds something the text doesn't have.

Expected result: about 3× fewer raw candidates per card, and prices and ratings come out in one piece.

### ② Align atoms across rows (fixes C1, C2, C4)
For each atom, compute a **row-relative signature**, using only stable parts:
- its path from the row root, using `generateNodeName` labels **without sibling counters**;
- plus its nearest stable anchor (`itemprop`, `data-testid`, `aria-label` key, a semantic tag).

Then cluster the atoms from all sampled rows (up to 50) by signature:

- **One atom per row with this signature** → one field.
- **Several atoms per row with the same signature** (e.g. three `span`s in `.meta`):
  - Split them by their **order within the signature** only when that order is consistent: across ≥80% of
    rows, the n-th atom has the same content shape (price, number, date, short text, long text, from
    `transforms/detect.ts`).
  - Otherwise split by content shape.
  - Never split by raw DOM counter.
- **Two signatures that never appear in the same row:**
  - If they have the same content shape, the same leaf anchor, and together fill ≥ the larger one's fill,
    they are **candidates for one field** and go to step ③ as a fallback chain.
  - If any one of those conditions fails, they stay separate. This replaces the "never collide → merge"
    rule in C2 and C6.
- **Images:** group by row-relative signature and the image's role (the largest image in the card is
  `image`; small icons and badges are dropped or kept as `badge_image`). Several images in one row become
  `images: string[]` only when they share a signature (a gallery).

### ③ Row-relative selectors, ranked across rows (fixes C1, C3)
For each field:
1. Build candidate selectors relative to the row with the existing generator, using `stability.ts` rules.
2. Try each candidate on **every sampled row on its own**.
3. Order them set-cover style, as in the thenos table above, and drop candidates that fill < 10% of rows.

This chain is what `readRow` runs, so a sponsored card and an organic card both fill the same field.

### ④ Names and types (fixes C5)
Names are chosen in this order:
1. Schema.org `itemprop`, or a matching JSON-LD key.
2. `data-testid` / `aria-label`.
3. Content shape (price, rating, date, url, image).
4. A tidied stable class token.
5. `Field N`.

- When two fields would get the same name, they are told apart by evidence, never by number. For example,
  a price inside `s`, `del` or `line-through`, or one labelled "was"/"list", becomes `price_was`. A price
  near "per", "/oz" or "/count" becomes `unit_price`.
- Types come from `detect.ts`, so typed columns (#11) work automatically.

### ⑤ Quality checks (fixes C9 at the source)
The thenos-style problems appear in the review step **before** the run:

| Problem | Fix |
|---|---|
| Two fields read the same values | Drop one |
| A field is empty in ≥50% of rows | Keep, drop, or "this is a variant of field X", which joins the chains |
| A field is empty in every row | Remove it automatically |
| All rows are identical | The row selector matched one repeated element; pick again |
| One "row" matched | That's a container, not rows |

Fill for each field is shown as a small bar on each column header in the preview.

## 4. Changes by flow

### List Extractor (pick → navigation → review)
- **Step 1 (pick):**
  - Building the preview creates the FieldSchema with ①–⑤.
  - The preview table shows schema fields (fill bars, type chips).
  - A **field editor** lets the user rename, drop, retype, join two fields into one, or split one field
    by shape.
  - These edits change the **schema, before the run**, which replaces after-the-fact Merge columns.
- **Saving:** the schema is saved on the recipe (`config.options.fieldSchema`, with `version: 2`), and in
  `configSnapshot`.
- **Auto-scroll and pagination:**
  - `EXECUTE_AUTO_SCROLL` / `EXECUTE_PAGINATION` take the schema.
  - `PaginationAction` and `finishAutoScroll` call `readRow`.
  - Delete `generateSchema([rowData])` (C3) and the end-of-run `generateSchema(results)`.
- **New content on later pages:** atoms that match no field are counted as `unmapped` in each page's stats
  (History shows "page 4: 12 rows had content no field reads"). They are **not** turned into new columns
  during a run.
- **Dedup:** row identity comes from the schema values (the `url` field when there is one, otherwise all
  fields), and is count-aware like `unseen`.

### Page Extractor (single and bulk)
- **List elements** store the FieldSchema built on the authoring page and use it on every bulk page. Their
  column IDs are then the same on every page (C8).
- **New list output setting** in the review step, replacing the current numbered flattening:
  - **Nested** (default): one JSON column holding an array of objects.
  - **One row per item**: the page's scalar fields are repeated on each row.
  - **Numbered, capped at N**: the old behaviour, with a cap.
- **Scalar fields** keep their element ID as the column ID, as today. AI-filled fields (`source: 'ai'`)
  already map one field to one column.
- **Bulk orchestrator:** the column set is fixed by the recipe. Results stop adding columns page by page
  (`BulkExtractionOrchestrator` `finalColumns` push).

### Data table
- **Tables made with `schemaVersion: 2`** skip `TableUnifier`, since their columns are already final.
- **Legacy tables** keep the unifier, with one change: it merges only columns with the **same source
  signature**, never just the same name. It also saves its result once
  (`metadata.unified = true`) instead of re-running on every load.
- **Merge columns** stays as a manual tool, but the goal is that the fixture set (§6) never needs it.
- **Hide mostly-empty / duplicate columns** stay as view options but are off by default for v2 tables.

### Structured data first (optional fast path)
When the page has JSON-LD `ItemList` / `Product[]`, embedded state, or an API Finder array whose items line
up with the DOM rows (same count ±10%, and a title or url value from row 1 found in item 1):
- offer **"Use the page's data (N fields, all named)"** as the row source;
- fields are JSON paths with names already given;
- the DOM schema stays as the fallback chain.

This reuses `shared/network/arrayTable.ts` and `ReconService.collectEmbedded`.

## 5. Phases

| Phase | Scope | Main files | Done when |
|---|---|---|---|
| **S1** Atoms + one reader | `atoms.ts` (shared with `ReferencedView`); `readRow(row, schema)`; FieldSchema types | `content/services/extraction/{atoms,readRow,fieldSchema}.ts` | Fixture cards read prices and ratings as one value |
| **S2** Inference | Steps ②–④: signatures, clustering, ranked chains, naming, typing; `inferFieldSchema(rows)` replaces `SchemaGenerator.generateSchema` for lists | `inferFieldSchema.ts`, `SchemaGenerator.ts` (legacy path only) | On every fixture, column count is within ±1 of the hand-labelled fields, with no two fields named the same |
| **S3** Frozen schema in runs | Pagination, auto-scroll and preview take the schema; per-row schema generation is deleted; unmapped counts and count-aware dedup | `PaginationAction.ts`, `ContentScriptController.ts`, `useExtractionProcess.ts`, `runStats.ts` | Column IDs are the same on page 1 and page N on the paginated fixtures, and the per-row `generateSchema` call is gone |
| **S4** Review checks + field editor | Problems list, fill bars, rename/drop/join/split/retype before the run | `list-extractor/*`, new `FieldEditor.tsx` | Every check in §3 ⑤ has a test and a fix button |
| **S5** Page Extractor lists | Saved schema on list elements; nested / one-row-per-item / capped output; fixed bulk column set | `ElementProcessor.ts`, `BackgroundElementProcessor.ts`, `columnHelpers.ts`, `ContentScriptController.ts`, `BulkExtractionOrchestrator.ts`, Step 3 review | A 20-URL bulk fixture run has the same columns as a 1-URL run |
| **S6** Table side | v2 tables skip the unifier; legacy unifier is signature-based and saved once; view filters off by default for v2 | `useDatabase.ts`, `TableUnifier.ts`, `DataTable.tsx`, `database.ts` | Opening a v2 table runs no unifier, and legacy tables stop changing between opens |
| **S7** Structured data first | JSON-LD / embedded / API array as the row source when it lines up | `recon`, `network/arrayTable.ts`, list-extractor step 1 | On a page with an `ItemList` the user gets named fields in one click |
| **S8** Coverage + presets | Coverage per field in job stats and History; preset floors (retail listing) → `partial` outcome | `runStats.ts`, `HistoryPage.tsx`, #12 | History shows coverage, and a run whose required field falls under its floor is marked partial |

S1–S3 fix most of the problem (C1–C4, C7) and should come first. S4–S6 remove the need to merge by hand.
S7–S8 come after.

## 6. How we'll know it worked

- **Fixture set:**
  - The existing `src/test/fixtures/*.html`.
  - New cards with sponsored, badge and out-of-stock variants.
  - A paginated pair (`page1.html`, `page2.html`) with one extra badge on page 2.
  - A bulk set of 5 product pages that have a related-items list.
  - Each fixture has a hand-written `expected.json` listing its fields.
- **Tests:**
  - Inference tests in jsdom. `offsetParent` is stubbed; jsdom has no layout, so visibility comes from
    inline styles and `hidden` in fixtures.
  - The real-browser picker tests in #13 cover layout-dependent cases.
- **Targets on the fixture set:**
  - 0 fields that need a manual merge.
  - 0 duplicate names.
  - Column IDs identical across pages.
  - Required fields ≥95% filled.
  - Columns from a 1-URL run and a 20-URL run are the same.
- **Speed:** time to read 1,000 cards (raw-walk vs `readRow`), measured in the existing perf harness or a
  Vitest benchmark. The target is ≥3× faster.

## 7. Non-goals

- No model in the run loop. The AI schema dialog can propose names and fields when the schema is built,
  and the run still uses selectors only.
- Data saved under v1 keeps its columns. There is no migration of saved rows; old tables only get the
  safer unifier (S6).
- No change to the exports' file formats. Exports simply get fewer, better columns.
