# Live check: one recipe on a few live pages

A small kit for trying a recipe on real pages from your own machine before it goes anywhere near a crawl. It runs the
worker on a handful of jobs and prints each attempt and each page's values; nothing is written anywhere.

The example is an Amazon product page read for two delivery ZIP codes (`amazon-pdp.recipe.json`):
- **Setup:** "Deliver to", type the ZIP, Apply, Continue; the header must then show the ZIP.
- **Dismissals:** the location prompt and a cookie banner, closed whenever they show.
- **Fields:** title, price, availability, the delivery message, and the "Deliver to" line.

Its selectors come from Amazon's widely known page structure and have not been checked against the live page yet.
Expect to adjust them: that is what this check is for.

## Before you run it
- **Amazon's terms** restrict automated collection. Make sure the business is allowed to collect from a site before
  you target it. Amazon offers official APIs for some of this data (the Selling Partner API returns delivery offers
  by ZIP code, for sellers).
- **Keep it small:** a few jobs, one at a time. `crawler.json` paces requests 15 s apart, makes one attempt per job,
  and stops after the first block: any job held back by it is dropped (`expired`) without another request.
- **robots.txt is respected.** Product pages (`/dp/<ASIN>`) are open to general crawlers there. The worker identifies
  itself as `CrawlPilotBot` and runs Chromium as it is: no disguise, no captcha solving. If Amazon answers with a
  challenge, that is a result: the check shows how the worker identifies it.

## Run it
From the repository root, with [Local setup](../../../docs/onboarding/local-setup.md) done:
```bash
npm run crawler:build

# 1. The recipe store, with the recipe live (leave it running in its own terminal)
MOCK_SEED=deploy/local/live-check/amazon-pdp.recipe.json npm run pro:mock

# 2. Jobs: one product, two ZIP codes. Use an ASIN of a product you can see on amazon.com.
ASIN=B0XXXXXXXX
for zip in 10001 94105; do
  echo "{\"jobId\":\"$ASIN\",\"url\":\"https://www.amazon.com/dp/$ASIN\",\"competitor\":\"amazon\",\"pageType\":\"product\",\"context\":{\"zip\":\"$zip\"}}"
done > /tmp/live-check-jobs.jsonl

# 3. Run, printing instead of writing to Elasticsearch
STORE_TOKEN=dev-token node src/pro/crawler/dist/worker.mjs \
  --config deploy/local/live-check/crawler.json --jobs /tmp/live-check-jobs.jsonl --dead-letter /tmp/live-check-dead.jsonl --print
```
The worker runs Chromium headless; to see the page yourself, open it in your own browser.

## Reading the output
Each attempt prints one line, then the page's values when it was read:
```
attempt B0XXXXXXXX #1 200 none → success {"zip":"10001"}  setup: ran in 6120 ms
values  B0XXXXXXXX~zip=10001: {
  "pageStatus": "ok", "title": "…", "price": 24.99, "availability": "In Stock", "delivery": "FREE delivery Friday…", "deliver_to": "New York 10001"
}
```
| What you see | What it means | What to do |
| --- | --- | --- |
| `none → success` for both ZIPs, with different delivery messages or prices | The setup and the recipe work | Build the recipe properly in Pro, from the live page |
| `setup_failed`, `failed at "Open Deliver to"` (or another step) | That step's element wasn't found: the selector is wrong for the page you got | Open the page in your browser, find the element, fix the step's selector in the recipe file |
| `setup_failed`, `failed at "check"` | The steps ran, but the header doesn't show the ZIP | Check what the "Deliver to" line shows after setting a ZIP by hand; adjust `check.contains` or its selector |
| `captcha`, `block: Amazon captcha (high)` | Amazon asked for a captcha | Stop: the worker backs off and does not solve it. Amazon doesn't serve these pages to this kind of client from here; use an official source |
| `blocked`, `block: Amazon block (high) – … automated-access notice` | Amazon turned the request away as automated | As above |
| `robots_disallowed` | robots.txt disallows the URL for the worker | Don't crawl it |
| `missing_context` | A job lacks `context.zip` | Fix the jobs file |

To try another site, copy the recipe file, change its `competitor`, `site` and spec, and point the jobs at it.
