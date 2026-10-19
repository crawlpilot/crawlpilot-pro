# Selector corpus pages

Real pages for `src/test/corpus` (the selector corpus, `docs/plans/selector-reliability-plan.md` S0).
Scripts (except JSON-LD and JSON state), styles, stylesheets, iframes and SVG paths are removed; the rest is as
served. Gzipped to keep the repository small.

| File | Source | Captured | Notes |
|---|---|---|---|
| `amazon-search.html.gz` | `https://www.amazon.com/s?k=laptop` | 2026-10-17, Chrome | 27 children of `.s-main-slot`, 16 products; sponsored, video and widget blocks between them |
| `amazon-category.html.gz` | `https://www.amazon.com/s?i=specialty-aps&bbn=16225005011&rh=n%3A%252116225005011%2Cn%3A239225011` | 2026-10-19, headless Chromium (Playwright), after scrolling | 28 children of `.s-main-slot`, 24 products; colour swatches of varying count, "See options" and "Add to cart" cards, rating popover triggers. Elements the page didn't render are marked `hidden` before styles are removed |
| `cos-search.html.gz` | `https://www.cos.com/en-us/search?search=shirts` | 2026-10-19, headed Chrome (Playwright; headless gets "Access Denied") | 40 tiles, each with a gallery of 2–16 images hooked `default-product-card-slider-image-<n>`. The page mounts images only near the viewport, so the capture scrolls in steps and keeps each tile from when it had its images |
| `walmart-search.html.gz` | `https://www.walmart.com/search?q=cars` | 2026-10-17, `curl` (desktop Chrome user agent) | 9 server-rendered tiles in `[data-testid="item-stack"]`; the rest of the ~140 items are in `__NEXT_DATA__`. Sale, range and plain price variants |

## Listing scorecard pages

Used by `e2e/listing.spec.ts` with the ground truth in `e2e/listing-truth.ts`, together with `amazon-search` and
`amazon-category` above. Prepared with `scripts/corpus/prepare-listing.mjs`. Unlike the pages above, these **keep
their stylesheets** (inlined), because hidden text is told apart by how it renders and the picker needs real layout.
Scripts other than JSON data, iframes and preloads are removed, and a `<base>` points at the site.

| File | Source | Captured | Notes |
|---|---|---|---|
| `bestbuy-search.html.gz` | `https://www.bestbuy.com/site/searchpage.jsp?st=laptop` | 2026-10-19, headless Chromium (Playwright), no scrolling | The grid is 6 sibling `ul.product-grid-view-container` rows (2–4 cards each); 18 cards, 9 still placeholders; price blocks mostly still loading skeletons. Sponsored carousel (3 visible) above the grid. Ratings only in `.visually-hidden` sentences |
| `walmart-search-live.html.gz` | `https://www.walmart.com/search?q=laptop` | 2026-10-19, headed Chrome after scrolling (headless gets "Robot or human?") | 45 products in `[data-testid="item-stack"]`; a 3-item sponsored brand shelf above them. Screen-reader text in hashed classes (`ld_Ec`, `w_iUH7`); click-tracker URLs on sponsored tiles; 4 price layouts |
| `walmart-cars.html.gz` | `https://www.walmart.com/search?q=cars` | 2026-10-19, saved by hand in Chrome | Two result stacks; the top one has 21 product cards in a grid, one full-width video tile (`search-video-in-grid`) and 2 ad tiles in grid cells; product cells' layout classes differ (some lack `bb`) |
| `chewy-plp.html.gz` | `https://www.chewy.com/b/dog-treats-288` (browse grid) | 2026-10-19, saved by hand in Chrome | 36 cards (`data-testid="plp-product-card"`) in one CSS grid; each card's image block and details block are stacked siblings of the same size (not a row of cells); price as `$59.18 Chewy Price` label beside an `aria-hidden` split copy; an ad carousel elsewhere |
| `homedepot-search.html.gz` | `https://www.homedepot.com/b/N-5yc1v/Ntk-elasticplus/Ntt-tools?NCNI-5` | 2026-10-19, saved by hand in Chrome (automated browsers get "Oops!! Something went wrong" unless automation flags are off) | 12 products; rating and review count only as `(4.4 / 1949)`, rounded star `aria-label`s; `Model# …`, store stock and delivery as label/value text; `data-product-id` |

The synthetic and trimmed pages one level up (`bootstrap-grid.html`, `tailwind-grid.html`, `emotion-hashed.html`,
`walmart-carousel.html`) are part of the corpus too.

## Product pages

`pdp-*.html.gz` and `src/test/corpus/pdp-targets.json` (30 annotated targets: titles, prices, spec rows with their
labels, controls) are the product-page corpus captured for thenos's selector work on 2026-10-08:

| File | Page | How |
|---|---|---|
| `pdp-amazon.html.gz` | https://www.amazon.com/Lenovo-Essential-Laptop-Processor-Storage/dp/B0HJCRV1J6/ | browser session (direct downloads got the anti-bot page) |
| `pdp-walmart.html.gz` | https://www.walmart.com/ip/EG-4-BURNER-GRILL/17070020028 | browser session |
| `pdp-uniqlo.html.gz` | https://www.uniqlo.com/in/en/products/E481040-000/00 | Chrome, after scrolling |
| `pdp-zara.html.gz` | https://www.zara.com/in/en/straight-leg-jeans-p00774360.html | Chrome, after scrolling |

The capture tool marked elements with `data-tn-*` attributes; the corpus removes them before measuring, since a live
page has none. Amazon's capture has no buy-box price (the item did not ship to the capture's region).

## Markdown pages

Used with every page above by `src/test/corpus/markdown.test.ts` (the markdown engine's corpus). Stripped the same
way (scripts except JSON-LD, styles, stylesheets, iframes, SVG paths). Both are CC BY-SA.

| File | Source | Captured | Notes |
|---|---|---|---|
| `article-wikipedia.html.gz` | https://en.wikipedia.org/wiki/Incandescent_light_bulb | 2026-10-19, `curl` | Long article: infobox, data tables with spans, figures with captions, references |
| `docs-mdn.html.gz` | https://developer.mozilla.org/en-US/docs/Web/API/Element/querySelectorAll | 2026-10-19, `curl` | Reference page: code blocks with languages, definition lists, a specification table |
