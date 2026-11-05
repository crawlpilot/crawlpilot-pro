# Reference

Things to look up once you know your way around. The design docs ([HLD](../design/HLD.md), [LLD](../design/LLD.md),
[crawler.md](../design/crawler.md)) explain *why*; this page says *where* and *what*.

## Repository map
| Path | What is there | Owned by |
| --- | --- | --- |
| `src/pro/` | Everything that exists only in Pro (below) | Pro |
| `src/pro/recipe/` | The recipe model: types, digests (`canonical.ts`), file format (`file.ts`), way ids, targeting, diff, selector health and clean-up | Pro |
| `src/pro/db/` | Pro's IndexedDB stores: recipes, versions, label log, samples, drafts, tests, crawls, reviews, way stats, dismissals | Pro |
| `src/pro/pages/` | Pro's screens: Recipes, Editor, History, the Backend, Submit and Targeting dialogs, the Selectors card | Pro |
| `src/pro/runner/` | Testing a recipe on the open page and on sample pages | Pro |
| `src/pro/backend/` | The backend client, its types, submit/review/usage flows, the mock backend and its server | Pro |
| `src/pro/crawler/` | The crawler worker: queue, worker, browser pool, classification, block identification, governor, proxies, Elasticsearch writer, rollup | Pro |
| `src/sidepanel/`, `src/background/`, `src/content/`, `src/shared/` | The public extension: UI, background worker, page scripts, extraction | Upstream |
| `e2e/` | Playwright tests; `e2e/site/` holds the test pages; `pro.ts` and `harness.ts` are the helpers | Both |
| `deploy/crawler/` | The worker's Dockerfile, ECS task definition, IAM policy, deployment steps | Pro |
| `deploy/local/` | The local stack: Elasticsearch and Kibana compose file, local worker config, sample jobs; `live-check/` for trying a recipe on a few live pages | Pro |
| `docs/design/` | HLD, LLD, crawler design, references | Pro |
| `docs/onboarding/` | These pages | Pro |
| `docs/plans/` | Plans, mostly the public extension's | Both |
| `docs/UPSTREAM.md` | How to merge from the public extension | Pro |

## npm scripts
| Script | What it does |
| --- | --- |
| `npm run build` | Type-checks, then builds the extension into `dist/` |
| `npm run dev` | Vite dev server with hot reload (side panel UI only) |
| `npm test` | Unit tests (Vitest) |
| `npm run e2e` | Builds, then all Playwright tests |
| `npm run crawler:build` | Builds the worker into `src/pro/crawler/dist/` (`inpage.js`, `worker.mjs`) |
| `npm run pro:mock` | Builds and runs the mock backend on `:8787` |
| `npm run zip` | Builds the extension and packs `crawlpilot-pro.zip`, with a release check |
| `npm run deadcode` | Lists unused files and exports (knip) |

## The worker's command line
```
node src/pro/crawler/dist/worker.mjs --config <file>                        # jobs from the configured SQS queue
node src/pro/crawler/dist/worker.mjs --config <file> --jobs <file.jsonl> [--dead-letter <file>] [--print]
node src/pro/crawler/dist/worker.mjs --config <file> --setup-elasticsearch  # index templates, once per cluster
node src/pro/crawler/dist/worker.mjs --config <file> --rollup [YYYY-MM-DD]  # one day's selector usage (default: yesterday)
```
Without `--config`, the configuration is read from `CRAWLER_CONFIG`. The worker exits 1 when its browser fails five
times in a row, so the container is replaced. SIGTERM stops it within ECS's 120 s.

## Environment variables
| Variable | Read by | Meaning |
| --- | --- | --- |
| `CRAWLER_CONFIG` | Worker | The configuration as JSON, instead of `--config` |
| `${NAME}` in the configuration | Worker | Any string `${NAME}` is replaced from the environment (tokens, passwords, API keys); a missing one stops it with its name |
| `CRAWLER_HEARTBEAT` | Worker | Heartbeat file for the container health check (default `/tmp/crawler-heartbeat`) |
| `CHROMIUM_PATH` | Worker | Another Chromium binary |
| `PLAYWRIGHT_BROWSERS_PATH` | Playwright | Where Playwright's browsers are |
| `MOCK_PORT`, `MOCK_HOST`, `MOCK_TOKEN` | `npm run pro:mock` | Port (8787), address (127.0.0.1), token (`dev-token`) |
| `MOCK_SEED=demo` or `MOCK_SEED=<file.json>` | `npm run pro:mock` | Start with the demo recipe, or the recipe in that file (`name`, `site`, `competitor`, `pageType`, `spec`), live |
| `HEADED=1` | e2e | Show the browser |
| `CRAWLER_IMAGE` | `e2e/crawler.spec.ts` | Run the worker tests inside this image |

## Crawler configuration
All keys, with defaults, are in `src/pro/crawler/config.ts`. `src/pro/crawler/crawler.example.json` shows a production
configuration, and `deploy/local/crawler.local.json` a local one.

