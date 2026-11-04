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
   A context unused for `contextIdleMs` (5 minutes) is closed, and beyond `maxContexts` (50) the least recently used
   idle ones are; one in use (a page open, robots.txt being fetched) never is.
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
| `rate_limited` | 429; a vendor's rate-limit page (Cloudflare 1015) | Queue, after `Retry-After` or the cooldown | Cooldown, delay doubles | — |
| `waiting_room` | Redirected to a waiting room (Queue-it) | Queue, after the cooldown | Cooldown of `cooldownBaseMs`, delay kept | — |
| `blocked` | A vendor's challenge or block page (below); a soft block; a bare 403 | Queue, after the cooldown | Cooldown grows; `blocked` after 3 in a row | Never moves |
| `captcha` | A vendor's captcha, or a captcha widget or wording on a short or error page | As `blocked` | As `blocked` | Never moves |
| `not_found`, `gone` | 404, 410 | No: failed; scrape written with `pageStatus: not_found` | — | — |
| `client_error` | Other 4xx | No: failed | — | — |
| `server_error` | 5xx | Here, backoff (`Retry-After` if sent) | Delay ×1.5 | — |
| `empty_page` | A 2xx page with almost no text | Here, backoff | — | — |
| `extraction` | The in-page script failed or timed out | Here, backoff | — | — |
| `robots_disallowed` | robots.txt | No: failed | — | — |
| `no_recipe` | No live recipe covers the page; pinned version not approved | Dead letter | — | — |
| `recipe_store` | The store is down or does not answer in time | Queue, backoff | — | — |
| `expired` | Put back for longer than `retry.maxJobAgeMs` (24 h) since it was first taken | Dead letter | — | — |

Out of attempts (`retry.maxAttempts`, counted over every delivery of the job), a retryable job is dead-lettered.

## Block identification
`detect.ts` reads each response for bot protection: the status, response headers, cookie **names** (values are never
read or kept), the page's script and frame URLs, where it was redirected, the title and the visible text. It knows the
marks of Cloudflare, Akamai, DataDome, HUMAN (PerimeterX), Imperva, Kasada, AWS WAF, F5, Radware, Sucuri and Queue-it,
the captcha widgets (reCAPTCHA, hCaptcha, Turnstile, GeeTest, Arkose), and generic block and captcha wording.
- **Presence vs block.** A site's vendor shows on every page: Cloudflare's `__cf_bm` cookie, Akamai's `_abck`,
  DataDome's tag. Those marks name the site's protection (`protection` on every request event) and never make a block.
  A block takes a mark the vendor shows only when it stops a visitor: `cf-mitigated: challenge`,
  `x-amzn-waf-action: captcha`, a 429 with Kasada's `x-kpsdk-*` headers, DataDome's captcha frame, an Akamai reference
  number, an Incapsula incident id, an F5 support id.
- **Where wording counts.** Marks ordinary pages carry too (a captcha widget on a login form, "access denied" in a help
  text) count only on an error status or a short page (under 2,000 characters), as interstitials are.
- **What it is.** Each finding has a kind: `challenge`, `captcha`, `block`, `rate_limit`, `queue` or `soft_block`. It
  also has a confidence: `high` for a vendor's own block marker or two of its marks agreeing, `medium` for its wording
  on a suspicious page, and `low` for generic wording or a bare 403. Generic wording on a site with one known vendor is
  put down to that vendor. The class follows the kind: a queue is a `waiting_room`, a rate limit is `rate_limited`, a
  captcha is `captcha`, and anything else is `blocked`.
- **Soft blocks** (`baseline.ts`). Some blocks are a 200 with an ordinary-looking page and no vendor mark: a "back
  soon" stub, an empty shell. Per host and page type, the worker keeps the typical text length of pages the recipe got
  data from (after 5 such pages). A page that gives the recipe nothing and is under 30% of that length is a
  `soft_block` (`blocked`, medium confidence). A page of usual length with no data is left alone: that is a recipe that
  no longer fits, which Pro's maintenance flags.
- **For people.** A blocked attempt's request event carries `blockVendor`, `blockKind`, `blockConfidence` and
  `blockEvidence`: the title, the start of the text, the hosts of its scripts and frames, and its cookie names. These let
  a person check the identification and add a signature when a vendor changes its pages. Site events name the vendor
  that moved the site to `cooldown` or `blocked`.

