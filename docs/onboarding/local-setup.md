# Local setup

From a fresh clone to a built extension in Chrome and a passing test suite. Commands are run from the repository root.

## Prerequisites
| Tool | Version | Used for |
| --- | --- | --- |
| Node.js | 22 (20 at least) | Everything; the worker is built for Node 20+ |
| npm | Comes with Node | Installing, scripts |
| Google Chrome or Chromium | Current | Loading the extension by hand |
| Docker with Compose | Docker 24+, Compose v2 | Local Elasticsearch and Kibana, the worker's image (optional on day one) |
| Python 3 | Any 3.x | Serving the test site in [Running locally](running-locally.md) (or any static file server) |
| git | Any | |

macOS and Linux work as described. On Windows, use WSL 2.

## Install
```bash
git clone https://github.com/crawlpilot/crawlpilot-pro.git
cd crawlpilot-pro
npm ci                                   # exact versions from package-lock.json
npx playwright install chromium          # the browser the e2e tests and the crawler worker drive
```
If the Playwright install cannot download, for example behind a proxy, Playwright's docs cover `HTTPS_PROXY`.
`PLAYWRIGHT_BROWSERS_PATH` lets you point it at browsers already on disk.

## Build and load the extension
```bash
npm run build          # type-checks, then builds the extension into dist/
```
1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and choose the `dist/` folder.
3. Pin CrawlPilot Pro, then click its icon. The side panel opens on Pro's **Recipes** screen.

After a code change, run `npm run build` again and click the reload arrow on the extension's card. `npm run dev`
starts Vite's dev server with hot reload, but it suits the side panel's UI only. Use a full build for anything that
touches the background worker or content scripts.

Debugging:
- **Side panel:** right-click inside it, then **Inspect**.
- **Background service worker:** click **Inspect views: service worker** on the extension's card.
- **Pro's data** is in IndexedDB: DevTools → Application → IndexedDB → `crawlpilot-pro`. Its settings are in
  `chrome.storage`: the backend address is in local storage, and the token in session storage, so it is gone when
  the browser closes.

## Run the tests
| Command | What it runs | Time |
| --- | --- | --- |
| `npx tsc --noEmit -p .` | Type check | ~20 s |
| `npm test` | Unit tests (Vitest, jsdom, fake IndexedDB): about 970 tests | ~2 min |
| `npx vitest run src/pro/crawler` | Just the crawler's unit tests | ~10 s |
| `npm run e2e` | Builds, then every Playwright test: the extension loaded in Chromium, plus the crawler worker | The longest: run it before a PR that touches shared code |
| `npx playwright test e2e/pro-recipes.spec.ts` | Pro's screens end to end (after `npm run build`) | ~1.5 min |
| `npx playwright test e2e/crawler.spec.ts` | The worker against local fake sites, a fake Elasticsearch and the mock backend | ~30 s |

Useful switches:
- `HEADED=1 npx playwright test e2e/pro-recipes.spec.ts` shows the browser while the test runs.
- `npx playwright test -g "submit"` runs only the tests whose name matches.
- A failed e2e test keeps a trace. Open it with `npx playwright show-trace test-results/<test>/trace.zip`.
- `CRAWLER_IMAGE=crawlpilot-crawler:dev npx playwright test e2e/crawler.spec.ts` runs the worker tests inside the
  container image. Build the image first (below).

## Build the crawler worker
```bash
npm run crawler:build      # src/pro/crawler/dist/: inpage.js (injected into pages) and worker.mjs (the program)
node src/pro/crawler/dist/worker.mjs --config <file> --jobs <jobs.jsonl>
```
Running it against real services is in [Running locally](running-locally.md).

The container image, optional, is the same image ECS runs:
```bash
docker build -f deploy/crawler/Dockerfile -t crawlpilot-crawler:dev .
```
It is about 3.5 GB, because it is built on Microsoft's Playwright image.

## Checks before a pull request
CI is not reliable yet (issue #15), so run these yourself and say in the PR that you did:
```bash
npx tsc --noEmit -p .
npm test
npm run build
npm run crawler:build                                              # when you touched src/pro/crawler
npx playwright test e2e/pro-recipes.spec.ts e2e/crawler.spec.ts    # the Pro and crawler e2e tests
```
Run the whole `npm run e2e` when you touched code shared with the public extension, such as extraction or the picker.

## Troubleshooting
| Symptom | Cause and fix |
| --- | --- |
| `Executable doesn't exist at …/chromium-…` | Playwright's browser is missing: run `npx playwright install chromium` |
| An e2e test times out loading the extension | Run `npm run build` first; the e2e tests load `dist/` |
| The side panel shows a blank page after a change | Reload the extension on `chrome://extensions`, then reopen the panel |
| `npm ci` fails on a lock file mismatch | Use Node 22 and npm 10; don't run `npm install` to "fix" the lock file in a PR |
