# CrawlPilot: List Extractor reliability: all the items, all the attributes

Branch base: `feat/scraper-toolkit`. Reported on a BestBuy results page:
- only 3 items extracted;
- scrolling didn't load more;
- review counts wrong;
- few attributes, and some columns merged.

This plan starts from what the code does on that page, then validates it on Walmart (§1.2), Amazon (§1.3) and Home
Depot (§1.4), four of the most complex retail listings. It finds the causes they share (§1.5) and fixes those,
not any one site. The patterns behind the failure are common on retail sites:
- a grid split into rows;
- placeholders filled in on scroll;
- values that only screen readers get;
- prices that load after the cards.

**How L1, L3 and L4 are built, generically (no site rules):** `docs/plans/generic-list-selectors-plan.md` covers item
sets instead of containers, a source inventory, template induction, typed parsers, meanings, and heal by meaning. It
also adds a held-out set of sites to prove the fixes generalise.

Recommended order: **L0 → L1 → L2 → L3 → L4 → L5 → L6.** L1 and L2 bring back the missing items, and L3 and L4 the
missing and wrong attributes. L0 comes first so every fix is measured on real pages.

---

## 1. What happens on BestBuy today

Measured 2026-10-19 on `bestbuy.com/site/searchpage.jsp?st=laptop`, captured with headless Chromium. The real list
picker was run on the capture through the e2e harness.

**Picking a product in the main results:**

| | Result | What it should be |
|---|---|---|
| Items | **4** | 18 cards on the page (9 rendered, 9 placeholders), more with "Show more" |
| Container | `[data-show-more-virtual-list="grid"] > div:nth-of-type(5) > ul` | the grid: one list across all its rows |
| Columns | Image, Image 2, Images, URL, Title, URL (Stats), Ratings Reviews, Common Carousel, Reviews | title, url, image, brand, price, was price, savings, rating, review count, SKU, badge |
| Rating | `4.7` under "Ratings Reviews" | `rating = 4.7` |
| Review count | `"(273 reviews)"` in a *number* column | `review_count = 273` |
| Price | missing | `$549.99` (the price block was still a loading skeleton) |
| SKU | missing | `6668500` (`data-product-id` on the card) |
| Badge | missing | "Core essentials PC" (inside a `<button>`) |

**Picking a product in the sponsored carousel above the grid:** 4 items, which is probably the "only 3" the user saw.
The carousel shows 3 at a time. Its columns are Image, URL, Title, Reviews `"(109)"`, Price and Was Price, and there is
**no rating at all**. The rating 4.5 is only in the screen-reader sentence "Rating 4.5 out of 5 stars with 109
reviews", and that sentence is dropped.

### 1.2 Walmart

Two pages, the real picker on each:
- the corpus capture `walmart-search` (cars, `curl`, 9 server-rendered tiles);
- a live capture of `walmart.com/search?q=laptop` (2026-10-19, headed Chrome after scrolling, 58 tiles; headless
  gets "Robot or human?").

The "truth" counts below are what the tiles' own hidden text holds.

**Clicking the first product title on the live page picks a sponsored shelf, not the results:**

| | Result | Truth |
|---|---|---|
| Items | **3** (`[data-testid="products"]`, the "sb-search-top" sponsored brand shelf) | 50 results in `[data-testid="item-stack"]` |
| Price | `"current price Now $199.00, Was $259.00"`: the whole screen-reader sentence, as *text* | `price 199.00`, `was_price 259.00` |
| Rating, review count | none | in 36 of the first 40 tiles |

**Picking a product inside the main grid gets the list right (50 children, 44 products), but the attributes are
wrong.** The numbers are rows filled out of 44:

