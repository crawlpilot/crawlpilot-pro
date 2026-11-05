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

### C1. Interactions: location, fulfilment, banners (L)
The detailed design is in [C1 in detail](#c1-in-detail-interactions-before-and-during-reading) below.
- **Fails today:** a recipe can only click before it reads. That isn't enough on retailer product pages, where what you see
  depends on choices the visitor makes:
  - **Location:** Amazon's "Deliver to …" and Walmart's "Pickup or delivery?" open a chooser where the visitor types a
    ZIP code, applies it, and sometimes picks a store. Price, stock, delivery date and which fulfilment methods are
    offered all change with it. Target, Home Depot, Lowe's, Kroger, Best Buy, and UK grocers (postcode, then a
    delivery slot or store) work the same way.
  - **Fulfilment:** a product page offers *Pickup*, *Delivery* and *Shipping* (or *Collect* and *Deliver*) as tiles or
    radio buttons, each with its own availability, date and sometimes price.
  - **Interruptions:** cookie consent (UK, Ireland), "Is this your location?" prompts, sign-up and promo modals, and app
    banners, which cover the content or swallow a click.
- **Proposal:** recipes get *interaction steps* beyond clicks:
  - steps run once per browser session to set it up (location);
  - steps run on every page before or between fields (fulfilment choice, dismissing a modal);
  - *variables*, so one recipe collects for many ZIP codes and stores, and every document records the location its
    values are for.

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

## C1 in detail: interactions before and during reading
### What it has to handle
| Situation | What the visitor does | What the recipe needs |
| --- | --- | --- |
| Set the delivery location (Amazon "Deliver to", Walmart location, Target "Ship to") | Click the location link, type a ZIP code, click Apply, sometimes confirm or close; the page reloads or updates | Click, type a variable, click, wait for the page to settle, check the new location shows |
| Choose a store (Walmart, Home Depot, Kroger, UK grocers) | Open the store chooser, type a ZIP code or postcode, pick a store from the list (by name or id, or the nearest) | Choose an item from a list by its text, a variable, or position |
| Choose a fulfilment method on the product page | Click *Pickup*, *Delivery* or *Shipping* | Click, then read the fields that method shows; later, one row per method |
| Dismiss an interruption | Close a consent banner, a promo modal, "Is this your location?" | A click that is *optional*: done if the control is there, skipped if not |
| Choose an option from a dropdown | Pick a size or quantity in a `<select>` | Choose an option by text or value |
| Content that waits for scrolling or appears late | Scroll to a section; wait for a price to appear | Scroll into view; wait for an element to appear, or for a spinner to go |

### The model
- **Step kinds**, each with a target found by ways (selectors, with fallbacks, way ids and usage tracking, as fields
  have):

  | Kind | What it does |
  | --- | --- |
  | `click` | Clicks the target (today's click step) |
  | `type` | Types text into the target, e.g. `{zip}`, clearing it first; optional key to press after (Enter) |
  | `choose` | In a list (a store list, a set of tiles), clicks the item whose text contains a value or variable, or the n-th |
  | `select` | Picks an option of a `<select>` by text or value |
  | `press` | Presses a key (Escape to close a modal) |
  | `wait` | Waits for the target to appear, or to go (a spinner), or for text |
  | `scroll` | Scrolls the target into view, or to the end of the page |

  Every step can be `optional` (skipped when its target isn't there: banners and prompts) and can say what to expect
  after it: the target goes away, an element appears, the page navigates. Each step has a timeout.
- **Session setup:** steps that set the browser session up once (the location and store), plus a **check**. The check
  is an element and the text it must contain, such as the header's "Deliver to …" containing `{zip}`. It is part of
  the recipe version, so it is reviewed and digested like the fields.
  - The setup runs before the first page of a session.
  - The check runs on every page. If the site has dropped the location (an expired cookie, a redirect), the setup
    runs once more.
  - If the check still fails, the attempt fails as `setup_failed`, naming the step. It is never read silently for
    the wrong location.
- **Page steps:** the steps of a page recipe, run in order with its fields as clicks are today. This is where the
  fulfilment choice and optional dismissals go.
- **Variables:** the recipe declares the ones it uses (`zip`, `store`, or any name). Each crawl job carries their
  values (`context: { "zip": "10001" }`), and so does each test in Pro (set in the editor).
  - Scrape and usage documents carry `context`.
  - The document id includes it, so 10001 and 94105 for one URL are two documents.
  - The job producer makes one job per URL and location.
- **Later, with C2:** *for each* fulfilment method (or variant), choose it, then read the fields, giving one row per
  method.

### Running it
Choosing a location usually reloads the page, so the steps are run from outside the page, one at a time. A script
inside the page would not survive the reload.
- **Worker:**
  - **Steps:** Node runs each step. It finds the target with the extension's own resolver inside the page (so
    selectors mean the same as in Pro), then acts on it with Playwright: real clicks, typing with key events,
    `selectOption`, the keyboard. After each step it waits for the expected change and for any navigation to load.
  - **Sessions:** a browser context is keyed by site, proxy, the setup's digest and the variable values. A context set
    to 10001 is never reused for 94105, and the setup runs once per context, not once per page.
  - **Telemetry:** request events carry `context`, whether the setup ran, how long it took, and which step failed.
- **Pro** (Test on this page, Test on sample pages):
  - **Steps:** the side panel runs the steps one at a time through the content script. The content script finds the
    target with the same resolver and acts on it with the events a framework listens to: the native value setter plus
    `input` and `change` for typing, and pointer and mouse events for clicks.
  - **Reloads:** when a step navigates, the background waits for the tab to load, injects the content script again,
    and carries on.
  - **Limitation:** these are not trusted browser events. A site that ignores them can be run through Chrome's
    debugger input later; that is a follow-up, not part of this work.
- **Building it:** in the editor, a *Before reading* section (session setup and check) and the page's step list both
  get **Add step**:
  1. pick the element on the page with the existing picker;
  2. choose what to do (click, type, choose, select, press, wait, scroll);
  3. give the value (text, or a variable such as `{zip}`) and whether the step is optional.

  **Try steps** runs them on the open tab with the test values of the variables. A *record* mode, where Pro watches
  the builder's clicks and typing and writes the steps, is a follow-up.

### Hook points in the public engine (option 2)
Building the worker side showed that fewer seams are needed than first planned:
- **Page steps need no `extractPage` registry.** A page recipe is cut into runs of fields and plain clicks, which the
  extractor reads as before, and Pro's actions run between them (`src/pro/recipe/actions.ts`, `segments`).
- **Finding a target needs no content-script registry.** Pro's in-page step code (`src/pro/steps/inPageSteps.ts`)
  uses the public selector resolver as a library. The worker bundles it into its in-page script.
- **Pro's side needed no seam either.** Pro's step script ships through crxjs's `?script` import, as the public
  summarizer's does, and Pro starts the public picker through its existing messages (`START_PICKER`,
  `ELEMENT_SELECTED`). This work changes no public file.