| Key | Default | Meaning |
| --- | --- | --- |
| `workerId` | `worker-1` | Names this worker on every event |
| `concurrency` | 4 | Pages at once, over all sites |
| `robotsAgent` | `CrawlPilotBot` | The token robots.txt groups are matched against |
| `navigationTimeoutMs`, `settleMs` | 30000, 500 | Navigation timeout, extra wait after `load` |
| `pagesPerContext`, `contextIdleMs`, `maxContexts` | 50, 5 min, 50 | Browser context reuse and clean-up |
| `maxListPages`, `followDetails` | 20, true | List recipes: pages per list, details pages as jobs |
| `retry` | 4 attempts, 2 s doubling to 120 s, inline waits up to 15 s, give up after 24 h | `maxAttempts`, `baseDelayMs`, `maxDelayMs`, `maxInlineWaitMs`, `maxJobAgeMs` |
| `sites.default`, `sites["<host>"]` | — | Per-site profile: pace (`minDelayMs`, `maxDelayMs`, `concurrency`), cooldowns (`cooldownBaseMs`, `cooldownMaxMs`, `blockAfter`), `proxyPool`, `proxyCountry`, `locale`, `timezoneId`, `viewport`, `userAgent`, `extraHeaders`, `respectRobots`, `blockResources`. The longest matching host suffix wins over `default` |
| `proxyPools` | `{}` | Named lists of `{ id, server, username?, password?, country?, bypass? }` |
| `recipeStore` | required | `{ url, token }` |
| `search` | required | `{ url, apiKey? or username/password, indexPrefix?, batchSize?, flushMs?, maxBuffer?, timeoutMs? }` |
| `queue` | none (use `--jobs`) | `{ type: "sqs", url, deadLetterUrl, region?, endpoint?, waitSeconds?, visibilitySeconds? }`, standard queues only |

## Elasticsearch indices
| Index | Document | Id |
| --- | --- | --- |
| `scrapes-<competitor>` (`test-` in front for test mode) | One page's values, field status, page status, recipe version | Job id; `jobId~listId~row` for list rows |
| `selector-usage-YYYY.MM` | One page's selector outcomes (`ways`, nested) | Job id |
| `selector-usage-daily-YYYY` | One selector's day: pages, tried, matched, won | `recipeId:wayId:date` |
| `crawl-requests-YYYY.MM.DD` | One attempt: status, headers, timings, proxy, error class, block identification, outcome | Given when written |
| `crawl-sites-YYYY.MM` | A site's state change: cooldown, blocked, back to ok | Given when written |

Mappings are in `src/pro/crawler/templates.ts`. Error classes and what each does are listed in
[crawler.md](../design/crawler.md#error-classes-and-what-happens).

## The backend API
Pro's client (`src/pro/backend/client.ts`) and the worker (`src/pro/crawler/store.ts`) call these endpoints. The mock
implements all of them.
| Call | Used by | What it does |
| --- | --- | --- |
| `POST /recipes` | Pro | Creates a recipe, with its competitor, page type and match rules |
| `POST /recipes/{id}/versions` | Pro | Uploads a version (a format 3 recipe file); the idempotency key is its digest |
| `POST /recipes/{id}/versions/{n}/review` | Pro | Approves or rejects; the reviewer must not be the author |
| `POST /recipes/{id}/labels/live` | Pro | Puts an approved version live |
| `POST /recipes/{id}/crawls`, `GET /crawls/{id}` | Pro | Starts a crawl, follows it |
| `GET /recipes/{id}/ways/stats` | Pro | Daily selector usage, for the selector labels |
| `GET /resolve?competitor=&pageType=&url=` | Worker | The live version for a page, by match rules (cached 60 s) |
| `GET /versions/{digest}` | Worker | A version's file, and whether it is approved (cached for good) |

Every call sends `Authorization: Bearer <token>`.

## Conventions
- **Don't change the public extension.** Pro's code goes in `src/pro/`, `e2e/`, `deploy/`, `docs/design/`,
  `docs/onboarding/` and Pro's build files. Files from upstream get, at most, a small hook point (a route, a
  button), so merges from the public CrawlPilot stay clean. See [UPSTREAM.md](../UPSTREAM.md).
- **Tests come with the change.**
  - Unit tests sit next to the code (`*.test.ts`).
  - A user-visible flow gets an e2e test.
  - A crawler failure mode gets a case in `src/pro/crawler/resilience.test.ts`.
- **Code style:** follow the file you are in. Comments say why. Names are full words.
- **Branches and PRs:**
  - Branch from `main` as `pro/<topic>`.
  - Commit messages say what changed and why.
  - A PR lists what changed and how it was tested (the [checks](local-setup.md#checks-before-a-pull-request)).
- **Secrets** never go in the repo or in documents the worker writes. Configuration uses `${NAME}`. Events carry
  proxy ids, never credentials, and cookie names, never values.
- **Blocks are identified and waited out, never evaded.** The worker doesn't spoof fingerprints, solve captchas, or
  rotate identities to get past bot checks ([crawler.md](../design/crawler.md#blocks-identified-and-resolved-not-evaded)).

## Glossary
| Term | Meaning |
| --- | --- |
| Recipe | What to read from one kind of page (a page recipe) or from lists of items (a list recipe), and how |
| Version | An immutable snapshot of a recipe's spec, identified by its digest |
| Digest | sha256 of the canonical spec, ignoring way ids: two versions that read the same way have the same digest |
| Label | A pointer to a version: `latest`, `test`, `live`. The worker resolves `live` |
| Way | One way to read a field: a selector, or a data binding. A field tries its ways in order; the first match wins |
| Way id | A way's stable id across versions, so its usage is tracked over time |
| Targeting | A recipe's competitor, page type and match rules: which pages it is for |
| Review | Approval or rejection of a version by someone other than its author; only an approved version goes live |
| Selector usage | Per way: pages tried, matched, won. Rolled up daily, and labelled active, dormant, dead or new in Pro |
| Clean up | Pro's proposal to drop dead ways and reorder dormant ones, saved as a `pruned` version |
| Job | One URL for the worker, with competitor and page type, optionally a pinned digest |
| Governor | The worker's per-site pacing and circuit breaker: delays, cooldowns, blocked state |
| Protection | A bot-protection vendor seen on a site (Cloudflare, Akamai, …), blocked or not |
| Soft block | A 200 page with no data, much shorter than the site's usual pages |
| Dead letter | A job the worker gave up on, kept with its reason for a person |
