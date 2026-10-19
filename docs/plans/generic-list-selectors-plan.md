# CrawlPilot: generic list selectors: items, fields and values without site rules

Branch base: `feat/scraper-toolkit`, after the selector plan S0–S7 (`docs/plans/selector-reliability-plan.md`, done).

**Why.** `docs/plans/list-extraction-reliability-plan.md` measured the List Extractor on BestBuy, Walmart, Amazon and
Home Depot. It found 10 failure patterns, each on at least two sites (its §1.5). This plan is the *design* that fixes
them: how a list's selectors, its fields and their values are built. The rule throughout is **no site rules**: no
hostnames, no site class names, no per-site regexes. Everything is decided from the page's structure, its accessible
text and the values themselves.

The reliability plan's phases stay the delivery plan:
- L0 (scorecard), L2 (scroll and late content), L5 (joined data) and L6 (health) are unchanged;
- this design is what L1, L3 and L4 build.

---

## 1. What changes, in one table

| | Today | This design |
|---|---|---|
| A list is | a container and its direct children (`findList`: the best-scoring ancestor with like children) | **a set of items**: every element on the page with the same item fingerprint, wherever it sits (split grids, sibling rows, virtual lists) |
| The stored list | container chain + `:scope > …` item chain; the container may be positional (`div:nth-of-type(5) > ul`) | **scope + item selector**: a named region (or the document) and an item selector that matches exactly the item set inside it, never positional |
| Choosing the list | the first good ancestor of the click | **every item set near the click, ranked**: the main results first, sponsored and promo sets labelled as alternatives |
| A field is | a row-relative selector + one attribute (`text`, `href`, `aria-label` only on empty elements…) | **a locator + a source + a parser + a meaning**: where, what to read, how to turn it into a typed value, and what it is |
| What a field may read | visible text, links, images, some labels | **every source a row has**: visible text, accessible text (screen-reader-only, found by rendering, not class names), `aria-label`, `title`, `alt`, `data-*`, hidden subtrees (opt-in), JSON items |
| A value that holds several (`"4.4 out of 5 Stars. 510 reviews"`) | one text column, or pruned as a composite | **template induction**: split into slots across rows, one typed column per slot, named by the words around it |
| Names | class and test-id words ("Ratings Reviews", "Attribute Brandname") | **meanings** from a generic lexicon (`rating`, `review_count`, `brand`), then labels, then units; class words last |
| Same meaning in several layouts | separate columns (Walmart price ×4) | **one field with alternates**, joined by meaning |
| Checking | a preview the user eyeballs | **expectations stored with the recipe** (item count range, fill rate and parse rate per field, ID uniqueness), checked on every page, healed by meaning |

## 2. Lists: item sets, not containers

### 2.1 Finding the item set

From the clicked element *e*:

1. **Candidate item roots.** Each ancestor *a* of *e*, up to 16 levels, is a candidate item root.
2. **Item fingerprint** of *a*:
   - its tag and its stable naming tokens: author attributes and naming classes from `shared/selectors/stability.ts`;
     hashed and utility classes excluded;
   - plus its **row profile**: the set of atom signatures, the same profile `fields/gate.ts` uses.
3. **Matches.** Every element in the document with the same tag and naming tokens is a candidate, found with one
   `querySelectorAll` built from the fingerprint. Those whose row profile overlaps *a*'s (Jaccard ≥ 0.5) are the
   matches.
4. **Constraints.** Matches don't contain each other, and are of similar size (text length and box within 4×).
   Placeholders (same fingerprint, no content yet) are kept and marked `pending`.
5. **Score per candidate level:**
   - `items × richness`, where richness is the median number of distinct atom kinds per item;
   - a penalty for levels whose items are single atoms (a list of links, not records);
   - a penalty when the matches span unrelated page regions (`header`, `nav`, `footer`, `aside`).
6. **The best level is the item set.** Matching anywhere in the document is what joins BestBuy's six row `UL`s into
   one set of 18 without knowing they are rows.

This replaces `findList`'s sibling-only test. `keepItems`/`gateRows` still drop headers and widgets inside the set.