Identification decides what the worker does and what people see. It never decides to get past a block: see below.

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
| `crawl-requests-YYYY.MM.DD` | Attempt | Given when written | Status, kept headers and every header name, request headers (user agent, language), redirects, bytes, timings, proxy id and country, error class and message, block signal, `Retry-After`, next attempt, outcome, recipe |
| `crawl-sites-YYYY.MM` | Site state change | Given when written | `cooldown`, `blocked`, back to `ok`, with the reason and delay |
| `scrapes-<competitor>` | Page | `jobId` | The values read (`attributes`, stored, not indexed: types differ by recipe), field status, page status, recipe version |
| `selector-usage-YYYY.MM` | Page | `jobId` | `ways` nested: field, way id, tried, matched, won. Pro's selector labels add these up per way id |

Request events also carry what block identification found (`blockVendor`, `blockKind`, `blockConfidence`,
`blockEvidence`), the protection seen (`protection`) and the page's `textLength`; site events carry the block's `vendor`.

`test-` is put in front of the scrape and usage indices for `mode: 'test'`. A redelivered job overwrites its scrape and
usage documents. Events get their id when written and are created, so a bulk sent again (a timeout after Elasticsearch
had it) finds them there (409, taken as written) instead of adding them twice. Proxy credentials never reach a document: events carry the proxy's id and country.

The writer batches (`batchSize`, `flushMs`), retries when Elasticsearch is down, re-sends items rejected with 429, and
drops the oldest documents past `maxBuffer` with a log line. Request and site events are best effort: crawling never
waits on telemetry. Scrape and usage documents are confirmed: a job is acknowledged only once Elasticsearch has them
(below, Resilience). Each bulk request times out after `timeoutMs` (30 s).

## Resilience
What the worker does when its own dependencies fail, so one fault never takes the whole worker down or empties
the queue (`resilience.test.ts` covers each):
- **A job's attempt** has a deadline (navigation, `load`, extraction or list reading, and a margin). Past it the page is
  closed and the attempt is a `timeout`. The site's slot is given back exactly once, whatever throws.
- **A busy site** is waited for at most `retry.maxInlineWaitMs`; then the job goes back on the queue, no attempt counted.
- **The recipe store down** (or not answering within 15 s): the job waits 30 s, doubling to 10 minutes (`storeFailures` on the job), and no attempt is
  counted. **A paused recipe**: its jobs wait 10 minutes and come back, never dropped.
- **The browser** (`browser`): a crash or out-of-memory kill disconnects it; the pool forgets it and its contexts and the
  next page starts a new one. A dead browser or context is not the job's fault: the job comes back in 5 s, its attempt
  not counted. Five browser failures in a row stop the worker with exit code 1, so the task is replaced. A page that
  crashes its own tab (`page_crashed`) is the page's, and counted.
- **The queue**: putting a job back is a send then a delete; a delete that fails is tried twice more, and if the old
  message still comes back, the job runs once more, harmlessly (keyed documents and follow-ups). A settle that
  fails (ack, re-queue, dead letter, follow-ups) is logged and the message left to come back when its visibility
  ends; a receive that fails is tried again after 1 s, doubling to 30 s. One message that can't be moved doesn't
  cost the rest of its batch.
- **A job's results**: the job is acknowledged only once Elasticsearch confirms its scrape and usage documents. A
  document refused (a mapping conflict, a 401), dropped from a full buffer, or not confirmed within 2 minutes puts the
  job back for a minute, its attempt not counted, to be read again; its documents are keyed, so nothing is doubled.
  Five times in a row (`writeFailures` on the job) and it is dead-lettered: a refusal that lasts is not an outage.
  Waiting holds the job's slot, so a worker stops crawling while Elasticsearch is away instead of reading pages it
  can't keep.
- **A long job** (a list clicked through, retries on a slow site) keeps its SQS message hidden: its visibility is
  renewed every half `visibilitySeconds` until it is settled, so it is never handed to a second worker.
- **A job put back again and again** (a site that stays blocked, a store that stays down): stamped `firstSeenAt` the
  first time, and dead-lettered (`expired`) once older than `retry.maxJobAgeMs`, for a person to look at.
- **Stopping** (SIGTERM): no new attempt starts, and jobs not yet at the page go back on the queue at once. Attempts in
  progress get 60 s, then are abandoned and their jobs put back, uncounted; a second signal abandons them at once.
  Then Elasticsearch is flushed for at most 30 s (what is left is reported) and the browser closed within 10 s: all
  inside ECS's 120 s `stopTimeout`.
