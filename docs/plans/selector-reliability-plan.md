# Selector Reliability Plan (S0–S7)

**Status:** proposed, 2026-10-17. **Branch:** `feat/scraper-toolkit`.
**Related:** `structured-columns-plan.md` (fields are decided once and read everywhere), `simplify-structure-plan.md`
(one selector module, one item finder). The thenos picker went through the same rebuild
(`thenos/docs/plans/selector-generation-plan.md`, SG0–SG3), and this plan reuses its rules and measurements.

**Goal.** Every selector a recipe stores names *what* an element is, not *where* it sits. Each selector is
checked on the page it was picked from: it matches exactly the target, or exactly the list's items. Each is
expected to survive a redeploy. A chain holds at most three entries, each from a different family, so each fallback
is a real alternative and not a variant of the entry before it. This holds for every kind of spec: list container,
list item, list field, table column, single page element, array, next / load-more control.

---

## 1. What a run depends on today

| Spec | Built by | Stored | Resolved at run time by |
|---|---|---|---|
| List container | `ListSelectionStrategy`: `generateCssSelector` (positional path) as `containerSelector`, `generateXPath` (positional) as `containerXPath`, `generateRobustSelectors` as `containerSelectors` | All three | `listRun` `resolveFirst(containerSelectors)`; `PaginationAction.findContainerRobust` (its own copy of the same loop) |
| List item | `CommonSelectorGenerator.deriveCommonSelector` (`selectors/common.ts`) | `itemSelector`, `itemSelectors`, `itemXPath` | `resolveAll(chain, container)` takes the first entry that matches anything; XPath entries are skipped; stale chain → `healItemSelector` |
| List field | `fields/group.ts` `selectorFor` from `nodeName.ts` `nodeStep` steps | `reader.chain`, `alternates`, `rowGate` | `fields/read.ts` |
| Table column | `fields/table.ts` | `:scope > :nth-child(k)` | `fields/read.ts` |
| Page element (Page Extractor, bulk) | `DetailSelectionStrategy`: first CSS and first XPath of `generateRobustSelectors`, else positional | `[{css}, {xpath}]` | `ElementProcessor` `resolveFirst` |
| Page list / table / array | Same, on the container | Container pair, plus the list's `fields` | `ElementProcessor.containerRows` (container children) |
| Next / Load more | `nextButton.ts` (`XPathGenerator` + `generateRobustSelectors`) | `nextButtonSelector`, `nextButtonSelectors` | `NextButtonSelector.find`; the scroll strategies run their own XPath code |
| AI view field | `ReferencedView`: `generateRobustSelectors` + `generateXPath` | `[{css}, {xpath}]` | `ElementProcessor` |
| Bulk click | Page element chain | — | `bulkJob.clickInPage` (its own XPath code) |

There are four generators (`generate.ts` with 7 strategies, `common.ts`, `nextButton.ts` `XPathGenerator`, and
`nodeName.ts`). Each has its own attribute list and ranking. Five places decide whether a string is XPath, and four
places resolve a chain.

## 2. What they produce (measured)

Both pages were saved and run through the current code in jsdom. The Amazon search page has 27 children, 16 of
them products. The Walmart search for `cars` (fetched 2026-10-17) has 9 server-rendered tiles; the rest of its ~140
items arrive later from JSON.

| Spec | Amazon | Walmart |
|---|---|---|
| Container, `containerSelector` | `div > div:nth-of-type(1) > … > div.s-main-slot:nth-of-type(1)` (7 steps, positional) | `div > div:nth-of-type(2) > … > div:nth-of-type(2)` (11 steps, positional) |
| Container, `containerXPath` | `//*[@id="search"]/div[1]/div[1]/div[1]/span[1]/div[1]` | `//*[@id="maincontent"]/main[1]/div[1]/…/div[2]` (12 positions) |
| Container, best available | `.s-main-slot` | `[data-testid="item-stack"]` |
| **Item chain, first entry (what the run uses)** | **`[data-index]`: 30 matches (27 children + 3 nested elements), not the 16 products** | `.b--near-white:has([data-test-id="gpt-main"])`: a border-colour utility class |
| Item, exact and named | `[data-component-type="s-search-result"]` (2nd) | none proposed; `:scope > div:has([data-item-id])` would be |
| Item XPath entries | `//div[...]`, evaluated from the document, not the container: 29 matches | same: 10 matches for 9 items |
| Item derivation time | 1,050 ms | — |
| Single element (price / title) | `[data-a-size='xl']`, `.s-underline-text span.a-price` | **`[data-item-id='7BZ17VXO2OZL'] .dark-gray`** (a product ID inside the selector) |
| Single element XPath fallback | 25 positional steps from `#search` | — |
| Title field | `h2 > span`, named Title | **`.normal` (font-weight utility), named "Text"**; `[data-automation-id="product-title"]` is ignored |
| Price field | correct | only the screen-reader text; the was-price (6 cards) has no column |
| Badge component | — | 6 columns (`Badge`, `Badge 2`…`6`, `Text 2`, `Date`) from one repeated `badgeTagComponent` |

