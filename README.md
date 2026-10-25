# CrawlPilot Pro (internal)

An internal Chrome extension for building, versioning and maintaining crawl recipes, and sending them to the
cloud crawler backend, which does the crawling at scale.

- **CrawlPilot** (public, `crawlpilot/crawlpilot`) collects data in the browser: pick, run, export.
- **CrawlPilot Pro** (this repo, internal) edits recipes, tests them, versions them, submits them, and checks
  what the backend returns.
- **Crawler backend:** a separate service, out of scope for this repo. Pro only talks to its API.

The plan is in [docs/plans/pro-plan.md](docs/plans/pro-plan.md).
