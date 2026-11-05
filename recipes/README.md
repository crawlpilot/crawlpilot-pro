# Retailer recipes

Product-page recipes for **Amazon** (`amazon-product.crawlpilot.json`) and **Walmart**
(`walmart-product.crawlpilot.json`), as recipe files Pro imports (Recipes → Import) and the local recipe store seeds
(`MOCK_SEED`).

## How they are built
They are generated, not hand-edited: `src/pro/recipe/retailers.ts` starts from each site's Atlas export
(`src/pro/recipe/atlas/fixtures/`) and adds what Pro can express now. After changing it:
```bash
UPDATE_RECIPES=1 npx vitest run src/pro/recipe/retailers.test.ts
```
The test fails while the committed files differ from what the builder makes.

**What the Atlas export brings** (field names and types kept, so the output keeps the names its consumers read):
- every attribute as a field, each template a way, Atlas's cleanups (regex, Lua) included;
- its error pages as page rules (404, anonymity, 503, captchas);
- Amazon's SKU check against the `dp/` id in the URL.

**What Pro adds:**

| | Amazon | Walmart |
| --- | --- | --- |
| Location | "Deliver to" ZIP (`{zip}`), checked in the header on every page | Shipping ZIP (`{zip}`), checked on the page's "Ships to" line |
| Sturdier ways | SKU from the hidden `#ASIN` input and the title widget, first | The page's data (`__NEXT_DATA__`) first, for title, SKU, brand, UPC, model, price, was price, rating, reviews, description |
| Identity | (from Atlas) | SKU against the id in `/ip/<name>/<id>` |
| More page rules | Sign-in redirect (URL), robot-check wording (visible text) | Sign-in redirect (URL), "Robot or human?" (visible text) |
| Value checks | SKU is an ASIN, prices in US dollars, rating 0–5, review count | SKU and UPC are numbers, prices in US dollars, rating 0–5, review count |
| Required | PRODUCT_TITLE, SKU | PRODUCT_TITLE, SKU |
| Targeting | `amazon` · `product`, `https://www.amazon.com/*dp/*`, `…/gp/product/*` | `walmart` · `product`, `https://www.walmart.com/ip/*` |

Each version's note lists what the import could not carry over.

## What is checked, and what is not
- **Checked** (`retailers.test.ts`): both read the saved product pages (`src/test/fixtures/corpus/pdp-*.html.gz`) with
  no rule holding and every check passing:
  - Amazon: ASIN, title, brand, rating, reviews.
  - Walmart: title, SKU, brand, UPC, price, rating, reviews, model.

  A different id in the URL is caught as another product.
- **Not checked on live pages.** The saved Amazon page was taken from outside the US, so it has no buy box and no
  price, and its prices were in INR: the US-dollar check will flag that on a live page served the same way. Walmart's
  ZIP dialog is not on the saved page, so its input and Save selectors are the likely ones. If they are wrong, the
  setup check fails the job (`setup_failed`) rather than reading the wrong location.

  Try both with the live-check kit (`deploy/local/live-check/README.md`) before submitting them.
- **Every job needs `context.zip`**, because both set a location first. A job without one is dead-lettered
  (`missing_context`).
