# Running locally

The whole system on your laptop: a recipe built in Pro, submitted to a backend, reviewed and put live, then crawled
by the worker, with the results and telemetry in Elasticsearch. Do [Local setup](local-setup.md) first.

```
 Chrome + Pro (dist/)  ──▶  mock backend :8787  ◀──  crawler worker  ──▶  Elasticsearch :9200  ──▶  Kibana :5601
                            (npm run pro:mock)        (worker.mjs)          (deploy/local/docker-compose.yml)
                                                          │
                                                          ▼
                                               test site :8000 (e2e/site)
```

You need four terminals: the backend, the test site, Elasticsearch (it runs in the background), and one for commands.

## 1. The backend
```bash
MOCK_SEED=demo npm run pro:mock
```
This runs the mock recipe store (`src/pro/backend/mock.ts`) on `http://127.0.0.1:8787`, with the token `dev-token`.
`MOCK_SEED=demo` starts it with one recipe already live: competitor `demo`, page type `product`, which reads the title
and price of the test site's lamp page. Leave `MOCK_SEED` off to start empty, and submit your own recipe from Pro (step 5).

- It prints each request as `status METHOD path`.
- State is in memory, so stopping it forgets every recipe.
- `MOCK_PORT`, `MOCK_HOST` and `MOCK_TOKEN` change its port, address and token.

## 2. A site to crawl
```bash
python3 -m http.server 8000 --bind 127.0.0.1 --directory e2e
```
This serves the e2e test pages, for example `http://127.0.0.1:8000/site/product.html?id=3`, a lamp whose title and
price are drawn by JavaScript. Any static file server works.

## 3. Elasticsearch, and Kibana if you want it
```bash
docker compose -f deploy/local/docker-compose.yml up -d                     # Elasticsearch on :9200
docker compose -f deploy/local/docker-compose.yml --profile kibana up -d    # and Kibana on :5601 (about 1 GB more)
curl -s http://127.0.0.1:9200/_cluster/health                               # wait for "yellow" or "green"
```
Security is off and the disk watermark check is disabled: this setup is for your laptop only. The indices are
`yellow` on one node, because they want a replica. That is fine.

## 4. Crawl
```bash
npm run crawler:build
export STORE_TOKEN=dev-token        # crawler.local.json reads the store token from the environment
node src/pro/crawler/dist/worker.mjs --config deploy/local/crawler.local.json --setup-elasticsearch
node src/pro/crawler/dist/worker.mjs --config deploy/local/crawler.local.json --jobs deploy/local/jobs.sample.jsonl
```
`--setup-elasticsearch` installs the index templates, once per cluster. The second command runs the six sample jobs:
five lamps and one missing page. It prints:
```
success     http://127.0.0.1:8000/site/product.html?id=2
…
failed      http://127.0.0.1:8000/site/no-such-page.html  (not_found)

6 jobs: 5 read, 1 failed, 0 dead-lettered, 0 deferrals.
```
For each job, the worker:
1. asked the backend which version is live for `demo`/`product` and that URL (`GET /resolve`), and fetched that
   version once (`GET /versions/<digest>`), checking its digest;
2. read the page in Chromium with the recipe;
3. wrote the scrape, the selector usage and a request event to Elasticsearch.

Jobs it can't finish go to `dead-letter.jsonl` in the current folder.