### Status
- **Step 1, done:**
  - the model: action steps, session setup with a check, dismissals, variables;
  - way ids, health, clean-up, diff and save checks for all of them;
  - the worker: Playwright actions and sessions per context, `setup_failed` and `missing_context`, documents per
    context;
  - the e2e retailer page with its crawler test.
- **Step 2, done:**
  - one step runner for the worker and Pro (`src/pro/steps/runner.ts`), driven by Playwright in the worker and by an
    injected script in the user's tab;
  - the editor: *Before reading* (setup steps, check, dismissals, test values, Try setup) and *Add a step* among
    the fields, each element picked on the page or typed;
  - Test on this page and Test on sample pages run the setup (only when its check isn't met) and the steps.
- **Step 3, in progress:**
  - **One row per item, done:** a `choose` step can go through each item (`forEach`: every tile the page shows, or
    the ones named, up to a maximum). The fields after it are read once per item, and the worker writes one
    document per item (`option`, id ending `~opt=<item>`). Variants by clicking (C2) can use the same step.
  - **Still to do:** a step recorder, and trusted input in Pro through the debugger.

### Done when
The e2e site gets a retailer page that behaves like the real ones:
- a consent banner;
- a "Deliver to" link that opens a ZIP dialog, sets a cookie and reloads;
- a store list;
- Pickup, Delivery and Shipping tiles whose price and stock depend on the ZIP and the store.

Then:
- **In Pro:** a recipe built in the editor reads that page for ZIP 10001 and for 94105, with the values each should
  have.
- **In the worker:**
  - two jobs for the same URL with those two ZIPs give two documents with the right `context` and values;
  - their contexts are not shared;
  - the setup runs once per context;
  - a check that fails gives `setup_failed` with the step named.

### On Amazon and Walmart specifically
Both have strong bot protection. The worker identifies their blocks and waits them out; it does not work around them.
Both sites' terms also restrict automated collection. Confirm the business may collect from a site before targeting
it, or use the official sources where they exist (Amazon's Selling Partner API returns delivery offers by ZIP code for
sellers). The interaction steps themselves are generic, and serve every retailer that allows it.

## Order
| Phase | Gaps | Why first |
| --- | --- | --- |
| 1 | C1 interactions (location, fulfilment, banners), C8 structured sources, C2 variants from data | Most English retail sites need a consent click or a store; structured data is the cheapest, most stable source; variants are where product data is most often wrong |
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

## Decided: the upstream boundary
C1, C3, C5, C6, C7 and C8 change the extraction engine: selector resolution in `src/shared/selectors/`, the readers and
`extractPage` in `src/content/`, and the picker. Those are public extension files.

The decision is **option 2, Pro hook points**. The engine gets small, generic extension interfaces (extra way kinds,
extra step kinds, a content-script command registry), and Pro's implementations live in `src/pro/`. The hook points
are kept generic, so they can go upstream to the public CrawlPilot as they are. The alternatives were to build in the
public extension first (Pro waits on its releases) or to edit the public files freely (every upstream merge gets
harder).