- **Liveness**: while jobs settle, the worker touches a heartbeat file; jobs in flight with none settled for 15 minutes
  stop it, and the container health check (`deploy/crawler/ecs-task-definition.json`) replaces the task.
- A stray rejected promise is logged, not fatal.

## List recipes
A list recipe's page is read with each list's frozen fields (the List Extractor's own `readWhenReady`), one scrape
document per row (id `jobId~listId~row`, with `listId`, `row` and `page`).
- **Infinite scroll** (`auto`): the page is scrolled to the end first, until it stops growing (at most `maxListPages`).
- **Load more**, and **Next controls that are buttons**: clicked, waited for and read again, up to `maxListPages`, until
  the control is gone or disabled or nothing new comes. Rows read twice count once.
- **Next controls that are links**: the next page is a job of its own (`jobId~p2`, `~p3`…, up to `maxListPages`),
  pinned to the same version, so every page of one list is read with one recipe and has its own retries and telemetry.
- **Details pages** (`followDetails`): each row's page is a job of its own (`jobId~d<list>.<row>`), pinned to the same
  version and run with its details recipe; its scrape document carries `parent` (the list page's job, list and row) to
  join it back. Two rows linking to one page share one job.

Follow-up jobs are queued before the list page's job is acknowledged; their ids are stable, so a page read again
queues the same jobs, which overwrite the same documents. List fields have no way ids, so lists write no selector
usage; their details pages do.

## Queue
`queue.ts` takes jobs from a `JobQueue`: a file of jobs (`--jobs`), or Amazon SQS (`sqs.ts`, the `queue` setting):
- long polling, at most 10 at a time; a received job is hidden for `visibilitySeconds`, so a job a worker dies on
  comes back to another worker;
- done: deleted. Deferred: sent again with its attempts and a `notBefore`; SQS delays a message 15 minutes at most,
  and a job that arrives early is sent again for the rest. Dead letter: sent to `deadLetterUrl` with the reason;
- follow-up jobs go ten at a time; a refused one leaves the job that led to them unacknowledged;
- a running job's message stays hidden: its visibility is renewed while the job runs.

Standard queues only; a FIFO queue is refused. FIFO holds a competitor's other jobs back while one is in flight
or waiting out a cooldown, and drops a job put back within five minutes as a duplicate. The site governor paces
instead, and job ids make a page read twice harmless.

SIGTERM (a container stopping) or Ctrl-C: see Resilience, Stopping.

## Daily rollup
`--rollup [YYYY-MM-DD]` (yesterday by default; `rollup.ts`) adds up a day's `selector-usage-*` per recipe and way,
counting only pages that loaded and leaving test crawls out, into `selector-usage-daily-YYYY`, id
`recipeId:wayId:date`, so a rerun replaces the day. These are the days the store's `/ways/stats` returns and Pro labels
selectors from. Run it once a day after midnight UTC (`deploy/crawler/README.md`).

## Running it
```
npm run crawler:build
node src/pro/crawler/dist/worker.mjs --config crawler.json                       # jobs from the configured SQS queue
node src/pro/crawler/dist/worker.mjs --config crawler.json --jobs jobs.jsonl     # or a file of jobs
node src/pro/crawler/dist/worker.mjs --config crawler.json --setup-elasticsearch # templates, once per cluster
node src/pro/crawler/dist/worker.mjs --config crawler.json --rollup              # yesterday's selector usage
```
The configuration is `--config <file>` or the JSON in `CRAWLER_CONFIG`. `crawler.example.json` shows every setting;
`${NAME}` in a string is read from the environment (proxy passwords, the store token, the Elasticsearch key).
`CHROMIUM_PATH` points at another Chromium. Jobs are JSON:
`{ "jobId", "url", "competitor", "pageType", "recipeDigest"?, "mode"?, "runId"?, "meta"? }`.

The container image and an ECS on Fargate deployment are in `deploy/crawler/` (`README.md` there).
To run the worker on your laptop against a local Elasticsearch and the mock backend, see
[docs/onboarding/running-locally.md](../onboarding/running-locally.md).

## Not built yet
- The SQS adapter is tested against a fake client only, not a real queue or an SQS-compatible server.
- A slimmer image (Chromium's headless shell only): see `deploy/crawler/README.md`.
- Infrastructure as code (the deployment is JSON templates and steps).
- Lists read from the page's JSON rather than its DOM are read as the List Extractor reads them, but untested here.