| Field | Extracted | Truth | Why |
|---|---|---|---|
| Price | split over **4 columns**: Price 27, Ugpp Price 17, Unified Global Product Price 17, Ugpp Range Price 9 | one price on every tile | Card layouts put the price in different components; fields are merged by value and position, not by meaning |
| Rating | 43, as text `"4.4 out of 5 stars"` in a *number* column | 4.4 | Not parsed |
| Review count | **2** ("Product Reviews") | ~40 | The hidden sentence `"4.4 out of 5 Stars. 510 reviews"` *is* read as an atom, then dropped by the field pipeline. My reading is that it is dropped as a composite of the rating, by `dropComposites` in `fields/prune.ts` |
| Title | `"Overall pick, Acer Chromebook 315…"` | `"Acer Chromebook 315…"` | The `h3` holds a hidden badge prefix, which is also its own field |
| URL | `https://www.walmart.com/sp/track?…&rd=https%3A%2F%2Fwww.walmart.com%2Fip%2F…` | the product URL inside `rd` | Sponsored tiles link through a click tracker |
| Delivery | fragments `"Delivery as soon as"`, `"3pm"`, `"tomorrow"` in an "Options" list | `"Delivery as soon as 3pm"`, `"Free pickup tomorrow"` | Phrase pieces in separate spans are read one by one |
| Noise | "Dynamic Hidden", "Dynamic", "Links", "URL (Swatch)", "URL 2", "Title 2" (= "Options"), "Text" | none | Names come from class and test-id words; one-off widgets survive pruning |

On the older `walmart-search` capture, the same pick reads 9/9 items but has review count 3/9, two rating columns
("Rating", "Rating 2"), and the same 4-way price split (3 of the variants).

**Walmart's screen-reader text has no telltale class.** It uses hashed classes (`ld_Ec`, `w_iUH7`), so
`SCREEN_READER_ONLY` in `atoms.ts` never recognises it. Only its computed style shows it: clipped, 1 px,
absolutely positioned.

### 1.3 Amazon

