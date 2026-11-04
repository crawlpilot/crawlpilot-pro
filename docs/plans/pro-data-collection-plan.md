# Pro: data collection plan

What a recipe can't collect today, and the plan to close it. The scope is English-language sites (US, UK, Ireland,
Canada, Australia, New Zealand, India, Singapore, South Africa), seen from recipe building: what a field can read,
where from, and how a recipe gets the page into the state where the data is visible. Normalisation and cleaning
(locale, currency, units, value rules) come in a later plan.

Out of scope: getting past bot protection. Blocks are identified and waited out ([crawler.md](../design/crawler.md)).

## What a recipe collects today
| Capability | How | Where |
| --- | --- | --- |
| A field from the page | CSS or XPath selector; readers for text, text lists, links, images, lists and tables | `src/shared/selectors/resolve.ts`, `src/content/services/extraction/` |
| A field from the page's own data | Data ways: JSON-LD (by `@type`), embedded JSON (`<script type="application/json">`), page state (`__NEXT_DATA__` and the like) | `src/content/services/page/dataBinding.ts` |
| Fallbacks | Several ways per field, tried in order; a broken selector is healed by shape | `src/pro/recipe/types.ts` (`Way`, `Field.shape`) |
| Content behind a click | Click steps (tabs, "Show specifications"), with a wait for what they reveal | `extractPage.ts` |
| Lists | Container and items, frozen columns; infinite scroll, Load more, Next | `ListRecipeSpec` |
| Details pages | Each row's page read with its own page recipe, joined back to the row | `ListRecipeSpec.details` |
| Same results in Pro and the worker | The worker runs the extension's own extraction in each page | `src/pro/crawler/inPage.ts` |

The public extension already has two pieces Pro recipes can't use yet: **API recipes** (a recorded JSON call
replayed with paging, `src/shared/network/apiRecipe.ts`), and **network capture** (`public/net-hook.js`).

## What is missing
Each gap lists what fails today, a typical English site where it bites, the proposal, and its size (S: days, M: a
week or two, L: several weeks).

### C1. Preparing the page before reading (M)
- **Fails today:** nothing runs before the fields.
  - A cookie consent banner (UK, Ireland) can cover the content, or swallow a click step.
  - Many US and UK grocers and big-box retailers show price and stock only for a chosen store or ZIP/postcode. Without
    one they show a range, "select a store", or nothing.
- **Proposal:** *preparation steps*, set once per site and stored with the recipe's targeting, run before every
  recipe of the site:
  - **dismiss:** click a control if present, such as a consent banner's own "Reject all" or "Accept" button, chosen
    per site;
  - **set location:** pick a store or type a postcode through the site's own picker;
  - **wait:** for a selector.

  This fills in the "Steps before reading" that `src/shared/sites/siteSettings.ts` already plans. The worker runs
  the steps once per browser context and keeps the context's cookies (it does already), so they don't repeat on
  every page.
- **Done when** a recipe on a consent-walled e2e page and on a store-priced page reads the same in Test on this page
  and in the worker.

### C2. Product variants as rows (M)
- **Fails today:** a product with sizes and colours gives one record. The price and stock of other variants are lost,
  or worse, mixed.
- **Proposal:** a field can be marked *per variant*. Its value then comes from a variant list, giving one output row
  per variant, with the product-level fields repeated:
  - **From data first:** JSON-LD `offers[]` / `hasVariant`, or the variant JSON most platforms embed (Shopify
    `product.variants`, and Magento's and SFCC's equivalents). This needs no clicking, so it is fast and reliable.
  - **By clicking second:** for sites without variant data, "for each option of this swatch or select: choose it,
    then read these fields", with a cap on the number of variants.

  Rows are keyed `jobId~variantId`, the way list rows are, so a re-crawl overwrites them.

### C3. Data the page fetches (network ways) (M)
- **Fails today:** price, stock and reviews often arrive by XHR after load. A selector catches them only if they
  render in time, and only in the shape the page gives them.
- **Proposal:** a new way kind, `network`. It names a response by URL pattern, plus a path into its JSON, for
  example `**/api/inventory*` with `stores[0].qty`.
  - In Pro, network capture (`net-hook.js`) is already there for the API Finder.
  - In the worker, Playwright's `page.on('response')` collects the matching JSON bodies, size-capped.
  - The way's id and selector usage work as for other ways.

### C4. API recipes in Pro (L)
- **Fails today:** listing and search data that comes from a JSON endpoint has to be read by rendering every page.
- **Proposal:** a third recipe kind, `api`, built from the public extension's API recipes:
  - one recorded call, its paging parameter (page, offset, cursor or next link), and the JSON paths of its fields;
  - Pro gives it versions, review and targeting like any other recipe;
  - the worker runs it with the site's context request (no rendering), under the same site governor, pacing and
    robots rules;
  - details pages can still follow as page jobs.

  This is the cheapest collection there is for sites that load listings from JSON. Only public, unauthenticated
  endpoints that the site's own pages call are in scope.