### 2.2 Several sets near the click

A page often has more than one set with the same fingerprint family: Walmart's sponsored brand shelf above
`item-stack`, BestBuy's sponsored carousel above the grid. Within the chosen set, matches are grouped by **region**:
their lowest common ancestor that holds no other group. Each group is labelled from generic signals:

- **Sponsored or promo:** a region whose own text, `aria-label` or `data-*` names contain *sponsored / ad /
  advertisement / promoted* (a word list, not site names). A horizontal carousel (items in one row, overflow
  hidden, prev/next controls) is also a sign.
- **Main results:** the largest group; the one next to a results count ("7047 results", "(7047)") or the page's `h1`;
  the one with pagination after it.

The picker selects the main group by default and lists the others: "Main results · 18 items" and "Sponsored · 3
items". The user can switch with one click. The click itself picks the *fingerprint*, not the group, so clicking a
sponsored card still offers the main results.

### 2.3 Storing it

```ts
interface ListSpec {
  /** Where the items are: a named region, or none (the whole document). Never positional. */
  scope: Chain | null;
  /** Matches exactly the item set inside the scope (all groups the user kept). Descendant, not `:scope >`. */
  items: Chain;
  /** Groups the user left out (sponsored): an exclusion selector each, applied after `items`. */
  exclude?: Chain[];
  /** What a not-yet-rendered item looks like: same fingerprint, no content. */
  pending?: { minAtoms: number };
  expect: ListExpectations;           // §5
}
```

**Item selector generation** reuses `selectors/list.ts`'s cost-ranked families (author hook, identity presence such as
`[data-product-id]`, child hook `:has(…)`, class, tag). One change: candidates are tested against the item set
**document-wide** (or inside `scope`), not only under one container.

**Scope** is the nearest *named* common ancestor of the kept groups:
- an author attribute or a naming class, as `list.ts` already names containers;
- `null` when none exists: the item selector alone is unique enough, which is common, because identity attributes
  (`[data-item-id]`, `[data-asin]`) are rare outside items.

No `nth-of-type` is ever produced. A position-only path is impossible by construction: if nothing names a scope,
there is no scope.

