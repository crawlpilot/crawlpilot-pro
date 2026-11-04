# Onboarding

Start here when you join the CrawlPilot Pro team. These pages get you from a fresh clone to running the whole system on
your laptop: the extension, a backend, the crawler worker, and Elasticsearch with Kibana. They also tell you where to
look things up afterwards.

| Page | What it is for | Time |
| --- | --- | --- |
| [Local setup](local-setup.md) | Install, build, load the extension, run the tests | 30 min |
| [Running locally](running-locally.md) | The whole loop on your laptop: build a recipe, review it, crawl with it, read the results | 45 min |
| [Reference](reference.md) | Repo map, scripts, configuration, environment variables, indices, conventions, glossary | Look things up |

## What you are working on
CrawlPilot Pro manages **crawl recipes** over their whole life. A recipe says which fields to read from a kind of page,
and how. Pro covers building it, testing it, versioning it, having it reviewed, putting a reviewed version live, and
watching which selectors still work so the dead ones can be cleaned up. The **crawler worker** then reads pages at scale
with the live version.

```
 Chrome extension (Pro)            recipe store (backend API)             crawler worker (AWS, ECS)
 ─────────────────────             ──────────────────────────             ─────────────────────────
 build / edit a recipe   ──submit──▶  versions, reviews, `live`  ◀─resolve─  job: URL + competitor + page type
 test on pages                         match rules per recipe                 Chromium, proxies, block handling
 review, mark live       ──review──▶                                                │
 selector usage labels   ◀─/ways/stats── daily usage rollup  ◀──────────── Elasticsearch / OpenSearch
 clean up dead selectors                                                      scrapes, selector usage, telemetry
```

- **The extension** is a fork of the public CrawlPilot extension. Pro's own code is in `src/pro/`. Everything else
  comes from upstream and is changed only at small hook points (see [Reference: conventions](reference.md#conventions)).
- **The recipe store** is the backend API Pro submits to and the worker reads from. Its real implementation lives
  outside this repo. Here you get a mock with the same API, `src/pro/backend/mock.ts`, which you can run on a port with
  `npm run pro:mock`.
- **The crawler worker** is in `src/pro/crawler/`. It is a Node program driving Chromium through Playwright, and it
  runs the extension's own extraction code inside each page. It is deployed as a container on ECS Fargate, taking jobs
  from SQS (`deploy/crawler/`).

## Your first day
1. Follow [Local setup](local-setup.md) until `npm test` passes and the extension opens in Chrome.
2. Follow [Running locally](running-locally.md) once from start to end. Seeing a recipe go from your browser to a
   document in Elasticsearch is the fastest way to learn how the parts fit.
3. Read the design docs in this order:
   - [HLD](../design/HLD.md): the system and its parts.
   - [LLD](../design/LLD.md): the recipe model, versions, reviews and selector usage.
   - [crawler.md](../design/crawler.md): the worker, its error classes, block identification and resilience.
4. Skim `e2e/pro-recipes.spec.ts` and `e2e/crawler.spec.ts`. Each test reads as a user story of one feature, and
   they are the most exact description of how things behave.

## Getting help
- Open work and known gaps are GitHub issues on `crawlpilot/crawlpilot-pro`. Look there before filing a new one.
- CI on GitHub Actions currently fails on every run for reasons unrelated to the code (issue #15). Until that is
  fixed, run the checks in [Local setup](local-setup.md#checks-before-a-pull-request) yourself before asking for review.