The rows come out right on Amazon only because the field `rowGate` filters the 30 `[data-index]` matches afterwards.
The item selector itself is wrong.

## 3. Defects

| # | Where | Defect | Fix |
|---|---|---|---|
| D1 | `common.ts` `validateSelectorMajority`, sort | An item candidate is accepted when its *count* is 80–200 % of the items, and is then ranked by a score that never looks at *which* elements it matched | Compare sets: a candidate must match exactly the items `keepItems` kept (scoped to the container, descendants included). Rank exact matches only; keep near-misses for display, never store them |
| D2 | `common.ts` XPath candidates | `//tag[...]` is absolute, so it searches the whole document even when given the container as context; `PaginationAction` and auto-scroll ignore item XPath anyway | Item XPath is relative (`./tag[...]`, `.//tag[...]`) and is resolved by the same resolver as CSS, or it is not stored |
| D3 | `ListSelectionStrategy` | The container's primary selector and its XPath are positional paths. `startSelector` falls back to them | The container chain comes from the single-element generator (§4.2). The primary entry is its first. Positional paths are never stored |
| D4 | `stability.ts` | Utility classes become identity: `b--near-white`, `normal`, `ph0`, `sg-col-20-of-24`, `a-size-*` in compounds | Port thenos's **frequency rule** (`utility.ts`): a class carried by many elements of several tags is a utility. Extend the Tachyons rules (`b--*`, `normal`, `lh-*`) and grid columns (`sg-col-*`, `col-*-of-*`) |
| D5 | `generate.ts` library strategy | `css-selector-generator` writes values into selectors (`[data-item-id='7BZ…']`, `[data-a-size='xl']`). Its blacklist is a regex over the whole string, so `isStableAttributeValue` never sees them | Values never enter a selector (thenos rule 1). Remove the library (§4.2). Treat `data-item-id`, `data-asin`, `data-sku` and any value with 4+ digits or an ID shape as instance values |
| D6 | `nodeName.ts`, `common.ts`, `generate.ts`, `grade.ts` | Four lists of "author" attributes. `nodeStep` knows only `data-testid`, `data-cy` and `itemprop`, so Walmart's `data-automation-id`, `data-test-id` and `data-qa` hooks are skipped in fields and in names | **One** ordered list in `shared/selectors/stability.ts` (`data-testid`, `data-test-id`, `data-test`, `data-qa`, `data-cy`, `data-automation-id`, `data-component-type`, `data-component`, `itemprop`), used by every generator, the field steps and the namer |
| D7 | `generate.ts`, `nextButton.ts`, `grade.ts` | Three ID rules. Two reject any digit or underscore (`corePrice_feature_div` is rejected, so paths run to `body`); grading uses a third | One `isStableId` (thenos SG1): reject GUID-like ids, runs of 4+ digits and framework prefixes |
| D8 | `nextButton.ts` | XPath strings escaped with `\'`; `aria-label='${v}'` not escaped at all. XPath 1.0 has no backslash escape, so a label like *Don't* breaks the selector | One `xpathLiteral()` (`concat()` for mixed quotes) used by every XPath writer |
| D9 | `nextButton.ts` (654 lines) | About 30 candidates per pick: every class pair, `(…)[last()]`/`[1]` positions, `//*[@id]//a` (any link under an id), a sibling-label path. Uniqueness is checked on the pick page only | Four families: `rel="next"`, test id / author attribute, accessible name (aria-label or exact text, with no digits), stable class scoped to a named ancestor. At most three are stored. The validation in `NextButtonSelector.find` (visible, enabled, best of several) stays |
| D10 | Page Extractor | One CSS and one XPath, each chosen as "unique on this page". For bulk runs over many URLs the second is a positional path, and spec rows (`th`→`td`) have no label family | Cost-ranked chain (§4.2) with a **Label** family (`//th[normalize-space()="Weight"]/following-sibling::td[1]`, `dt`→`dd`, a label span); positions never stored |
| D11 | `resolve.ts`, `PaginationAction`, scroll strategies, `bulkJob` | `resolveFirst` takes the first entry that matches *anything*, so a stale entry matching the wrong element wins silently. Four copies of the resolution loop; five `startsWith('//')` checks | One resolver with expectations (§4.4); every caller uses it; one `looksLikeXPath` |
| D12 | `useExtractionProcess`, `useJobRerun` | Volatile entries are filtered only when a *recipe* is saved. The job's `configSnapshot` keeps the raw chain, and **rerun reads `configSnapshot` first**, so reruns use hash classes and `:nth-child` | Filtering happens once, where the chain is built (§4.1), so there is nothing left to filter at save time |
| D13 | `PaginationAction.healItemSelector` | Heals from `container.children` without the saved `rowGate`, so it can heal to a selector that includes ads. The healed selector is logged and then lost | Heal with `keepItems` and the saved gate, and require exact set match (D1). Report the healed chain in `PAGINATION_UPDATE`, and save it to the recipe |
| D14 | `fields/table.ts` | Columns are `:nth-child(k)`, so one inserted column shifts every value after it | Columns read by header: the reader stores the header text and resolves its index from the table's header row on each page. Position is used only when the table has no header |
| D15 | `fields/group.ts` slots | A repeated component (Walmart's badge) becomes up to six slot columns | Repeated nodes with the same author hook and mixed shapes become one `many` field (joined) |
| D16 | `shared/types/extraction.ts`, `page/types.ts`, `messages.ts` | Three stored shapes for the same idea: `{selector, strategy}[]` plus `containerSelector`/`containerXPath`/`itemSelector`/`itemXPath` duplicates; `{type, value}[]`; `nextButtonSelector` + `nextButtonSelectors` | One `Locator` (§4.1) per spec |
| D17 | — | `gradeSelector` exists but is used only by the Lab and the AI view; nothing is generated or stored by grade | One cost model (§4.2) ranks every generator; the grade is shown in the review step |

## 4. Design

### 4.1 One stored shape

```ts
/** A spec's selectors, best first; every entry verified on the pick page. */
interface Locator {
    chain: string[];          // ≤ 3, CSS or XPath (told apart by looksLikeXPath), distinct families
    expect: 'one' | 'items';  // what a correct match is
}
```

- **List spec:** `{ container: Locator, items: Locator, fields: ReaderColumn[] }`. The items locator is resolved
  relative to the container.
- **Page element:** `{ element: Locator, type, fields? }`.
- **Pagination:** `{ next: Locator }`.
- `SelectorConfig`'s six selector fields, `SelectorDefinition`, and `nextButtonSelector`/`nextButtonSelectors` all
  go. The `strategy` label becomes the family (`test id`, `id`, `label`, `attribute`, `text`, `class`,
  `structure`, which are `grade.ts`'s names), computed for display, not stored.
- **Saved recipes and jobs in IndexedDB:** converted once, by the v6 database migration (§7). Nothing reads the
  old shape after that. The migration is the only bridge; without it, every saved recipe stops running.

### 4.2 One generator, cost-ranked (port of thenos SG1–SG2)

There is one `selectorsFor(element, { root, expect })` in `content/services/selectors/`. Its strategies, in cost
order (thenos `cost.ts`: test id 1, label 100, id 150, author attribute 200, text 300, vocabulary 350, class 400,
tag 600; +50 a scope step, at most 2; any position 10,000):

| Strategy | Proposes | Used for |
|---|---|---|
| Attribute | the author list (D6), `name`, `aria-label`, non-implicit `role` | all |
| ID | `#id` for `isStableId` | single, container |
| Label | `th`→`td`, `dt`→`dd`, label span → value span, `label[for]`, `aria-labelledby` (thenos `label.ts`) | single (spec rows) |
| Text | exact `normalize-space()` text for controls and labels, never for values | next button, clicks |
| Scoped | own stable class or tag under the nearest named ancestor (≤ 4 up) | all |
| Class | stable classes after the frequency rule (D4) | all |
| Robula+ XPath | breadth-first, ≤ 6 steps, ≤ 2 positions, else nothing (thenos `robula.ts`) | single, container |

The following are removed: `MinimalSelectorStrategy` and `SemanticXPathStrategy` (the class and XPath forms of the
same thing), `PathSelectorStrategy`, the positional `generateXPath` and `generateCssSelector`, and the
`css-selector-generator` dependency (D5). S0's corpus decides whether the library comes back as a last rung, and
only if a target needs it.

**The chain:**
- Survivors are verified: `one` means exactly the target; `items` means exactly the item set.
- They are sorted by cost, and at most one is taken per family until three are taken.
- At least one XPath is included when a non-positional one survives, so CSS and XPath fail independently.
- A spec where nothing below position cost survives is stored with its best entry and marked `fragile` in the
  review step. That makes the weakness visible instead of hiding it behind more fallbacks.

### 4.3 Lists

1. **Items first.** `findList` → `keepItems` → the item set. Candidates for the set are:
   - the author attribute shared by the items (`[data-component-type="s-search-result"]`);
   - `:scope > tag:has(> [author])` for wrappers whose child carries the hook (Walmart's `[data-item-id]`);
   - shared stable classes;
   - `:scope > tag`.

   Each must match the set exactly (D1). The container-relative XPath (D2) is its own family.
2. **Container second.** The container is the nearest ancestor of the items that `selectorsFor(…, expect: 'one')`
   can name without positions. When the list's own parent cannot be named but an ancestor can, the container
   moves up. The item selector stays relative and still matches exactly the items under it. So a container is
   never stored as a path.
3. **Fields:** unchanged pipeline. `nodeStep` uses the shared author list (D6), repeated components become one field
   (D15), and table columns are read by header (D14).

### 4.4 Resolution at run time

There is one `resolve(locator, root)` in `shared/selectors/resolve.ts`, used by `listRun`, `PaginationAction`, both
scroll strategies, `ElementProcessor`, `bulkJob` (serialised as a self-contained function) and the next-button finder.

- **`one`:** the first entry that matches exactly one element. If none does, the first entry matching several,
  taking the first visible match (today's behaviour), and the run reports the drift.
- **`items` inside a container:** the first entry whose matches pass the saved `rowGate` for at least 80 %, so a
  stale selector that matches widgets is skipped. Entries are tried in order, with no count guessing.
- **Container:** the first entry whose element contains at least two items by the item locator.
- **Reporting:** which entry won and whether the primary failed go into the run's stats (`selector_fallback` per
  spec), so History shows a recipe that is running on its fallbacks before it breaks.

### 4.5 Data types

The selector work does not change what is read. The reader's `attr` and `shape` already cover text, URL (`href`),
image (`src`/`srcset`/lazy attributes), date (`datetime`), price, number and rating, `many` arrays (image / link /
text), JSON items (`reader.json`) and tables (`json` + `tabledata`). Two gaps found in this review are fixed in S5:

- **Page Extractor's own type switch** (`ElementProcessor.extract`) reads `innerText`, `href` and `src` itself. It
  should read through `readValue(el, attr)`, the same code the list fields use, so a page element and a list field
  give the same value: lazy `data-src`, `srcset`, `aria-hidden` duplicate prices.
- **Image arrays** take every `img` in the element, including icons. They should use the field reader's `many` src
  rule.

## 5. Phases

| Phase | Deliverable | Done when |
|---|---|---|
| **S0 Corpus** | Commit the Amazon search page, the Walmart search page (9 tiles, sale/range/plain price variants) and the four unused fixtures in `src/test/fixtures/` (bootstrap, tailwind, emotion, walmart-carousel), with annotated targets: container, items, fields, one spec row, next button. A harness pins, per target: the first entry names the target / the exact item set; family; grade; positional entries; chain length; time | The table in §2 is reproduced by a test, and every later phase must move it, never back |
| **S1 Shared rules** | `stability.ts`: one author list, one `isStableId`, the frequency rule, instance-value rules, Tachyons and grid utilities, XPath positions counted as volatile. `xpathLiteral`. `looksLikeXPath` the only sniffer | D4–D8 closed. Walmart's title field is `[data-automation-id="product-title"]`, named Title |
| **S2 Lists** | §4.3: exact-set item candidates, relative XPath, container named without positions, `keepItems`-based heal that is reported and saved | Amazon items: `[data-component-type="s-search-result"]` first. Walmart: a named wrapper selector first. No positional container. Derivation < 150 ms on Amazon |
| **S3 Single elements** | §4.2 generator (port `cost.ts`, `label.ts`, `robula.ts`, `utility.ts` from thenos, trimmed to what is used here). `DetailSelectionStrategy`, `ReferencedView` and the Lab use it. Delete the 7-strategy `generate.ts` and `css-selector-generator` | Corpus: no value inside any selector; no positional first entry where a name exists within two levels; spec rows get the Label family |
| **S4 Controls** | `nextButton.ts` reduced to the four families in D9 plus the existing validator; one resolver for the scroll strategies' load-more | Every next-button candidate parses, including labels with quotes. ≤ 3 stored |
| **S5 Fields, tables, types** | D14, D15, `ElementProcessor` reads through `readValue`, image arrays through the `many` rule | Walmart: one Badges field, a was-price column. A table with an inserted column keeps its values |
| **S6 One shape, one resolver** | `Locator` (§4.1) inside the typed recipe specs, `resolve` (§4.4) everywhere, fallback stats in History. Ships with DB2 (§7), whose migration converts saved recipes. Removes the snapshot filtering bug (D12) by construction | One resolver, one shape; `grep "startsWith('//')"` finds nothing outside `looksLikeXPath` |
| **S7 Clean-up** | knip, delete the leftovers, update the Lab (shows family, grade, and which entry would win) | `npm run deadcode` clean, tests and build green |

The database work (§7) runs alongside: DB1 can start at any time, and DB2 lands together with S6.

S0 comes first: every later change is judged against it. S1 is small and fixes what users see (titles named "Text").
S2 fixes the list item selector, the most important problem. S6 is the widest change, so it comes after the
generators are settled.

**Size:** `generate.ts` + `common.ts` + `nextButton.ts` are 1,490 lines today. The ported generator, list and
control code come to roughly the same, but as one rule set and one ranking instead of four, plus one resolver
instead of four loops.

**Licence:** the thenos files carry AGPL-3.0 headers; crawlPilot is ISC. The code is the same author's, but the
headers should be settled (relicense the ported files, or rewrite them from the plan's rules) before S3 copies
anything.

## 6. Not in scope

- **Fingerprint relocation (Similo-style) and selector health history:** thenos SH0–SH5. The fallback stats in S6
  are the small version that matters here.
- **Learning new card layouts on later pages:** covered by the unmapped count (`structured-columns-plan.md`).
- **Shadow DOM:** CSS works today; XPath cannot reach it, so the chain is CSS-only there.

## 7. Database schema (DB1–DB3)

### 7.1 What is stored today

`shared/db/db-manager.ts` (679 lines, IndexedDB `crawl-pilot` v5) has four stores. The rows below are what is
actually written, not what the types say.

| Store | Written by | Problems |
|---|---|---|
| `recipes` | `useExtractionProcess` (list), `JobRunner` (bulk, metadata) | A **new recipe for every run**, unless it is a rerun. Nothing ever updates one (`updateRecipe` does not exist), so `version` is always 1. `config` is `{ type, urls?, selectors?, options?: Record<string, any> }`, and each run type fills `options` differently:<br>– list: `options.fullSelectors` (picker state with `data.columns`, the six selector fields, `sourceTabId`), plus `selectors` (the container selectors again);<br>– bulk: `options.actions[0] = { type: 'EXTRACT_PAGES', elements, config }`;<br>– metadata: `options` = the run options.<br>`schedule` and `description` are never read |
| `jobs` | Same | `configSnapshot` is a second full copy of the recipe config on every job. Rerun reads the snapshot first, so a fixed recipe never reaches reruns (D12). Readers guess the type from `configSnapshot.type` or `recipe.type`. `logs` and `result.outputFile` are never written |
| `tableData` | `saveExtraction` (6 callers), `JobRunner` | Has an index on `automationId`, a field no longer written; there is no index on `jobId`, which History looks up. Preview tables are real tables named `Preview: …` and flagged in `metadata.isPreview`. `metadata.totalRows` counts rows *sent*, including duplicates the unique index then rejects. The view settings (`columnMerges`, `columnTypes`, `outputMapping`) are mixed into `metadata` with the run facts. `updateTableColumns` still **merges** columns by ID, the step the structured-columns work removed everywhere else |
| `tableRows` | `storeTableRowsBatch`, `storeTableRow` | **Each row is stored twice**: `data`, and again as `metadata.originalData`, which nothing reads. The `dataHash` uniqueness hashes the whole row, including `source_url`, so the same item from two pages is not a duplicate |

There is no schema module. Shapes are `any` at most write sites (`createJob({...} as any)`). The upgrade code is a
chain of `if (!contains)` checks with one version-specific branch, so nothing says what v1–v5 were or how a
stored record gets from one version to the next. Settings, integrations, language and pagination resume state live
in `chrome.storage.local` under four unrelated keys.

### 7.2 Target

One module, `shared/db/`:

- `schema.ts`: the record types, the version, the stores and indexes;
- `migrations.ts`: an ordered list of steps, one per version;
- `recipes.ts`, `jobs.ts`, `tables.ts`: repositories, the only code that knows store names;
- a 20-line `req()` helper that turns an `IDBRequest` into a promise, in place of the 30 hand-written ones.

```ts
// recipes: what to extract. One per thing the user picked, updated in place (edits, heals).
interface Recipe {
    id?: number;
    name: string;
    spec: ListSpec | PageSpec | MetadataSpec;   // discriminated by spec.kind
    rev: number;                                 // bumped on every update
    createdAt: number; updatedAt: number;
}
interface ListSpec {
    kind: 'list';
    startUrl: string;
    lists: { id: string; name: string; container: Locator; items: Locator; fields: ReaderColumn[] }[];
    pagination: { mode: 'none' | 'scroll' | 'next' | 'loadMore'; next?: Locator; maxPages?: number; speed?: PaginationSpeed };
}
interface PageSpec {
    kind: 'page';
    elements: { id: string; name: string; action: 'extract' | 'click'; type: ColumnType; element: Locator; fields?: ReaderColumn[] }[];
    settings: RunSettings;
}
interface MetadataSpec { kind: 'metadata'; options: MetadataExtractOptions }

// jobs: one run of a recipe. Inputs and outcome only; the recipe is referenced, not copied.
interface Job {
    id?: number;
    recipeId: number;
    recipeRev: number;                 // which revision ran (History can show "recipe changed since")
    name: string;
    status: 'running' | 'completed' | 'stopped' | 'failed';
    input: { urls: string[]; maxPages?: number; concurrency?: number };
    stats: RunStats;                   // today's stats object, typed (verdicts, pageStats, coverage, selector fallbacks)
    tableId?: number;
    error?: string;
    createdAt: number; updatedAt: number;
}

// tables: a dataset. Run facts and view settings are separate fields.
interface Table {
    id?: number;
    name: string;
    jobId?: number;
    source: 'list' | 'page' | 'metadata' | 'api' | 'manual';
    sourceUrl: string;
    columns: Column[];                 // replaced as a whole, never merged
    rowCount: number;                  // rows actually stored
    preview: boolean;
    view: { merges: MergeDefinition[]; typed: TypedColumnDef[]; mapping?: OutputMapping };
    createdAt: number; updatedAt: number;
}

// rows: one row, stored once.
interface Row { id?: number; tableId: number; data: Record<string, unknown>; key: string; createdAt: number }
```

**Indexes:**
- `recipes`: `updatedAt`, `spec.kind`.
- `jobs`: `recipeId`, `createdAt`, `status`.
- `tables`: `jobId`, `createdAt`.
- `rows`: `tableId`, and a unique `[tableId, key]`. `key` is the row hash without `source_url` and `recordId`.

**Rules the repositories enforce:**
1. **A run reuses its recipe.** Picking creates the recipe. A run of the same pick or a rerun references it. A
   heal or an edit updates it (`rev + 1`). Reruns always use the current recipe; the job records which `rev`
   ran.
2. **Writes are typed.** Each repository takes the record type, and no `as any` reaches the database. Reads
   validate `spec.kind` and the schema version once, in the repository.
3. **Columns are replaced as a whole.** The run sends its frozen columns, and a table never merges two sets
   (`structured-columns-plan.md`).
4. **`rowCount` is counted** from what the unique index accepted, not from what was sent.
5. **Preview tables are deleted** when the run's final table is written, or when they are promoted (as `JobRunner`
   already does), never left behind.
6. **Migrations** are one function per version in `migrations.ts`, each with a test that opens a database at the
   previous version with fixture records (`fake-indexeddb`) and checks the result.

`chrome.storage.local` keeps per-device settings only (language, integrations, settings, pagination resume
state). Its keys move to one typed `shared/storage.ts`, so each key is defined once with its type.

### 7.3 Migration v5 → v6

This is the only conversion of old data, and nothing reads the old shapes afterwards.

| From | To |
|---|---|
| Each v5 recipe | A `Recipe` with a typed `spec`:<br>– list: `fullSelectors` → `lists[]`, with the six selector fields → `container`/`items` `Locator`s (volatile entries dropped);<br>– bulk: `actions[0].elements` → `elements[]`, `{type, value}[]` → `Locator`;<br>– metadata: as is.<br>`urls` move to each job's `input` |
| Recipes with an identical spec | One recipe; their jobs point to it |
| Each v5 job | `input` from its `configSnapshot`. The snapshot is dropped. `paused` → `stopped` |
| Each `tableData` | `Table` (`metadata.*` split into `preview`, `view`, `source`), stored in `tables` |
| Each `tableRows` record | `Row` in `rows`; `metadata.originalData` dropped, `key` recomputed (a collision is a duplicate and is skipped). `rowCount` is recounted |
| Stores and indexes | `tableData` → `tables` and `tableRows` → `rows` after copying; the `automationId` index is gone |

The migration runs inside `onupgradeneeded`'s version-change transaction, so it is all or nothing: if any step
throws, the database stays at v5.

### 7.4 Phases

| Phase | Deliverable | Done when |
|---|---|---|
| **DB1 Module** | `schema.ts`, `req()`, the three repositories over the **current** stores, every caller moved off `db-manager.ts`. Stop writing `originalData`; fix the `rowCount` count; no merge in `updateTableColumns`; preview tables cleaned up | `db-manager.ts` deleted; no `as any` at a db call; storage per row halved |
| **DB2 Typed recipes (with S6)** | v6 schema, migration v5 → v6 with fixture tests, rule 1 (recipe reuse, `rev`), reruns from the current recipe, History reads `spec.kind` | A v5 database with list, bulk and metadata jobs opens as v6 and every job reruns. One recipe per pick, not per run |
| **DB3 Settings** | `shared/storage.ts` for the `chrome.storage` keys | Each key defined once with its type |

## 8. Progress

| Phase | State | Notes |
|---|---|---|
| S0 | **done** (2026-10-17) | `src/test/corpus`: six pages, `report.json` pinned. Baseline summary: item first entry exact on 5 of 6 pages (Amazon `[data-index]`, 30 for 16); single elements 16 selectors, 9 positional, 5 with an instance value (`[data-item-id=…]`, `[href=…]`), 7 strong; fields 16 of 18 read (Walmart was-price, Amazon price missing). `specs.ts` holds what the picker stores (`listLocators`, `elementLocators`, `controlLocators`) |
| DB1 | **done** (2026-10-17) | `shared/db/` (`schema`, `idb`, `tables`, `jobs`, `index`) replaces `db-manager.ts`. Rows stored once; `totalRows` counted from stored rows; columns replaced, never merged; one loose preview at a time; deleting a job keeps a recipe a rerun still uses; no `as any` at a db call. Duplicates are checked before `add` (fake-indexeddb neither rejects two adds in one transaction nor drops a rejected one). Store names unchanged (v5); DB2 renames them |
| S1 | **done** (2026-10-17) | `stability.ts` holds the shared rules: `AUTHOR_ATTRIBUTES` (now read by `nodeStep`, the namer, every generator and the grader), `isStableId` (underscores and short numbers allowed; generated, GUID-like and 4+ digit ids rejected), instance attributes (any `data-…-id/-sku/-key…`, `href`, `src`) never embedded, `xpathLiteral`, `isUtilityByFrequency` (≥ 12 elements over ≥ 3 tags), `b--*`/`normal`/grid-span utilities, XPath positions in `isVolatileSelector`. One `looksLikeXPath` (7 sniffers removed). The library's whitelist won over its blacklist for every `data-*` part, so `[data-item-id='…']` always passed; it now admits author hooks with stable values only. `src/test/setup.ts` gives jsdom `CSS.escape`. Corpus: instance values 5 → 0; Walmart title `[data-automation-id="product-title"]`, named Title (was `.normal`, "Text"). Positional single selectors 9 → 14: the "strong" ones were unique only through the embedded id, and the library's `:nth-child` chain is what is left (S3). Walmart's item first entry lost its utility class and is now `div:has(…)` (18 for 9): ranking ignores the matched set (D1, S2) |
| S2 | **done** (2026-10-17) | `selectors/list.ts` replaces `common.ts` (`CommonSelectorGenerator`). Items: candidates by cost (author hook 100, identity presence 200–300, child hook `:scope > tag:has(…)` +130, class 400, tag 600; each also as `:scope >`), kept only when they match **exactly** the `keepItems` set; one per family, at most two CSS plus one relative XPath (`./div[@…]`). Container: no positions, cheapest first by `selectorCost` (new in `grade.ts`), one per family, its last step must name it (moves up to 4 levels to an ancestor that can be named; a unique bare tag only when nothing names any level). Picker stores the chains' first CSS / XPath (no positional `generateCssSelector`/`generateXPath` for lists); pagination's heal uses `listLocators`. Corpus: item first entry exact 4 → **6 of 6** (Amazon `div[data-component-type="s-search-result"]`, was `[data-index]` 30/16; Walmart `:scope > div:has([data-test-id="gpt-main"])`); Amazon chain 23 → 3 entries; containers `div.s-main-slot`, `#results` (was `div.row`). Time on Amazon in jsdom 1,050 → ~500 ms, of which `keepItems` ~310 (jsdom has no `checkVisibility`; ~28 ms in Chrome) |
| S3 | **done** (2026-10-17) | `selectors/element.ts` replaces `generate.ts` (7 strategies) and the `css-selector-generator` dependency. Candidates: the element's own names (stable id, author and naming attributes, other stable `data-*`, naming classes and pairs, a unique tag), the same scoped under named ancestors (≤ 7 up), label XPaths (`th`/`dt`/`label`/heading/first cell/“Label:” → the next sibling cell, `label[for]`), and for controls only their text. Every CSS candidate has an XPath twin. Checked in cost order (cost of the target step; scope steps +50 + a tenth; ties: shorter), at most 40 per element; chain = two CSS of different families + one XPath, cheapest first; a path with positions (from the nearest named ancestor that makes it unique) only when nothing names the element. `selectorCost` now prices the target step, not the strongest token anywhere. Not ported: Robula+ (the XPath twins and label/text XPaths cover the corpus). Corpus gains thenos's four product pages (30 targets): first entry names the target 30/30, strong **28/30**, positional 2 (Amazon's expand toggle, Uniqlo's features text; thenos's picker also has nothing better there), spec rows lead with their label 4/4. Listing-page single targets stay positional (14/16): the first card's title has no name but its position or its text, and a value's text never names it. Corpus run ~26 s, mostly jsdom XPath over 1 MB pages |
| S4 | **done** (2026-10-17) | `nextButton.ts` 654 → 300 lines: `XPathGenerator` and `PaginationSelectors` (≈ 40 candidates a pick, `(…)[last()]`/`[1]` positions, every class pair, `//*[@id]//a`) replaced by `nextButtonSelectors`: the clickable ancestor of the pick (a click on an icon inside a link means the link), `elementCandidates(…, { control: true })`, up to two CSS of different families plus one XPath (its text when it has one), nothing with a page number in a quoted value. `NextButtonSelector.find` (visible, enabled, best of several) unchanged. A control may be found with its copies (same text, ≤ 3: a pager above and below the results, a sticky add-to-cart); the bulk click and `resolveFirst` now take the first *rendered* match. Text XPaths cost 300 + length/10 (were priced as a tag). Corpus: Amazon Next `a.s-pagination-next` ‖ `[aria-label="pagination"] a.s-pagination-next` ‖ `//a[normalize-space()="Next"]` (was 27–41 candidates led by `(//a[contains(string(), "Next")])[last()]`); product controls: Uniqlo add-to-cart and Zara colour by their text, Amazon's display toggle `//span[normalize-space()="Display"]` (was a positional path). Products: positional first entries 2 → 1; “names alone” 30 → 28 because two controls are now found with their visible copy |
| S5 | **done** (2026-10-17) | **Tables:** a column's reader stores its header text (`reader.cell`), finds that header's position in each page's table and reads that cell; by position only without a header row; a header missing on a later page reads empty, never a neighbour's cell. **Visual copies:** an `aria-hidden` block that a screen-reader-only element of the row repeats (same digits; Walmart's "Now $519.99 · Was $799.99" and "Price Now $519.99 Was $799.99") is read and the sentence skipped; other `aria-hidden` content as before (Amazon's in-value copies, a "4.5" beside "4.5 out of 5 stars"). A price opened by a word ("Now" $ 519 99) is one value, cents in their own span join as `.99`; "List:" stays a label. **Components:** a site hook repeated inside a card whose text splits into slots (Walmart's `badgeTagComponent`) becomes one many-valued field read whole ("Reduced price; Free shipping, arrives in 3+ days"); a shared wrapper of distinct fields (Amazon's `s-client-side-analytics`) is left alone. **Names:** strike classes as whole words (`font-bold` was "old" → "Was Price"); a card's link text with no heading is its Title. **Page Extractor** links, images and arrays read through `readValue` (absolute, lazy `data-src`, largest `srcset`, de-duplicated). Corpus: fields read 16 → 17 of 18 (Walmart was-price; Amazon's price target has one row); Walmart 20 → 11 columns (Price "Now $519.99"/"$16.97", Was Price, Badge Tag, Product Reviews); Tailwind Title/URL/Price (was Text/URL/Was Price) |
| S6a | **done** (2026-10-18) | `resolve.ts`: `resolveOne` (the entry naming one element, else the first rendered match of an entry matching several), `resolveItems`, `resolveContainer` (the entry whose element holds ≥ 2 of the list's items, so a stale entry matching another element is passed over); each returns which entry answered. Replaces `resolveFirst`/`resolveAll` and the copied loops in `PaginationAction`, both scroll strategies (container and load-more), `ElementProcessor` and the Page Extractor highlights. A page found through a fallback entry or a healed item selector is marked (`PageStat.fallback`) and shown in the job details as "backup selector" |
| DB2 + S6b | **done** (2026-10-18) | Schema v6. **Recipes** hold a typed `spec` (`ListSpec` with `container`/`items` chains, fields and pagination; `PageSpec` with each element's chain and fields; `MetadataSpec`), a `hash` (index) and `rev`: `jobs.saveRecipe` returns the recipe already saved with the same spec (any key order), so running a pick again or a rerun is one recipe; `reviseRecipe` bumps `rev`. **Jobs** hold `recipeId`, `recipeRev`, `input` (urls, maxPages, concurrency), stats and `tableId`; no config copy; statuses `running`/`completed`/`stopped`/`failed`. The page limit is a run input, not part of the spec. `shared/recipes/spec.ts` is the only place picker state and specs meet (`listSpec`/`listRunInput`, `pageSpec`/`pageRunInput`, `chainOf`: de-duplicated, volatile dropped unless nothing else, ≤ 3) and reads v5 configs for the migration. **Reruns** use the recipe as it is now; the details dialog says when it changed since the run. A healed item selector goes first in the recipe's item chain (new revision). **Migration v5 → v6** (one function, inside the version-change transaction, tested on a seeded v5 database): typed specs; identical specs merged (oldest id kept, v5 ids stay valid); each job points at the recipe of the config it actually ran; `paused`/`pending` → `stopped`; `result.tableDataId` → `tableId`; `configSnapshot`, `sourceUrl`, `logs` dropped; an unreadable config keeps the job without a recipe. Indexes: recipes `hash`/`updatedAt` (no `type`), jobs without `sourceUrl`, tables `jobId` (no `automationId`). `filterPersistableChain` removed (`chainOf` does it where chains are saved). **Not done here:** the side panel's in-memory picker state (`SelectorState` with its six selector fields, Page Extractor `{type, value}` lists) keeps its shape and is converted at save and rerun by `spec.ts`; tables and rows keep their v5 store names and shapes (cleaned in DB1) |
| DB3 | **done** (2026-10-19) | `shared/storage.ts`: every `chrome.storage.local` key (`language`, `integrations`, `bulk_extraction_state`, `metadata_extraction_state`, `pagination_state`) defined once with its type; `storage.get/set/remove` are the only access |
| S7 | **done** (2026-10-19) | Selector Lab: a pick shows the chain a Page Extractor pick stores and, for a list item, the container and item chains, each entry's family, grade and matches, and the entry the run's resolver uses on this page ("used now"; a later one means the earlier entries broke). `controlLocators`, `elementLocators`, `specs.ts`, `filterPersistableChain`, `normalizeChain` and the `ChainEntry`/`RawChainEntry` types removed |
| DB v7 | **done** (2026-10-19) | `tableData`/`tableRows` → `tables`/`rows`. `Table`: `source`, `rowCount`, `preview`, `view { merges, typed, mapping }` (no `metadata` bag). `Row`: `tableId`, `data`, `key` (the row without `source_url`/`recordId`, so the same item read on two pages is one row). `tableDataId` → `tableId` everywhere (run-complete messages, `?tableId=` URLs, save options `tableId`/`preview`/`replace`). Migration keeps table ids, copies rows with a cursor, drops repeats under the new key, recounts, deletes the v6 stores; tested from a seeded v5 database (both migrations run) |
| Picker state | **done** (2026-10-19) | The side panel holds what a recipe stores. `ListPick { id, container, items, data, patternFound, count, sourceTabId }` replaces `SelectorState` (six selector fields); `PaginationConfig.next: Chain` replaces `nextButtonSelector(s)`; Page Extractor elements and `ElementDefinition` hold `selectors: Chain` (no `{ type, value }`). The picker reports chains (`container`/`items` for a list, `selectors` for a Next button or a Page Extractor element); `EXECUTE_AUTO_SCROLL` / `EXECUTE_PAGINATION` carry `container`, `items`, `next`/`loadMore`; the resolvers take `string[]`; the selector edit dialog edits a chain; the Page Extractor's edit form edits the chain one selector per line. The list preview reads the rows the run reads (through the stored chains). `recipes/spec.ts` maps picks ↔ specs directly; it alone reads v5 shapes, for the migration |