**Run-time resolution** (`shared/selectors/resolve.ts`): `resolveItems(spec)` = `items` within `scope`, minus
`exclude`, in document order. Auto-scroll and pagination count **this set** (the reliability plan's L2). That is
what makes scrolling a split or virtual grid work.

## 3. Fields: locator + source + parser + meaning

### 3.1 The inventory of a row

`collectAtoms` (`atoms.ts`) becomes an inventory of **sources** per element:

| Source | Read from | Notes |
|---|---|---|
| `visible` | rendered text (today's `atomText`) | |
| `accessible` | text a screen reader gets but the eye doesn't | Found by rendering: clipped (`clip: rect(0…)`, `clip-path: inset(50%)`), ≤ 1×1 px and absolutely positioned. Not by class names: `sr-only` is only a fallback for captures without styles, since hashed classes (`ld_Ec`, `w_iUH7`) defeat it |
| `label` | `aria-label`, `title`, `alt` | **even when the element has text**; kept when it adds information (more digits or words than the text) |
| `data` | `data-*` and `itemprop`/`content` values | kept when they vary across rows and look like values (an ID, a number, a short phrase); never constants, JSON blobs or tracking tokens |
| `hidden` | text in `display:none` / `hidden` subtrees | marked; offered, never selected silently |
| `href`, `src` | as today | URLs pass through §3.4 cleaning |
| `json` | the row's JSON item (`structuredRows.ts`) | unchanged; matched by ID as well (L5) |

The **visual copy** logic (`visualCopies`) stays: an `aria-hidden` block repeated by an accessible sentence. Neither
is discarded any more; both enter the inventory, and §3.3 decides what each is.

### 3.2 Locators

A field's locator is today's row-relative chain (`fields/group.ts` → `FieldReader.chain`), with two generic
additions:

- **Label-anchored locators.** When a value sits next to a label whose text is the same in every row, the locator
  is the label, not a path:
  - "Model#", "Delivery:", "Display Size", a `dt`;
  - for example `.//*[normalize-space()="Delivery:"]/following-sibling::*[1]`, or the slot after the label inside one
    text (§3.3).
  - `selectors/element.ts` already builds label XPaths for single elements; this reuses them row-relative.
  - A label locator survives layout changes that break paths, and names the column for free.
- **Meaning-anchored alternates.** Fields with the same meaning that never share a row become one field whose
  `alternates` hold each layout's locator (the mechanism already exists in `FieldReader.alternates`). This is
  Walmart's 4 price components, by meaning, where today only equal values join.

Positions are used only for a slot of a repeated node (`slot` + `template`, as today), never for the row itself.

### 3.3 Template induction: one value, several fields

The general tool behind most of the reported failures. For a textual field, take its values across all sampled
rows and tokenise them into numbers, currency amounts, words and punctuation:

```
"4.4 out of 5 Stars. 510 reviews"     → [NUM] out of 5 Stars . [NUM] reviews
"(4.4 / 1949)"                        → ( [NUM] / [NUM] )
"Model# H300MTS"                      → Model # [CODE]
"At Your Store: 16 in stock"          → At Your Store : [NUM] in stock
"current price Now $199.00, Was $259.00" → current price Now [MONEY] , Was [MONEY]
"Display Size; 14 inches; RAM; 4 GB"  → (label ; value ;)× pairs
```

**Align the token sequences across rows** (longest common subsequence of the constant tokens):
- tokens equal in ≥ 80% of rows are the **template**;
- the rest are **slots**.

Each slot with ≥ 50% fill becomes a derived field:
- its type comes from the slot's tokens (`NUM`, `MONEY`, `CODE`, `DATE`, words);
- its **context words** are the template tokens next to it ("out of 5 Stars" before → rating; "reviews" after →
  review count; "Was" before → was price; "Model #" before → model; "in stock" after → stock count).

**Repeated pairs** (`label ; value ;` repeated, or alternating label/value elements in the row) become one field per
label: the labels are the template tokens, and the values the slots.

**The original whole-text field is kept only if no slot covers it.** This replaces `dropComposites`
(`fields/prune.ts`) removing the richer field. A composite is now *split*, not deleted.

This is one algorithm, with no regex per site. It also reads the reliability plan's "Typical: $47.99" vs "List:
$59.99": two templates, `Typical: [MONEY]` and `List: [MONEY]`, so two meanings.

### 3.4 Parsers and cleaning

Every field has a type and a parser, chosen from its values:

| Type | Parses | Stored |
|---|---|---|
| `money` | currency symbol or code, thousands and decimal separators by locale, cents in a separate element (already joined), ranges "from $X – $Y" (min/max), unit "/ounce" (unit price) | number + currency; the raw text kept |
| `rating` | a number ≤ the scale; scale from "out of 5", or from stars | number (and scale) |
| `count` | "1,949", "(27.9K)", "1.2M", "500+" | number; an approximate flag for K/M/+ |
| `percent`, `date`, `duration`, `code` | as named | typed |
| `url` | absolute; tracker unwrapping: a same-site URL inside `rd`, `url`, `u`, `redirect`, `dest`, `target` parameters; fragments and tracking parameters (`utm_*`, `ref`, `pd_rd_*`, …) dropped for identity (`cleanUrl`) | clean URL |
| `text` | prefix or suffix equal to another field's value removed (a hidden badge before a title) | text |

**Precision wins when two sources give the same meaning.** An exact count beats an approximate one ("27,976" over
"27.9K"), a decimal rating beats a rounded star label (4.4 over "4.5 Stars"), and a structured source beats a parsed
one.

### 3.5 Meanings and names

A **generic lexicon** maps evidence to about 30 meanings common to listings:

- title, url, image, gallery;
- brand, model, sku/product_id;
- price, was_price, typical_price, unit_price, price_min/max, savings, currency;
- rating, review_count;
- stock, delivery, pickup, shipping;
- badge(s), sponsored, seller;
- size/colour options, specs (label/value);
- sales volume, purchase limit.

Evidence, strongest first:
1. the value's **type** and **template context words** (§3.3);
2. **label text** in the row (`Was`, `Model#`, `Delivery:`);
3. **accessible names** (`aria-label` words);
4. **schema words** in attributes (`itemprop="price"`, `data-*="rating"`);
5. class and test-id words, as today's `fields/name.ts`, now the last resort.

The lexicon is word lists per meaning, with English first and other languages added as lists, not code. A field
with no meaning keeps a name from evidence as today, never "Text 2". If nothing names it, it is offered collapsed
under "Other values".

**One meaning, one column.** Fields that share a meaning and never share a row join (§3.2). Badges at different
positions form one `badges` list. Two fields with one meaning that *do* share a row keep distinct names:
`price`/`price_2` becomes `price`/`was_price` when a label or strike style tells them apart, and otherwise stays
numbered and is flagged in the review step.

### 3.6 The stored field

```ts
interface FieldSpec {                       // successor of FieldReader (FIELD_SCHEMA_VERSION 3)
  id: string;                               // slug of the meaning or name; stable across runs
  meaning?: Meaning;                        // §3.5
  locator: { chain: Chain; slot?: number; template?: Shape[]; label?: string }; // §3.2
  source: 'visible' | 'accessible' | 'label' | 'data' | 'hidden' | 'href' | 'src' | 'json';
  attr?: string;                            // for label/data sources
  derive?: { template: string[]; slot: number };   // §3.3: which slot of the source's template
  type: ValueType; parse?: ParseOptions;    // §3.4
  alternates?: Omit<FieldSpec, 'alternates'>[];    // other layouts, same meaning
  expect: FieldExpectations;                // §5
}
```

Version 2 readers keep working: a v2 column is a v3 field with `source` taken from `attr`, no `derive`, type from
`shape` and no meaning. No saved recipe changes, and no legacy code path is kept beyond that mapping.

## 4. Readiness: reading a row when it's complete

This is generic, as specified in the reliability plan's L2. A row is **pending** while:
- it matches the list's `pending` fingerprint;
- it contains a busy marker (`aria-busy="true"`, `data-loading="true"`, class words
  `skeleton|shimmer|placeholder|loading`);
- or a field that had a value in ≥ 90% of preview rows reads empty while its element exists and is empty.

Pending rows are read again after the next settle (quiet for 300 ms, at most 2 s). They are read as they are after 3
settles, with a warning.

## 5. Expectations, checks and heal

Each list and field stores what it looked like when it was built:

```ts
interface ListExpectations { items: [min: number, max: number]; groups: number; idField?: string }
interface FieldExpectations { fill: number; parse: number; distinct?: number; pattern?: string /* template */ }
```

- **At build time** the picker shows these and flags weak spots:
  - an ID field that isn't unique;
  - a numeric field that parses in < 90% of rows;
  - a field filled in < 30% of rows (it is offered, not selected).
- **On every page of a run** (the reliability plan's L6):

  | Check | What happens |
  |---|---|
  | Item count outside the range | a warning, and the item set is re-found from the fingerprint |
  | A field's fill or parse rate falls by > 30 points | the field is **healed by meaning**: re-run §3 on this page's rows and take the field with the same meaning and template; its locator replaces the broken one for this run, and is offered as the new primary |
  | Healing fails | the cells are empty and the run reports which field broke on which page |

Heal by meaning is generic. Because a field knows it is `review_count` with template `[NUM] reviews`, it can be found
again after a redesign, whatever its new path is.

## 6. Generality: how we know it isn't fitted to four sites

- **Development set:** the four reported sites (the reliability plan's L0 captures): BestBuy, Walmart, Amazon (search
  and category), Home Depot.
- **Held-out set, never tuned on:** captured once, before any tuning, and scored only at phase ends. Six listings of
  other shapes:
  - a fashion grid with swatches (Zalando or COS, already in the corpus);
  - a marketplace (eBay);
  - a handmade marketplace (Etsy);
  - a furniture grid (IKEA);
  - a non-English store (a German or Japanese retailer);
  - a non-retail listing (a jobs board or real-estate results).
- **Rules for changes:**
  - any change that names a hostname, a site's class or test id, or a site-shaped regex is rejected in review;
  - lexicon words are general vocabulary, not copied site strings.
- **Scorecard per site:** items, fields (with meaning), value accuracy, typed rate, noise columns. The held-out mean
  must rise with each phase and never drop by more than 2 points on any held-out site.

## 7. Phases

These map to the reliability plan's L1, L3 and L4; that plan's L0 scorecard comes first.

| Phase | Builds | Done when (dev set; held-out must not regress) |
|---|---|---|
| **GS1** Item sets | §2.1–2.3: fingerprint matching, groups and labels, `ListSpec` with scope/items/exclude, never positional; resolver, scroll and pagination counting the set | BestBuy 18/18 in one set; Walmart and BestBuy sponsored shelves offered separately; first-click on Walmart's sponsored shelf offers the 50 results; Amazon and Home Depot unchanged |
| **GS2** Source inventory | §3.1: accessible text by rendering, labels on elements with text, `data-*` values, hidden subtrees (opt-in) | Every value in the reliability plan's §1 truth tables appears in some row's inventory |
| **GS3** Template induction | §3.3: tokenise, align, slots and context words, repeated pairs; split composites instead of pruning | Ratings and review counts on all four sites; Home Depot model, stock and delivery; Amazon specs as columns |
| **GS4** Types, precision, cleaning | §3.4: parsers, precision ranking, tracker unwrapping, prefix stripping | Every numeric field typed; Amazon exact review counts; Home Depot rating 4.4; Walmart product URLs and clean titles |
| **GS5** Meanings and joining | §3.5: lexicon, naming order, join by meaning, badge lists | Walmart one price column; Amazon category ≤ 14 columns; no "Text N" or class-word names on the dev set |
| **GS6** Field spec v3 | §3.6: `FieldSpec`, label locators, v2 mapping | Saved v2 recipes run unchanged; new picks save v3 |
| **GS7** Expectations and heal | §4–5: readiness, stored expectations, heal by meaning | A broken locator (a renamed class in a fixture) is healed on the first page; a skeleton row is re-read |

Each phase ends with the held-out score in §8.

## 8. Risks

| Risk | Guard |
|---|---|
| Document-wide matching joins unrelated sets (a "recently viewed" strip with the same card component) | The region grouping (§2.2) keeps them apart; the main group is chosen by size and results-count proximity; the user sees the groups |
| Template induction over-splits free text (titles, descriptions) | Only for fields whose constant tokens cover ≥ 30% of the text and appear in ≥ 80% of rows; titles never qualify |
| `data-*` and labels add noise | Varying, mostly filled, value-shaped only; the scorecard counts noise columns |
| Rendering checks (accessible text, readiness) cost time on big pages | Computed style only for candidate elements (small, absolutely positioned); measured on the corpus, within the S2 timing budget |
| Lexicon drift towards site strings | Review rule (§6); the held-out set catches it |
| Changing field IDs breaks saved recipes | IDs of existing recipes stay; v2 → v3 mapping (§3.6) |

## 9. Progress

| Phase | Status |
|---|---|
| GS1 | Done: `content/services/extraction/itemSets.ts` (fingerprint from the clicked item by majority, else the named tile inside bare cells; document-wide matches; groups by region with alike parents within 3 levels merged; kinds results/sponsored/carousel; headings), used by `ListSelectionStrategy` on hover and click; alternatives reported (`ListAlternative`) and switchable in `SelectorCard` (`READ_LIST`); placeholders kept as items (`keepItems`); descendant item chains (`.//x`). Scorecard: BestBuy 4 → 18/18 picked (9/9 rendered matched); Walmart 50 picks with 6 non-products → 45/45; the first click on Walmart's sponsored shelf → the 45 results with "Sponsored · 3 items" offered. e2e harness now offline (non-local requests aborted). Not done: offering the results when the sponsored list is a *different* component (BestBuy's carousel), which needs content-based similarity across fingerprints; `ListSpec` with `exclude` (the chosen group's chains are stored as today's container + items) |
| GS2–GS7 | Not started. The held-out captures (§6) are still to do |
