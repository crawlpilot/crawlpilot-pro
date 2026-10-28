# Crawler worker

The worker takes crawl jobs (one URL each), reads the page with the reviewed recipe version, and writes the result,
selector usage and request telemetry to Elasticsearch. Code: `src/pro/crawler/`. Tracking issues: #7 (workers) and #8
(one extraction engine).

## How a job runs
1. **Recipe.** The job's pinned version (`recipeDigest`; approved only, unless `mode: 'test'`), or the `live` version
   the recipe store resolves for the job's competitor, page type and URL (`store.ts`). Resolves are cached for a minute,
   versions for good; a version's spec is digested again and refused on a mismatch.
2. **The site's turn** (`governor.ts`). Requests to one host start at least the site's delay apart, at most its
   concurrency at once. A site cooling down puts the job back on the queue instead of holding a worker.
3. **Proxy and robots.txt** (`proxies.ts`, `robots.ts`). A host keeps one proxy from its pool while that proxy works.
   robots.txt is fetched through the same proxy and respected unless the site's profile says otherwise.
4. **Visit** (`browser.ts`). Chromium, one context per site and proxy (cookies kept between pages, renewed after
   `pagesPerContext`), rendering as the site's profile says: locale, timezone, viewport, user agent, extra headers.
5. **Classify** (`classify.ts`), then, on a good page, **extract** (`inPage.ts`): the extension's own `extractPage`,
   unchanged, bundled into one script, so a page reads the same here as in Pro's Test on this page. Values are cleaned
   and checked with Pro's own `readPageResult`.
6. **Decide** (`retry.ts`): retry here, put back on the queue, or finish (done, failed, dead letter).

## Error classes and what happens

| Class | From | Retry | Site | Proxy |
| --- | --- | --- | --- | --- |
| `dns`, `connection`, `timeout`, `proxy` | Chromium net error | Here, backoff, another proxy | — | Set aside after 2 |
| `proxy_auth` | 407, proxy auth error | Here, another proxy | — | Set aside at once |
| `tls`, `navigation` | Certificate error, redirect loop | No: failed | — | — |
| `rate_limited` | 429 | Queue, after `Retry-After` or the cooldown | Cooldown, delay doubles | — |
| `blocked` | 403; challenge headers or page (Cloudflare, DataDome, PerimeterX, Imperva, Akamai, block wording) | Queue, after the cooldown | Cooldown grows; `blocked` after 3 in a row | Never moves |
| `captcha` | Captcha wording on a short page or an error page | As `blocked` | As `blocked` | Never moves |
| `not_found`, `gone` | 404, 410 | No: failed; scrape written with `pageStatus: not_found` | — | — |
| `client_error` | Other 4xx | No: failed | — | — |
| `server_error` | 5xx | Here, backoff (`Retry-After` if sent) | Delay ×1.5 | — |
| `empty_page` | A 2xx page with almost no text | Here, backoff | — | — |
| `extraction` | The in-page script failed or timed out | Here, backoff | — | — |
| `robots_disallowed` | robots.txt | No: failed | — | — |
| `no_recipe` | No live recipe covers the page; pinned version not approved | Dead letter | — | — |
| `recipe_store` | The store is down | Queue, backoff | — | — |

Out of attempts (`retry.maxAttempts`, counted over every delivery of the job), a retryable job is dead-lettered.

Captcha and challenge wording on a **2xx** page counts only when the page is short, as block pages are: shop pages
often load a captcha script for a newsletter form, and that is not a block. On 4xx and 5xx pages it always counts.

## Blocks: identified and resolved, not evaded
A block is resolved by slowing down and waiting, never by changing who is asking. Per host:
- 429: the delay doubles; the site cools down for `Retry-After`, or the delay, whichever is longer.
- Block or captcha: the delay doubles; cooldown `cooldownBaseMs × 2^(n−1)` for the n-th block in a row; after
  `blockAfter` in a row the site is `blocked` for `cooldownMaxMs` and a site event asks a person to look.
- When a cooldown ends one request probes the site; a success puts it back to `ok`, and each success shortens the
  delay by 10%, down to `minDelayMs`.

A proxy changes only for failures at the proxy's end. The worker does not spoof browser fingerprints, solve captchas,
or rotate identities to get past a block: those defeat a site's access controls, and the Pro plan leaves getting past
bot checks to the backend team's policy.

## Elasticsearch
Install the templates once per cluster: `node src/pro/crawler/dist/worker.mjs --config crawler.json --setup-elasticsearch`.

| Index | One document per | Id | Notes |
| --- | --- | --- | --- |
| `crawl-requests-YYYY.MM.DD` | Attempt | — | Status, kept headers and every header name, request headers (user agent, language), redirects, bytes, timings, proxy id and country, error class and message, block signal, `Retry-After`, next attempt, outcome, recipe |
| `crawl-sites-YYYY.MM` | Site state change | — | `cooldown`, `blocked`, back to `ok`, with the reason and delay |
| `scrapes-<competitor>` | Page | `jobId` | The values read (`attributes`, stored, not indexed: types differ by recipe), field status, page status, recipe version |
| `selector-usage-YYYY.MM` | Page | `jobId` | `ways` nested: field, way id, tried, matched, won. Pro's selector labels add these up per way id |

`test-` is put in front of the scrape and usage indices for `mode: 'test'`. A redelivered job overwrites its scrape and
usage documents. Proxy credentials never reach a document: events carry the proxy's id and country.

The writer batches (`batchSize`, `flushMs`), retries when Elasticsearch is down, re-sends items rejected with 429, and
drops the oldest documents past `maxBuffer` with a log line: crawling never waits on telemetry.

## Running it
```
npm run crawler:build
node src/pro/crawler/dist/worker.mjs --config crawler.json --jobs jobs.jsonl --dead-letter dead.jsonl
```
`crawler.example.json` shows every setting; `${NAME}` in a string is read from the environment (proxy passwords, the
store token, the Elasticsearch key). `CHROMIUM_PATH` points at another Chromium. Jobs are JSON lines:
`{ "jobId", "url", "competitor", "pageType", "recipeDigest"?, "mode"?, "runId"?, "meta"? }`.

## Not built yet
- An SQS queue adapter (`JobQueue` in `queue.ts`); the command line reads a file of jobs.
- List recipes: the worker runs page recipes only.
- A daily rollup of selector usage; the store can aggregate the nested `ways` with a date histogram meanwhile.
- A container image and its deployment (ECS on Fargate, or Lambda).