### C5. Shadow DOM and iframes (M)
- **Fails today:**
  - Selectors stop at shadow roots, so web-component storefronts (some SFCC and Salesforce sites, and price and review
    widgets) can't be reached.
  - Reading is limited to the main frame (`all_frames: false`), so iframed content can't be reached either: review
    widgets, size guides, some store locators.
- **Proposal:**
  - A selector chain can step into an *open* shadow root: a chain step "inside the shadow root of the element
    above". The picker records it when the picked element is in one. Closed shadow roots stay out of reach.
  - Same-origin iframes: a chain step into the frame's document.
  - Cross-origin iframes: the worker reads the frame directly by URL pattern (Playwright frames). In Pro, the
    content script runs in that frame.

### C6. Lists inside a page (S–M)
- **Fails today:** reviews, Q&A and "more like this" are lists inside a product page, often paged by their own "More"
  button. A list field reads what is shown, and nothing more.
- **Proposal:** a list or table field can have a *more* control and a page cap. It is clicked, waited for and read
  again, as list recipes already do for Load more, with rows de-duplicated. The cap keeps a product with 5,000 reviews
  from tying up a worker.

### C7. More interactions (S)
- **Fails today:** only clicks. Lazy sections below the fold, and specs behind a select or a hover, are out of reach.
- **Proposal:** step kinds *scroll into view* (a section, or to the end), *choose option* (a `<select>`), *hover*, and
  *wait for* (a selector or text), alongside click. They are ordered with the fields as clicks are today.

### C8. More structured sources (S)
- **Fails today:** data ways read JSON-LD and embedded JSON, but not microdata or RDFa (`itemprop`), or meta tags
  (OpenGraph `og:*`, `product:price:amount`, Twitter cards). Many older English retail sites mark up products only
  that way.
- **Proposal:** data way kinds `microdata` and `meta`, read by `@itemtype` and `itemprop` path, or by meta
  name/property. The public metadata service (`src/content/services/metadata/`) already parses meta tags. These are
  the most stable ways a field can have, because they rarely change with a redesign.

### C9. Starter recipes (M)
- **Fails today:** every recipe starts from an empty picker.
- **Proposal:** build a first draft from what the page declares:
  - a JSON-LD `Product`, `Offer`, `BreadcrumbList` or `AggregateRating`, microdata or meta tags each become fields
    with a data way first and a selector way as fallback (the selector found by matching the value on the page);
  - known platforms (Shopify, Magento, SFCC, WooCommerce, BigCommerce) get a template of their usual sources.

  The draft then goes through the usual test, review and live flow. Building this needs C8 first.

### C10. The pages a recipe collects (S)
- **Fails today:** a version's `pages` can say a sitemap or a start URL (`PageSource` in `types.ts`). Only URL lists
  reach the worker, as jobs someone else creates.
- **Proposal:** expand `sitemap` sources (with include/exclude globs, sitemap indexes, `lastmod` for re-crawls) into
  jobs pinned to the version, through a small job producer next to the worker. A `start` source is a list recipe's
  first page.

## Order
| Phase | Gaps | Why first |
| --- | --- | --- |
| 1 | C1 preparation, C8 structured sources, C2 variants from data | Most English retail sites need a consent click or a store; structured data is the cheapest, most stable source; variants are where product data is most often wrong |
| 2 | C3 network ways, C4 API recipes | Prices, stock and listings loaded by XHR; the fastest way to collect at scale |
| 3 | C5 shadow DOM and iframes, C6 lists inside a page, C7 interactions, C2 variants by clicking | Reach for the harder page structures |
| 4 | C9 starter recipes, C10 page sources | Less work per new site, once the sources exist |

## Rules for every gap
- **Pro and the worker read alike.** Each capability runs in Test on this page, Test on sample pages and the worker,
  through the same in-page code. Every gap gets an e2e page in `e2e/site/` and a case in `e2e/crawler.spec.ts`.
- **New way kinds are tracked like the others:**
  - they get way ids and selector usage;
  - they show in the Selectors card;
  - Clean up can drop them.
- **The recipe file format moves to 4** when a spec uses a way kind or step that older readers can't run. Format 4
  readers still read 1–3, and a format 3 reader refuses a 4 by name.
- **Digest:** new spec fields are part of the digest; leaving one unset leaves the digest as it was, so existing
  versions keep their identity.

## Decision needed: the upstream boundary
C1, C3, C5, C6, C7 and C8 change the extraction engine:
- selector resolution in `src/shared/selectors/`;
- readers and `extractPage` in `src/content/`;
- the picker.

These are public extension files, which Pro only gives small hook points. There are three ways to proceed:
1. **Build them in the public CrawlPilot first**, then merge into Pro as usual. This keeps the boundary; Pro waits
   on public releases.
2. **Pro hook points:** the engine gets a small extension interface (extra way kinds, extra step kinds, a resolver
   hook), with Pro's implementations in `src/pro/`. Upstream conflicts stay small, and Pro isn't blocked.
3. **Change the public files in Pro.** This is the fastest, but every upstream merge gets harder. Not recommended.

The recommendation is option 2: it keeps both products moving. C2, C4, C9 and C10 can start inside `src/pro/`
whichever option is chosen.