A job is one JSON line: `{ "jobId", "url", "competitor", "pageType" }`. Optional fields:
- `recipeDigest`: pin a version instead of using the live one.
- `mode: "test"`: write to the `test-` indices instead.
- `runId` and `meta`: passed through to the documents.
- `context`: the values of the recipe's variables, such as `{ "zip": "10001", "store": "Chelsea" }`, for recipes
  that set a location first. See [crawler.md](../design/crawler.md#session-setup-and-action-steps).

## 5. Look at the results
```bash
curl -s 'http://127.0.0.1:9200/_cat/indices?v&h=health,index,docs.count'
curl -s 'http://127.0.0.1:9200/scrapes-demo/_doc/demo-3?filter_path=_source.attributes,_source.pageStatus'
#  {"_source":{"pageStatus":"ok","attributes":{"title":"Lamp model 3","price":"$30.99"}}}
curl -s -H 'content-type: application/json' 'http://127.0.0.1:9200/crawl-requests-*/_search?size=0&filter_path=aggregations' \
  -d '{"aggs":{"by_class":{"terms":{"field":"errorClass"}}}}'
#  "none": 5, "not_found": 1
```
| Index | One document per | What to look at |
| --- | --- | --- |
| `scrapes-<competitor>` | Page (id: the job id) | `attributes` (the values read), `fieldStatus`, `pageStatus`, the recipe version |
| `selector-usage-YYYY.MM` | Page | `ways`: for each selector, whether it was tried, matched and won |
| `crawl-requests-YYYY.MM.DD` | Attempt | Status, headers, timings, proxy, `errorClass`, block identification, outcome |
| `crawl-sites-YYYY.MM` | Site state change | Cooldowns and blocks |

In Kibana (`http://127.0.0.1:5601`), create data views for `scrapes-*` and `crawl-requests-*` with `@timestamp`
(`crawledAt` for scrapes) under Stack Management → Data Views, then open Discover.

`_cat/indices` counts the `selector-usage` index's nested `ways` as documents: 5 pages with 3 ways each show as 20.

## 6. Selector usage, added up
```bash
node src/pro/crawler/dist/worker.mjs --config deploy/local/crawler.local.json --rollup $(date -u +%F)
curl -s 'http://127.0.0.1:9200/selector-usage-daily-*/_search?filter_path=hits.hits._source.wayId,hits.hits._source.matched,hits.hits._source.pages'
```
The demo recipe's title has a dead selector first (`h1.lamp-name`, way `w-title-old`) and a working one second. The
rollup shows it tried on 5 pages and matched on 0. This is what Pro's selector labels and Clean up are built on. In
production the rollup runs daily for yesterday (the default when no date is given). Locally, give today's date.

The mock backend does not read these daily totals: its `/recipes/{id}/ways/stats` returns only what a test sets. So
**Refresh usage** in Pro shows "no data" against the local mock. The flow is covered by
`e2e/pro-recipes.spec.ts` ("selectors: crawl usage labels each selector…").

## 7. Your own recipe, from Pro
With the backend running (with or without the seed):
1. Open Pro's side panel in Chrome. Under **Backend**, set **Your name** (any name, for example `alex`), the
   **Address** `http://127.0.0.1:8787` and the **Access token** `dev-token`, then **Save**.
2. Build a recipe: **Build new** opens the public tools. Pick the fields on a page (for example
   `http://127.0.0.1:8000/site/product.html?id=1`), then **Save version**. It lands in Pro's **Recipes** as version 1.
3. Open it and set **Targeting**:
   - **Competitor**, for example `demo2`.
   - **Page type**, for example `product`.
   - **URLs it is for**, for example `http://127.0.0.1:8000/site/product.html*`. These are the match rules: globs
     where `*` is any run of characters, and the glob must match the whole URL.

   Then **Test on this page** or **Test on sample pages**.
4. **Submit** uploads the version. A version can't go live until someone else approves it. Change **Your name** in
   **Backend** to another name, open **History**, **Approve** the version, then **Mark live**.
5. Crawl it: copy `deploy/local/jobs.sample.jsonl`, set `"competitor": "demo2"`, and run step 4 again with your file.

For a page that needs choices first (a delivery ZIP code, a store, a cookie banner), open **Before reading** in the
editor:
- add the setup steps and a check;
- add the cookie banner's and pop-ups' close controls as dismissals;
- give `{zip}` a test value;
- run **Try setup on this page**.

**Add a step** puts a choice (the *Delivery* tile) among the fields. `e2e/site/retailer.html` is a page to practise on.

The exact clicks for each of these steps are in `e2e/pro-recipes.spec.ts`.

## Variations
- **The worker in its container image**, as ECS runs it. Build the image as in [Local setup](local-setup.md#build-the-crawler-worker), then:
  ```bash
  docker run --rm --network host -e STORE_TOKEN=dev-token -v "$PWD/deploy/local:/work" -w /work \
    crawlpilot-crawler:dev --config crawler.local.json --jobs jobs.sample.jsonl
  ```
  `--network host` lets the container reach the mock, the site and Elasticsearch on `127.0.0.1`. That works on
  Linux. On Docker Desktop, use `host.docker.internal` in place of `127.0.0.1` in the configuration and the jobs.
- **Configuration from the environment**, as ECS passes it: `CRAWLER_CONFIG="$(cat deploy/local/crawler.local.json)"`,
  with no `--config`.
- **Proxies, site profiles and block handling:** see `src/pro/crawler/crawler.example.json` and
  [Reference: crawler configuration](reference.md#crawler-configuration).
- **SQS** instead of a file of jobs: add a `queue` block (standard queues only), and the worker takes jobs until it
  is stopped. There is no local SQS in this setup yet (issue #20).

## Trying a recipe on live pages
`deploy/local/live-check/` runs the worker on a few live pages and prints what it read (`--print`, no Elasticsearch),
paced slowly, stopping at the first block. Its README has the steps and how to read the output; the example is an
Amazon product page read for two ZIP codes.

## Stopping and cleaning up
```bash
# Ctrl-C the backend and the site
docker compose -f deploy/local/docker-compose.yml --profile kibana down       # keep the data
docker compose -f deploy/local/docker-compose.yml --profile kibana down -v    # and drop it
```

## Troubleshooting
| Symptom | Cause and fix |
| --- | --- |
| `bulk of N not sent: The operation was aborted due to timeout`, and jobs end `deferred` with "documents not written" | Elasticsearch isn't taking writes. Check `curl -s 127.0.0.1:9200/_cluster/health`. If it is `red`, `curl -s 127.0.0.1:9200/_cluster/allocation/explain?pretty` says why. Usually it's the disk watermark: use this repo's compose file, which turns it off. |
| Every job dead-letters with `no_recipe` | No live recipe matches that competitor, page type and URL. Start the mock with `MOCK_SEED=demo`, or check your recipe's match rules. |
| `recipe_store` errors, jobs deferred | The mock isn't running, or the token differs: `STORE_TOKEN` must equal the mock's token (`dev-token`). |
| `Missing --jobs`, or "Give --jobs <file>, or a queue" | Without a `queue` block, the worker needs `--jobs`. |
| `Executable doesn't exist` when the worker starts | Run `npx playwright install chromium`, or set `CHROMIUM_PATH` to a Chromium binary. |
| Kibana keeps restarting | It waits for Elasticsearch to be healthy. Give it a minute, or check `docker compose -f deploy/local/docker-compose.yml logs kibana`. |
| Pro shows "Sign in again: the token was not accepted" | The Access token in **Backend** must be the mock's token. It is kept until the browser closes, so re-enter it after a restart. |
