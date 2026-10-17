# CrawlPilot

A Chrome extension (Manifest V3) for scraping and for building scrapers: extract lists and pages
without code, and inspect any page to see where its data lives, what protects it, and which
selectors will last.

## Features

**Extract**
- **List Extractor**: pick one item, get every similar item as rows; next-button, load-more and
  infinite-scroll pagination; rows repeated across pages are dropped; each run records rows per page
  and why it stopped.
- **Page Extractor**: pick fields once, run them over many URLs in background tabs. URLs come from a
  CSV, an earlier table, or **site discovery** (sitemaps + page links, grouped by path pattern).
  Fields can be **filled from a schema by Chrome's on-device AI**: every value is checked against the
  page and turned into selectors, so bulk runs need no AI.
- **Metadata Extractor**, **Image Downloader**, **Email Extractor**, **Text Summarizer** (on-device AI).

**Run safely**
- Every page is checked before extraction: bot checks (pause so you can solve them), blocks, rate
  limits (back off and retry), waiting rooms, login walls and soft 404s are recorded, not saved as rows.
- Per-site minimum gap across all tabs, delay jitter, verdict counts in History.

**Scraper Toolkit**
- **Page Recon**: rendering (served vs JavaScript), embedded data (JSON-LD, `__NEXT_DATA__`, app
  state, microdata, OpenGraph), bot-protection vendors, robots.txt, sitemaps, pagination, and a
  one-line recommendation.
- **Selector Lab**: test CSS/XPath live, Strong/Fragile/Broken grades with reasons, graded
  alternatives for a picked element, copy as Playwright, Puppeteer, Selenium, Scrapy, BeautifulSoup
  or Cheerio.
- **API Finder**: record the page's JSON calls, point at a value to find the response and JSON path
  that hold it, save the list as a table, export the request as cURL / Python / fetch / Scrapy.

**Data**
- Data viewer (IndexedDB) with filters, merges and **typed columns**: detect and clean money (with
  currency), numbers, counts, percentages, ratings, dates and URLs; raw values are kept.
- Export to CSV, JSON, Markdown, webhook, Airtable.

Nothing leaves the browser unless you export it. The on-device model runs locally.

## Development

Requires Node.js 18+.

```bash
npm install
npm run dev      # Vite dev build with HMR
npm test         # Vitest (jsdom)
npm run build    # type-check + production build into dist/
npm run zip      # build and package chrome-extension.zip
```

Load the extension: `chrome://extensions` → Developer mode → **Load unpacked** → `dist/`.

## Layout

```
src/
  background/        service worker: bulk and metadata orchestrators, tab pool
  content/           content script: picker, pagination, extraction, recon, lab, AI page view
  sidepanel/         React UI (pages, wizard steps, toolkit panels, data viewer)
  shared/            pure, tested modules used by all three:
    selectors/       stability rules, resolver, grades, code snippets
    verdict/         page classification and bot-manager detection
    listing/         per-page run stats and stop reasons
    recon/           robots.txt, recommendation
    network/         JSON value search, request export, paging params
    transforms/      value parsers, transform chains, type detection
    discovery/       sitemap parsing, URL patterns, filters
    ai/              schema intake, prompt and grounding for on-device extraction
public/net-hook.js   API Finder page hook (MAIN world, only while recording)
docs/plans/          plans (see scraper-toolkit-plan.md)
```