The corpus captures `amazon-search` (laptops, 16 results) and `amazon-category` (baby toys, 24 results); the real
picker, clicking a result title. The capture had no buy-box prices for most results (the item didn't ship to the
capture's region), so price coverage isn't judged here.

| | `amazon-search` | `amazon-category` | What the page holds |
|---|---|---|---|
| Items | 16/16 ✓ | 24/24 ✓ | |
| Rating | `"4.5 out of 5 stars"`, text in a *number* column | same | 4.5 (`.a-icon-alt`, visually hidden) |
| Review count | `"(1K)"`, `"(115)"` | `"(27.9K)"` | **exact** in the link's `aria-label`: `"27,976 ratings"` |
| Specs | one *Options* list: `"Display Size; 14 inches; Disk Size; 128 GB; RAM; 4 GB; Operating System; Windows 11 Home"` | | 4 label/value pairs: `display_size`, `disk_size`, `ram`, `operating_system` |
| Was price | | 3 filled | 2 kinds: `"Typical: $47.99"` and `"List: $59.99"` (in `.a-offscreen`), plus unit prices `"($1.23/ounce)"` |
| Columns | 9 | **24**: Badge … Badge 7, Text, Text 2, Price 2, URL 2, Links, Image 2 | ~12 |

### 1.4 Home Depot

A saved `homedepot.com` power-tools listing (12 products, provided as `homedepot.html`); the real picker, clicking a
product title. Automated capture gets Home Depot's "Oops!! Something went wrong" page unless the browser's
automation flags are off.

| | Result | What the page holds |
|---|---|---|
| Items | 12/12 ✓ (`#product-results-pods-1`) | |
| Rating | `"4.5 Stars"` (the star icons' `aria-label`, rounded to half stars) | **4.4**, in `"(4.4 / 1949)"` |
| Review count | none: `"(4.4 / 1949)"` lands in a column named "Text" | 1949 |
| Model | `"Model# H300MTS"` in "Text 2" | `model = H300MTS` |
| Stock, delivery | one *Details* list: `"At Your Store:; 16 in stock. Not eligible…; Delivery:"` (the delivery value is lost) | `store_stock = 16`, `delivery = Unavailable in Guam` |
| Brand, title | "Attribute Brandname", "Attribute Product" | `brand`, `title` |
| Purchase limit | `"Limit 5 per order"` named "Sales Volume" | `purchase_limit` |
| Product ID | none | `data-product-id="331027272"` |
| Price | `"$249.00"` ✓ (the screen-reader `"."` between `249` and `00` joins correctly) | |

### 1.5 The same failures on every site

| Pattern | BestBuy | Walmart | Amazon | Home Depot | Fixed in |
|---|---|---|---|---|---|
| Wrong or partial list (split grid, sponsored block first) | ✗ 4/18 | ✗ 3/50 on first click | ✓ | ✓ | L1 |
| Lazy or late items and values (placeholders, skeletons) | ✗ | (lazy tiles) | ✓ | ✓ | L2 |
| The value is only in hidden text (screen-reader text, `aria-label`, `title`) | ✗ rating | ✗ review count, price | ✗ exact review count | ✗ precise rating | L3 |
| Hidden sentences or composites not parsed into parts | ✗ | ✗ `"4.4 out of 5 Stars. 510 reviews"` | | ✗ `"(4.4 / 1949)"` | L3 |
| Label/value pairs not split into columns | | | ✗ specs | ✗ Model#, stock, delivery | L3 |
| IDs in `data-*` not read | ✗ `data-product-id` | ✗ `data-item-id` | ✗ `data-asin` | ✗ `data-product-id` | L3 |
| Numbers kept as text (`"4.5 out of 5 stars"`, `"(1K)"`) | ✗ | ✗ | ✗ | ✗ | L4 |
| One meaning split over many columns | | ✗ price ×4 | ✗ Badge ×7 | | L4 |
| Names from class or test-id words | ✗ "Ratings Reviews" | ✗ "Dynamic Hidden" | ✗ "Differentiators" | ✗ "Attribute Brandname" | L4 |
| Tracker URLs, prefixed titles, phrase fragments | | ✗ | (sponsored `/sspa/click`) | | L4 |

Every row is a pattern, not a site: each appears on at least two of the four, and none needs a site rule to fix.

## 2. Causes, in the code

| # | Cause | Where | Effect |
|---|---|---|---|
| C1 | **A list split across containers, or the wrong list.** BestBuy renders its grid as one `<ul class="product-grid-view-container">` per visual row (2–4 cards each). `findList` scores each ancestor that has like children, and a single row `UL` wins: +20 for `UL`, +15 for the `grid` class, against the wrapper's 6 row `div`s | `content/services/extraction/items.ts` (`findList`, `listScore`) | BestBuy: 4 of 18 items, and the container selector is positional (`div:nth-of-type(5)`), so it breaks on the next page. Walmart: the first product click lands in a 3-item sponsored shelf above the 50 results |
| C2 | **Scroll watches the wrong container.** Auto-scroll counts new items inside the picked container. A row never grows, so it stops. Placeholders (`li[data-observer-target]` with no content) fill in only when each comes into view | `content/features/autoscroll/MutationAwareScrollStrategy.ts`, `IndexedScrollStrategy.ts` | "Scroll not working" |
| C3 | **Late content is read too early.** The price block is a skeleton (`skeleton-product-buying-options`, `data-loading="true"`) when the row is read. Nothing waits for it or reads the row again | `fields/read.ts` (`readRow`), the pick preview, auto-scroll and pagination reads | No price on most rows |
| C4 | **Screen-reader text treated as noise.** When an `aria-hidden` copy of some numbers exists, the screen-reader sentence is dropped (`visualCopies`). The sentence is often the only place the value is labelled ("Rating 4.5 out of 5 stars with 109 reviews", "The price was $849.99"), and sometimes the only place a value exists at all (the carousel's rating) | `content/services/extraction/atoms.ts` (`visualCopies`, `scanAtoms`) | Lost ratings; values with no meaning attached |
| C5 | **Only text, links, images and a few attributes are read.** `data-product-id`, `data-sku-id`, `data-price`, `itemprop`/`content` and the full `title` of a line-clamped heading are not candidates. Text inside buttons is skipped wholesale, which drops badges along with "Add to cart" | `atoms.ts` (`AtomAttr`, `addInner`, `SKIP`) | No SKU or ID column (the best key for dedupe and reruns); badges lost |
| C6 | **Hidden content is dropped entirely.** `isHidden` skips `display:none`/`hidden` subtrees: closed variant pickers, collapsed specs, "more offers". Some sites keep real attributes there | `atoms.ts` (`isHidden` in `walk`) | Fewer attributes than the page holds |
| C7 | **Values aren't typed when read.** A column inferred as a number keeps `"(273 reviews)"`. Names come from class words ("Ratings Reviews", "Common Carousel"), not from what the value is | `fields/name.ts`, `shared/extraction/shape.ts` | Wrong and odd columns. "Merged" columns are likely stage 3 joining fields that never share a row (`fields/merge.ts`); this needs a case on the corpus |
| C8 | **Prices loaded by API aren't joined.** BestBuy has no JSON-LD or `__NEXT_DATA__` with the products; prices come from XHR. `structuredRows.ts` supports `api` sources (`NetworkRelay`), but rows are matched by URL or name only, not by a SKU | `content/services/extraction/structuredRows.ts` | Prices missing even when the API returned them |
| C10 | **Same meaning, many columns.** One value in different card layouts (Walmart's 4 price components) stays split, because stage 3 merges by equal values and positions. On BestBuy, values that do differ get merged | `fields/merge.ts`, `fields/name.ts` | Price spread over 4 half-empty columns |
| C11 | **The richest value is pruned.** A hidden sentence that holds several values ("4.4 out of 5 Stars. 510 reviews") looks like other fields glued together and is removed before its parts are taken out | `fields/prune.ts` (`dropComposites`) | Review counts lost on Walmart (2/44) |
| C12 | **Screen-reader text found by class name only.** `SCREEN_READER_ONLY` matches `sr-only`, `visually-hidden`, `a11y`…. Hashed CSS (Walmart `ld_Ec`/`w_iUH7`, CSS-in-JS sites) is missed, so these sentences are treated as plain visible text: neither parsed nor paired with their visual copy | `atoms.ts` (`isScreenReaderOnly`, `SCREEN_READER_CANDIDATES`) | Hidden prices and ratings read as raw sentences ("current price Now $199.00, Was $259.00") |
| C13 | **Values polluted by neighbours or trackers:** a hidden badge prefixed to the title; click-tracker URLs instead of product URLs; phrase fragments split | `atoms.ts` (`atomText`), `fields/component.ts` | Wrong titles, unusable URLs, broken delivery text |
| C14 | **Labels read only from empty elements.** `aria-label`/`title` are read only when the element has no text, so a link showing `"(27.9K)"` hides its exact `"27,976 ratings"`, and rounded star labels (`"4.5 Stars"`) win over precise values elsewhere | `atoms.ts` (`addInner`) | Approximate review counts and ratings |
| C15 | **Label/value pairs read as one list.** Spec chips ("Display Size" "14 inches" …), "Model# H300MTS" and "At Your Store: 16 in stock" become one text array or one unlabelled column | `fields/group.ts` (`many`), `fields/component.ts` | Structured attributes lost: the most valuable columns on spec-heavy sites |
| C9 | **Nothing notices a bad run.** A pick of 4 items on a page of 18, or a price column empty on every page, raises no warning | picker preview, `JobRunner`, `shared/listing/runStats.ts` | The user finds out from the exported file |

## 3. Phases

### L0: a listing scorecard on real pages (tests first)

- **Recapture BestBuy** per the corpus rules (`src/test/fixtures/corpus/README.md`):
  - headed Chrome;
  - scroll so every placeholder renders and every price block leaves its skeleton;
  - strip scripts and styles.
- **Recapture Walmart** with headed Chrome after scrolling, to replace the 9-tile `curl` capture. It has the sponsored
  shelf, all tile layouts (plain, sale, range, options), hashed screen-reader text and click-tracker URLs.
- **Add Home Depot** (the provided `homedepot.html`, stripped per the README) and a recapture of Amazon from a US
  location (so buy-box prices are present).
- **Add a second split-grid site** and a **placeholder/virtual-list site**, so fixes are not fitted to one page.
- **Ground truth for every listing fixture** (`src/test/corpus/targets.ts`):
  - the item count;
  - the expected value of title, url, image, price, was price, rating, review count, SKU and badge, for 3 sample
    items each.
- **A scorecard test** (`src/test/corpus/listing.test.ts`), per fixture:
  - items found ÷ expected;
  - fields found ÷ expected;
  - values correct and typed;
  - columns that are duplicates or noise.

  It prints a table and fails below a floor. The floors rise with each phase.
- **e2e:** a pick on the BestBuy capture in the harness, checking count and columns as in §1.
- **Done when** the scorecard shows today's numbers and fails on them:
  - BestBuy: 4/18 items, 4/11 fields;
  - Walmart main grid: review count 2/44, price over 4 columns;
  - Walmart first-product pick: 3/50 items;
  - Amazon: approximate review counts, specs as one list, 24 columns on the category page;
  - Home Depot: review count, model, stock and ID missing.

  The §1.5 table becomes the scorecard's rows.

### L1: lists split across containers

- **Find the whole list.** After `findList` picks container *C* with items *I*:
  - walk up to 4 ancestors;
  - if an ancestor *A* holds ≥ 2 containers shaped like *C* (same tag, same stable classes or test id, same depth),
    whose items share *I*'s structure (the gate profile from `fields/gate.ts`), then the list is *A*;
  - the items are every such item, in document order.
- **Store it as a container plus a relative item path,** for example `:scope > div > ul.product-grid-view-container > li`,
  built from stable steps (`nodeStep`), never `nth-of-type`. The item chain already resolves relative selectors.
- **Score lists by what they hold,** not only their tag:
  - prefer the list with the most items that pass the gate;
  - prefer the main region over sponsored or carousel blocks (`aria-label`/`data-testid` with sponsored, a carousel
    inside a promo container, an item count capped by the viewport).
- **The picker says what it found:**
  - "18 items in 6 rows" or "Sponsored carousel: 3 items";
  - a one-click switch to the other list when both exist.
- **Placeholder items count:**
  - an empty `li` with the items' tag and classes is an item not yet rendered;
  - it is kept in the list, so scrolling knows what to wait for;
  - it is skipped when reading until it fills.
- **Done when:**
  - BestBuy's main grid picks as one list of 18;
  - clicking Walmart's first product, which sits in the sponsored shelf, offers the 50-item results list (picked, or
    one click away);
  - the corpus's existing listings keep their counts (Amazon, Walmart, COS).

### L2: scrolling and late content

- **Scroll the thing that grows.**
  - Count items through the list's full item path (L1), not one container's children.
  - Scroll the page or the scrolling ancestor (`mainScroller` from `content/services/images/session.ts`).
  - Bring each placeholder into view in turn (the `IndexedScrollStrategy` idea), and wait until it fills.
- **Wait for quiet, not a fixed delay:** no new mutations or loads for 300 ms, at most 2 s per step (the Image
  Downloader's `settle`).
- **Find "Show more" / "Load more" controls automatically,** for example `[data-show-more-virtual-list]` and buttons
  whose text is show/load/see more. Offer them in the Navigation step.
- **Read a row only when it's complete.**
  - A row is *loading* while it holds skeleton markers: `[aria-busy="true"]`, `[data-loading="true"]`, class words
    `skeleton`/`shimmer`/`placeholder`, or an empty element where the preview had a value.
  - Loading rows are read again after the next settle.
  - A row still loading after 3 settles is read as it is and counted in the run's warnings.
- **Done when:**
  - a live BestBuy run reads every card of every page with its price;
  - scrolling a placeholder grid reaches the end;
  - the scorecard's late-content fixture is complete.

### L3: values hidden from sight, read as data

- **Screen-reader sentences become fields.**
  - Keep the visual copy (it splits values cleanly).
  - Also parse the sentence with a small pattern library:
    - rating: "4.5 out of 5", "Rating 4.5", "4.5 stars";
    - review count: "with 109 reviews", "(1,234)", "1.2K ratings";
    - prices: "Your price is", "The price was", "Save $300", "Now / Was";
    - stock: "Only 3 left", "Out of stock".
  - Each match is a typed atom with a meaning (`rating`, `review_count`, `price`, `was_price`, `savings`, `stock`).
  - When the visual copy has the same value, the sentence names it. When it doesn't (the carousel rating), the
    sentence supplies it.
- **Find screen-reader text by how it renders, not its class.**
  - On a live page, an element counts as screen-reader-only when it is clipped (`clip: rect(0 0 0 0)`, or
    `clip-path: inset(50%)`), 1×1 px or smaller, and absolutely positioned.
  - Class names stay as the fallback for captures without styles.
  - This catches Walmart's hashed `ld_Ec`/`w_iUH7` and CSS-in-JS sites.
- **Parse before pruning.**
  - A sentence holding several values ("4.4 out of 5 Stars. 510 reviews", "current price Now $199.00, Was $259.00")
    is split into its parts (`rating`, `review_count`, `price`, `was_price`) as atoms first.
  - `dropComposites` (`fields/prune.ts`) then removes only the unparsed sentence, never a value that exists nowhere
    else.
- **Labels with more than the text.** Read `aria-label`/`title` even when the element has text, and keep the label
  when it holds more digits or words than the visible text. `"27,976 ratings"` beats `"(27.9K)"`. A precise number
  beats a rounded star label (`"4.4"` over `"4.5 Stars"`).
- **Label/value pairs become columns.** Detect the pairs in three forms:
  - `Label: value` / `Label# value` in one text ("Model# H300MTS", "At Your Store: 16 in stock");
  - alternating siblings, where the label text is the same across rows and the value varies (Amazon's spec chips,
    `dt`/`dd`);
  - a label element followed by its value ("Delivery:" then "Unavailable in Guam").

  Each label becomes a column named by it (`model`, `display_size`, `ram`, `store_stock`, `delivery`), filled where
  rows have it.
- **Attributes as candidate fields:**
  - `data-*` on the row and its first-level elements (`data-product-id`, `data-sku-id`, `data-item-id`,
    `data-price`, `data-brand`, `data-rating`);
  - `itemprop` with `content`;
  - `title` when it holds more than the element's visible text (line-clamped titles).
  - These are kept when they're filled in most rows and vary between rows; constants and hashes are dropped.
  - IDs are named by evidence (`sku`, `product_id`).
- **Buttons:**
  - skip action labels ("Add to cart", "Save", "Compare", "Quick view", "See options");
  - keep text that varies between rows and isn't an action (badges such as "Best Selling", "Core essentials PC").
- **Hidden subtrees:**
  - read `display:none` content as *optional* candidates (closed variant lists, collapsed specs), marked hidden;
  - suggest them in the review step when they're filled in most rows and not duplicates of visible fields;
  - never select them silently.
- **Done when:**
  - on BestBuy, rating and review count are filled on every rendered card (grid and carousel), and SKU and badge
    appear;
  - on Walmart, rating and review count are filled on every tile that has them (~40/44), and price and was price
    come from the hidden sentence on the sponsored shelf;
  - on Amazon, review counts are exact (from the `aria-label`), and specs are separate columns;
  - on Home Depot, rating 4.4 and review count 1949 come from `"(4.4 / 1949)"`, and model, store stock, delivery
    and product ID are columns;
  - no site gains noise columns (scorecard).

### L4: typed, well-named, non-overlapping fields

- **Type values as they're read.**
  - A field's shape (`price`, `number`, `rating`, `count`, `percent`, `date`) carries a parser.
  - The table stores the number (273, 4.7, 549.99) and keeps the raw text for display, so exports sort and filter
    correctly.
  - `"(273 reviews)"` → 273; `"4.7"` → 4.7; `"1.2K"` → 1200.
- **Name by meaning first:**
  - L3 meanings, then label text in the row ("Was", "List:"), then the units in the value;
  - class words only as a last resort.
  - "Ratings Reviews" becomes `rating`, "Reviews" becomes `review_count`, and "Common Carousel" is either named for
    what it holds or dropped.
- **Fewer duplicates:**
  - links to the same product with a fragment or a review anchor (`#tabbed-customerreviews`) are one field, so
    "URL (Stats)" goes;
  - image variants of one image (`Image`, `Image 2`, and an `Images` array of the same files at other sizes) become
    one image plus one gallery, using the Image Downloader's canonical URL (`shared/images/dedupe.ts`).
- **Merge by meaning.**
  - Fields with the same meaning that never share a row are one field: Walmart's `ugpp-main-price`,
    `unified-global-product-price` and plain `price` components.
  - A meaning comes from the L3 parse, the label words, or the component name.
  - A range price ("Options from $199.00 – $199.00") is a `price_min`/`price_max` pair, not a 4th price column.
- **No column explosions.** Badges at different positions are one `badges` list (Amazon's Badge … Badge 7). Price
  kinds are told apart by their label, not their position:
  - `price`;
  - `was_price` ("List:", "Was");
  - `typical_price` ("Typical:");
  - `unit_price` ("/ounce", "/count");
  - `price_min`/`price_max` (ranges).
- **Clean values.**
  - Strip a prefix that is another field's value (a hidden badge "Overall pick, " before the title).
  - Unwrap click-tracker URLs: a same-site URL in `rd`, `url`, `u`, `redirect` or `dest` (Walmart `/sp/track`,
    Amazon `/sspa/click`), reusing `cleanUrl`.
  - Join phrase fragments of one component occurrence ("Delivery as soon as" + "3pm"), as `fields/component.ts`
    already does for badges.
- **Merges you can see and undo:**
  - each merged field keeps where it came from (stage 3, `fields/merge.ts`);
  - the review step shows "merged from 2 layouts" with a split action;
  - add corpus cases for wrong merges as they're found.
- **Done when:**
  - the scorecard has no duplicate or noise columns on any listing fixture, and every numeric field is typed;
  - Walmart has one price column filled on every tile, product URLs (not trackers), clean titles and whole delivery
    phrases;
  - Amazon's category page has ≤ 14 columns, each named for what it holds;
  - Home Depot's columns are `brand`, `title`, `rating`, `review_count`, `model`, `price`, `store_stock`, `delivery`,
    `purchase_limit` and `product_id`.

### L5: the page's own data, joined by ID

- **Anchors:** rows are matched to structured items (JSON-LD, embedded state, captured API responses) by SKU or ID as
  well as URL and name, using the L3 `data-*` IDs.
- **API capture by default for listings.** When a page's rows have IDs and the network capture
  (`features/network/NetworkRelay`) saw JSON arrays keyed by those IDs, offer their fields (price, availability,
  rating) as named columns, read per row by ID.
- **Done when** BestBuy prices come from the API response even for rows whose price block never rendered, and agree
  with the visible price where both exist.

### L6: noticing a bad pick or a bad page

- **Pick check:** after a pick, compare the list's items with what the page suggests:
  - other containers like it (L1);
  - placeholders;
  - a results count in the page ("(7047)").

  Warn on a big gap: "This list shows 4 items; the page seems to have 18 more in sibling rows. Use the whole grid?"
- **Run health,** per page, against the preview, with one-click fixes in the warning:

  | Warning | Fix |
  |---|---|
  | Item count dropped by more than half | re-pick the list |
  | A field went from mostly filled to empty | re-detect that field (self-heal, #7) |
  | Rows read while still loading | wait longer |

  The checks run in `JobRunner`, and the warnings show on the Runs page and in the saved table's notes
  (`shared/listing/runStats.ts`).
- **Done when** a deliberately broken run (a row container instead of the grid, a skeleton price) is flagged on its
  first page.

## 4. Order, size, risk

| Phase | Size | Main risk |
|---|---|---|
| L0 scorecard | S | Captures go stale: date them; re-capture is a documented script |
| L1 split lists | M | Over-joining unrelated blocks (a recommendations row below the grid). Guard: same item structure and the gate profile, and show the result in the picker |
| L2 scroll and late content | M | Waiting too long on sites that never settle. Hard caps per step and per page, reported |
| L3 hidden values | M | Noise from data attributes and screen-reader text. Keep only varying, mostly-filled values; scorecard on 4+ sites |
| L4 typing and names | S–M | Changing column IDs breaks saved recipes. IDs stay stable for existing recipes (map old to new) |
| L5 joined data | M | API shapes vary; offer, don't impose |
| L6 health checks | S | False alarms on genuinely short pages. Thresholds from the corpus |

## 5. Open decisions

1. **Sponsored lists:** offer them as a separate list, or fold them into the main results? Recommendation: separate;
   the picker shows both.
2. **Hidden fields:** off by default and suggested (as above), or on for `display:none` subtrees with ≥ 80% fill?
3. **Typed values in the table:** store numbers and keep the raw text in a sibling (`price` and `price_raw`), or one
   typed column with the raw text in row metadata?
4. **Re-capture tooling:** a checked-in Playwright script (`scripts/capture-listing.mjs`) that scrolls, waits for
   skeletons and strips per the README. That makes recaptures reproducible.

## 6. Progress

| Phase | Status |
|---|---|
| L0 | Done for the dev set: `bestbuy-search`, `walmart-search-live`, `homedepot-search` (prepared with `scripts/corpus/prepare-listing.mjs`, stylesheets inlined) + the two Amazon pages; truth in `e2e/listing-truth.ts`; scorecard `e2e/listing.spec.ts` (found vs exact per field), baseline `e2e/listing-baseline.json`, fails on any drop. Not done: a fully loaded BestBuy capture (prices still skeletons), an Amazon capture with buy-box prices, the held-out set (generic plan §6) |
| L1 | Done as GS1 (`generic-list-selectors-plan.md` §9) |
| L2 | Done: `content/utils/settle.ts`: `settle` (quiet 300 ms, capped), `scrollerFor` (the list, a scrolling pane around it, or the page), `findLoadMore` (a visible, enabled "Show/Load/See/View more…" control or a `data-*show-more*` hook inside or after the list). Scroll runs (`MutationAwareScrollStrategy`): new items found through the item path at any depth, placeholders queued by identity (they used to collapse into one empty fingerprint and the rest were dropped), a settle before reading new items, the page's own "Show more" clicked when nothing is configured, a click that adds nothing ends the run. Pagination (`IndexedScrollStrategy`): scrolls the real scroller and settles. Rows read when ready (GS7 `readWhenReady`, settling on the row itself, ≤ 3 × 1 s). e2e `late.html`: placeholders filled on view, skeleton prices, a "Show more" button: 18/18 rows with prices (12 before). Not done: offering the found "Show more" in the Navigation step; a live BestBuy run |
| L3 | Mostly done as GS2 + GS3 (`generic-list-selectors-plan.md` §9); hidden subtrees and button badges not yet |
| L4 | Done as GS4 + GS5 (`generic-list-selectors-plan.md` §9) |
| L5 | Not started |
| L6 | Done (most): pick check `content/services/extraction/pickCheck.ts` (the page's stated count, "1–24 of 7,047 results" / "Showing 18 of 120" / a small total, against the list's items: a list under half of it is flagged in the review step); build-time field checks in `inferFields` (an ID that repeats; a number or price column that parses in < 90% of rows); run health per page in `runStats.ts` and Job details: rows read while still loading (`loading`), pages far shorter than the run's typical page, the last excepted (`short`), healed and broken fields (GS7). Not done: one-click fixes in the warnings (re-pick, wait longer); the Runs page and the saved table's notes |
