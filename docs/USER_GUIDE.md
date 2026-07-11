# CrawlPilot — User Guide

> **Version**: 1.0  
> **Last Updated**: June 2026  
> **Platform**: Google Chrome (Manifest V3 extension)

---

## Table of Contents

1. [What is CrawlPilot?](#1-what-is-crawlpilot)
2. [Installation](#2-installation)
3. [Prerequisites & Permissions](#3-prerequisites--permissions)
4. [Opening the Extension](#4-opening-the-extension)
5. [Features & User Flows](#5-features--user-flows)
   - 5.1 [List Extractor](#51-list-extractor)
   - 5.2 [Page Extractor](#52-page-extractor)
   - 5.3 [Metadata Extractor](#53-metadata-extractor)
   - 5.4 [Text Summarizer](#54-text-summarizer)
   - 5.5 [Image Downloader](#55-image-downloader)
   - 5.6 [Browser Utilities](#56-browser-utilities)
   - 5.7 [History](#57-history)
   - 5.8 [Data Table (Saved Data)](#58-data-table-saved-data)
   - 5.9 [Settings](#59-settings)
6. [Exporting Data](#6-exporting-data)
7. [Example Use Cases](#7-example-use-cases)
8. [Troubleshooting](#8-troubleshooting)
9. [FAQ](#9-faq)
10. [Release Notes](#10-release-notes)

---

## 1. What is CrawlPilot?

CrawlPilot is a Chrome browser extension that lets you **extract structured data from any website without writing code**. Whether you need product listings, article metadata, images, or bulk data from hundreds of pages, CrawlPilot handles it through a visual point-and-click interface.

**Core capabilities at a glance:**

| Tool | What it does |
|------|-------------|
| **List Extractor** | Scrape repeated items from a page (products, articles, listings) with infinite scroll or pagination support |
| **Page Extractor** | Feed a list of URLs and extract specific fields from each page in bulk |
| **Metadata Extractor** | Pull Open Graph, JSON-LD, Twitter Card, and other meta tags from multiple URLs |
| **Text Summarizer** | Extract and AI-summarize the main text content of a page |
| **Image Downloader** | Scan a page for all images and bulk-download them as a ZIP |
| **Browser Utilities** | Unlock right-click on pages that disable it |

All extracted data is stored **locally on your device** using IndexedDB — nothing is uploaded to a server unless you configure an integration.

---

## 2. Installation

### Install from Source (Developer Mode)

> Until CrawlPilot is published to the Chrome Web Store, load it manually:

1. **Download or clone** the CrawlPilot repository to your computer.
2. **Build the extension** (requires Node.js 18+):
   ```bash
   npm install
   npm run build
   ```
   This creates a `dist/` folder.
3. Open Chrome and navigate to `chrome://extensions`.
4. Toggle **Developer mode** on (top-right corner).
5. Click **Load unpacked**.
6. Select the `dist/` folder inside the project directory.
7. CrawlPilot now appears in your extensions list.

**Pin it to your toolbar** for easy access: click the puzzle icon in Chrome's toolbar → find CrawlPilot → click the pin icon.

---

## 3. Prerequisites & Permissions

### Browser Requirements

- **Google Chrome** version 114 or higher (Manifest V3 support required)
- Other Chromium-based browsers (Edge, Brave, Arc) may work but are not officially tested

### Permissions the Extension Requests

When you install CrawlPilot, Chrome will ask you to grant the following permissions:

| Permission | Why it is needed |
|-----------|-----------------|
| **Active Tab** | Reads the URL and title of the tab you are currently viewing so tools know where to operate |
| **Scripting** | Injects interaction scripts into pages to select elements, scroll, click, and extract data |
| **Storage** | Saves your preferences (language, settings) in Chrome's local storage |
| **Side Panel** | Displays the CrawlPilot UI in Chrome's built-in side panel |
| **Downloads** | Allows bulk image downloads via `chrome.downloads` API |
| **Alarms** | Keeps the extension's background service worker alive during long extraction jobs |

### Optional Host Permission

On first use of certain tools (especially List Extractor and Page Extractor), Chrome will prompt:

> *"Allow CrawlPilot to access all websites?"*

Click **Allow** to enable extraction on any website. Without this permission, scripts cannot be injected into pages and data cannot be extracted.

You can review and revoke this at any time: `chrome://extensions` → CrawlPilot → **Details** → **Site access**.

### Pages Where CrawlPilot Cannot Operate

- `chrome://` URLs (Chrome's internal pages)
- `chrome-extension://` URLs
- Chrome Web Store pages (`chrome.google.com/webstore/...`)
- PDF files opened in the browser
- Pages inside sandboxed iframes (cross-origin)

---

## 4. Opening the Extension

1. Navigate to any website you want to extract data from.
2. Click the **CrawlPilot icon** in your Chrome toolbar.  
   — If the icon isn't visible, click the puzzle piece → CrawlPilot.
3. CrawlPilot opens as a **side panel** on the right side of your browser.

**Connection status**: The top of the panel shows a connection banner. If it says "Tab not connected", click **Connect Tab** to link the side panel to your active page.

**Navigation**: Use the icons in the left sidebar to switch between tools (List Extractor, Page Extractor, etc.).

---

## 5. Features & User Flows

---

### 5.1 List Extractor

**What it does**: Extracts structured data from pages with repeated elements — product grids, article feeds, directory listings, job boards, etc. Supports infinite scroll, "Load More" buttons, and classic pagination.

#### When to use it
- A page shows a grid of 50 products, and you want all their names, prices, and URLs
- A blog lists 200 articles with titles and dates across 10 pages
- A job board shows job listings with infinite scroll

#### Step-by-Step Guide

**Step 1 — Open List Extractor**  
Click **List Extractor** in the side panel navigation.

**Step 2 — Select the Container**  
1. Click the **"Pick Container"** button (crosshair icon). The page dims and element outlines appear as you hover.
2. Hover over the element that **wraps all your list items** (e.g., the `<ul>` or `<div class="product-grid">`). Siblings highlight in green to confirm you found the right level.
3. Click to confirm. CrawlPilot shows the detected CSS selector.

> **Tip**: If the container is selected too broadly or too narrowly, use the **up/down arrows** in the picker toolbar to navigate to a parent or child element.

**Step 3 — Select an Item**  
1. Click **"Pick Item"**. This time, hover over a single **repeating item** within the container (one product card, one article row).
2. Click to confirm. CrawlPilot automatically detects sibling items and shows how many items it found on the current page.

**Step 4 — Review & Edit Schema**  
CrawlPilot analyzes the selected item and auto-generates columns (fields it detected, such as Title, Price, Image, URL). An editable schema table appears:
- **Rename** columns to friendlier names
- **Delete** columns you don't need
- **Add** custom columns with your own CSS selectors

**Step 5 — Configure Pagination** (optional)  
Choose how to collect data beyond the first page:

| Option | When to use |
|--------|------------|
| **None** | Single page only |
| **Auto-scroll (Infinite Feed)** | Pages like Twitter, Instagram, LinkedIn feeds that load more as you scroll |
| **Auto-scroll (Static List)** | Lists where items appear in order as you scroll down |
| **Pagination (Next Button)** | Classic next-page buttons |
| **Load More Button** | A "Show More" or "Load More" button that expands the list |

For button-based options, CrawlPilot will ask you to click the next/load-more button so it can identify it.

**Configure scroll settings**:
- **Max pages**: How many pages or scroll cycles to process (default: 10)
- **Speed**: Scroll/click speed — slower is safer on heavy sites

**Step 6 — Start Extraction**  
Click **Start Extraction**. The panel shows:
- A live **item count** increasing as data flows in
- A **progress bar** for paginated extractions
- A **Stop** button if you need to halt early

**Step 7 — View Results**  
When complete, click **View Data** to open the full data table in a new tab, or go to **History** to manage saved jobs.

#### Example: Scraping an E-commerce Product Grid

> **Site**: An online bookstore showing books in a grid  
> **Goal**: Collect title, author, price, and product URL for 200 books

1. Open the bookstore category page in Chrome.
2. Open CrawlPilot → List Extractor.
3. Pick container: hover over the `<div class="book-grid">` (all books highlighted).
4. Pick item: hover over one `<div class="book-card">`.
5. CrawlPilot detects columns: **Title** (h3), **Author** (span.author), **Price** (span.price), **URL** (a href).
6. Set pagination: **Pagination (Next Button)**, click the "Next >" button.
7. Set max pages to 20, speed to Medium.
8. Click Start — watch the count climb. When done, export as CSV.

---

### 5.2 Page Extractor

**What it does**: Takes a list of URLs and visits each one to extract specific fields, running multiple pages in parallel.

#### When to use it
- You have 500 product detail page URLs and need the description, SKU, and price from each
- You want to pull the headline and author from 100 specific news article URLs
- You need to click "Accept Cookies" then grab data from each page

#### Step-by-Step Guide

**Step 1 — Open Page Extractor**  
Click **Page Extractor** in the side panel.

**Step 2 — Enter URLs**  
Paste your list of URLs, one per line, into the URL input area.

```
https://example.com/product/123
https://example.com/product/456
https://example.com/product/789
```

You can paste from a spreadsheet column, a text file, or your clipboard.

**Step 3 — Define the Extraction Schema**  
Click **Add Element** to add each field you want to extract:

For each element:
1. Give it a **name** (e.g., "Product Title")
2. Click **Pick on Page** — navigate to one of your target URLs and click the element you want
3. Choose the **action**:
   - **Extract** — grab text, href, or src value
   - **Click** — click this element before extracting (e.g., expand a dropdown, accept a popup)
4. Repeat for each field

**Step 4 — Configure Job Settings**  
- **Concurrent tabs**: How many URLs to process simultaneously (default: 5, max recommended: 10)
- **Page load timeout**: Seconds to wait for each page to load before extracting (default: 5s)

**Step 5 — Run the Job**  
Click **Start**. The panel shows:
- Each URL's status: Queued → Extracting → Done / Error
- Overall progress (e.g., "47 / 500 complete")

Pages open in background tabs automatically. Chrome may throttle tabs if many are open — keep concurrent tabs at 5 for stable runs.

**Step 6 — Review Results**  
Click **View Results** when done. Failed URLs are listed separately with error reasons.

#### Example: Extracting Details from 100 Job Listings

> **Goal**: Pull job title, company name, location, and salary from 100 job detail pages  

1. Collect URLs from a job board's search results (use List Extractor first if needed).
2. Open Page Extractor, paste the 100 URLs.
3. Add elements:
   - "Job Title" → pick `<h1 class="job-title">`
   - "Company" → pick `<span class="company-name">`
   - "Location" → pick `<div class="location">`
   - "Salary" → pick `<span class="salary-range">`
4. Set concurrency to 5, timeout to 8 seconds.
5. Start job — ~2 minutes for 100 URLs at 5 concurrent.
6. Export CSV with all 100 rows.

---

### 5.3 Metadata Extractor

**What it does**: Pulls structured metadata from pages — Open Graph tags, JSON-LD, Twitter Cards, author, description, canonical URLs, links, tables, and main text content.

#### When to use it
- Auditing SEO metadata across a list of your own pages
- Researching how competitors structure their Open Graph data
- Pulling article text from a reading list
- Collecting schema.org structured data from product pages

#### Step-by-Step Guide

**Step 1 — Open Metadata Extractor**  
Click **Metadata Extractor** in the navigation.

**Step 2 — Enter URLs**  
Paste URLs one per line (same as Page Extractor).

**Step 3 — Choose What to Extract**  
Toggle the data types you want:

| Option | What it extracts |
|--------|----------------|
| **Metadata** | Title, description, author, canonical URL, Open Graph, Twitter Card, JSON-LD |
| **Text Content** | Main page text converted to Markdown |
| **Links** | All hyperlinks found on the page |
| **Images** | Image URLs and alt text |
| **Tables** | HTML tables as structured data |

**Step 4 — Configure Options**  
- **Request delay**: Milliseconds between requests (use 500–2000 for polite crawling)
- **Load timeout**: Wait time per page
- **Concurrent requests**: Parallel page loads

**Step 5 — Start Extraction**  
Click **Start**. Results stream in as pages complete.

**Step 6 — View & Export**  
Review results in the data table. Export as CSV.

#### Example: SEO Audit of 50 Blog Posts

> **Goal**: Check title length, meta description, and canonical URL for 50 blog posts

1. Compile list of 50 blog post URLs.
2. Open Metadata Extractor, paste URLs.
3. Enable: Metadata only.
4. Set delay to 500ms to be polite.
5. Start — runs in ~30–60 seconds.
6. Export CSV. Open in Google Sheets. Filter rows where title length > 60 characters.

---

### 5.4 Text Summarizer

**What it does**: Extracts the main readable content from the current page and generates an AI-powered summary.

#### When to use it
- Quickly understanding an article without reading the full text
- Researching multiple sources and comparing summaries
- Extracting clean article text from pages with heavy ads/clutter

#### Step-by-Step Guide

1. Navigate to an article or content page in Chrome.
2. Open CrawlPilot → **Text Summarizer**.
3. Click **Extract & Summarize**.
4. CrawlPilot extracts the main content (from `<article>`, `<main>`, or the body) and sends it for summarization.
5. The summary appears in the panel within a few seconds.
6. Use **Copy Text** to copy the extracted text, or **Copy Summary** for just the summary.

> **Note**: The Text Summarizer uses AI (Anthropic API). Trial usage is included. Heavy usage may require your own API key in Settings.

#### Works best on
- News articles
- Blog posts
- Research pages
- Wikipedia articles

#### Does not work well on
- Login-gated pages
- Pages with no body text (image galleries, video pages)
- `chrome://` pages

---

### 5.5 Image Downloader

**What it does**: Scans the current page for all images and lets you download them individually or in bulk as a ZIP file.

#### Step-by-Step Guide

**Step 1 — Navigate to the target page**  
Go to the page containing images you want.

**Step 2 — Open Image Downloader**  
Click **Image Downloader** in the side panel.

**Step 3 — Scan for Images**  
Click **Scan Page**. CrawlPilot detects:
- `<img>` tags (including lazy-loaded ones via `data-src`, `data-original`)
- `<picture>` / `<source>` elements
- CSS background images
- Video poster frames
- Canvas elements (converted to PNG)
- SVGs (converted to PNG)

Images load into a grid with their **dimensions** and **estimated size**.

**Step 4 — Filter Images**  
Use the size filters to show only:
- **Small** (under 100×100 px) — icons, thumbnails
- **Medium** (100–500 px)
- **Large** (over 500 px) — full-quality images

**Step 5 — Select Images**  
- Click individual images to select/deselect them
- Click **Select All** to grab everything visible

**Step 6 — Download**  
- **Download Selected** — downloads all selected images as a ZIP file
- Single image click → individual download

#### Supported Formats
JPG, PNG, GIF, SVG, WebP, AVIF

#### Example: Downloading Product Images from an E-commerce Page

> **Goal**: Download all high-res product photos from a product detail page

1. Open the product page.
2. Open Image Downloader → Scan Page.
3. Filter to **Large** images only.
4. Select all → Download Selected.
5. ZIP file downloads with all images, named by their original filename.

---

### 5.6 Browser Utilities

#### Right-Click Unlocker

Some websites disable the right-click context menu (news sites, image galleries, etc.). The Right-Click Unlocker removes this restriction on the current page.

**How to use:**
1. Navigate to the page with the blocked right-click.
2. Open CrawlPilot → **Utilities**.
3. Click **Unlock Right-Click**.
4. Right-click anywhere on the page — the context menu now appears.

> This is per-page only and resets when you navigate away.

---

### 5.7 History

The History tab shows all your past extraction jobs.

**What you can do:**
- See job status: Running / Completed / Paused / Failed
- View the source URL, timestamp, and item count for each job
- **Re-run** a previous job with the same configuration (useful for recurring data collection)
- **Delete** a job and its stored data
- **View Data** — jump to the data table for a completed job

**Running jobs** show a live progress indicator. If an extraction is still in progress, you can **Stop** it from here.

---

### 5.8 Data Table (Saved Data)

Opens in a **new tab** for a full-screen data management experience.

**Features:**
- Grid view with columns matching your extracted schema
- **Sort** any column by clicking the header
- **Filter** rows using the column filter inputs
- **Edit** individual cell values by clicking them
- **Delete** rows
- **Merge datasets** — combine rows from multiple extraction jobs into one table
- **Export as CSV** — downloads all visible rows as a spreadsheet

**Accessing it:**
- From the side panel: click the **Data** icon or **View Data** after an extraction
- From History: click any job's **View Data** button

---

### 5.9 Settings

Access Settings via the gear icon in the side panel.

#### Language
Choose the UI language:
- English, Spanish, French, German, Italian, Chinese (Simplified), Japanese, Russian, Portuguese

#### Storage Management
- **Current Usage** — shows how much IndexedDB storage your data occupies
- **Data Retention** — auto-delete data older than N days (set to 0 to disable)
- **Clear Old Data** — manually removes data beyond the retention window
- **Clear All Data** — deletes everything (requires confirmation). Irreversible.

#### Integrations (Coming Soon)
Configure outbound destinations for your extracted data:
- **Webhook URL** — POST extracted data to any endpoint (Zapier, Make, custom API)
- **Airtable** — Enter your API key, Base ID, and Table name for direct upload
- **Google Sheets** — Connect to a Google Sheet for live sync

---

## 6. Exporting Data

### CSV Export

1. Open the **Data Table** for any job.
2. Click **Export CSV**.
3. A `.csv` file downloads immediately — open in Excel, Google Sheets, or any spreadsheet app.

### ZIP Download (Images)

1. In Image Downloader, select images and click **Download Selected**.
2. A `.zip` file downloads containing all selected images.

---

## 7. Example Use Cases

### Use Case 1: Building a Lead List

**Scenario**: You want to collect the name, title, and LinkedIn URL of 500 speakers from a conference website.

1. **List Extractor** → Pick the speaker card container and one speaker card.
2. Auto-detect columns: Name, Title, LinkedIn URL.
3. Set pagination to "Next Button", max 20 pages.
4. Extract → Export CSV → Upload to your CRM.

---

### Use Case 2: Price Monitoring

**Scenario**: Track prices for 200 products across 3 competitor websites.

1. **List Extractor** on each competitor's category page → export product URLs.
2. **Page Extractor** → paste all 200 product URLs, define schema: Product Name, Price, Availability.
3. Run weekly, export CSV, compare with last week's data in a spreadsheet.

---

### Use Case 3: Content Research

**Scenario**: You're writing a report and need summaries of 30 industry articles.

1. Open each article URL, use **Text Summarizer** → copy summary.
   — Or batch: use **Metadata Extractor** with Text Content enabled on all 30 URLs.
2. Export CSV with title, author, summary text for each article.

---

### Use Case 4: Social Media Image Archive

**Scenario**: Download all images from a public portfolio/gallery page.

1. Navigate to the gallery page.
2. Open **Image Downloader** → Scan Page.
3. Scroll to trigger lazy load (CrawlPilot handles this automatically).
4. Select all large images → Download as ZIP.

---

### Use Case 5: SEO Metadata Audit

**Scenario**: You manage 100 blog posts and want to check their SEO metadata.

1. Export your sitemap URLs into a text file.
2. **Metadata Extractor** → paste all 100 URLs, enable Metadata only.
3. Export CSV → open in Google Sheets.
4. Use conditional formatting to highlight missing descriptions or titles over 60 characters.

---

## 8. Troubleshooting

### "Tab not connected" banner shows

**Cause**: The side panel was opened before the page finished loading, or the connection was interrupted.  
**Fix**: Click the **Connect Tab** button in the banner. If that fails, close and reopen the side panel.

---

### Element picker doesn't highlight anything

**Cause**: The page may be restricting script injection, or the page is still loading.  
**Fix**:
1. Wait for the page to fully load before picking.
2. Refresh the page and try again.
3. Ensure you granted host permissions: `chrome://extensions` → CrawlPilot → Details → Site access → Allow on all sites.

---

### Extraction stops after a few pages

**Cause**: The site's pagination is dynamic (URL doesn't change on click), duplicate content detection triggered, or the next button changed.  
**Fix**:
1. Try a slower extraction speed.
2. Ensure the next button selector is still correct (some sites dynamically change button classes).
3. Check if the site requires login for more pages.

---

### Duplicate rows in exported data

**Cause**: Content was extracted multiple times during scroll (rare edge case).  
**Fix**: CrawlPilot automatically deduplicates at the database level. If you still see duplicates in the CSV, use your spreadsheet's "Remove Duplicates" feature on a key column.

---

### Images download as broken files or wrong extension

**Cause**: The site serves images with CORS restrictions or non-standard Content-Type headers.  
**Fix**: CrawlPilot uses a background proxy to bypass CORS. If images still fail, try right-clicking an individual image → "Save image as" as a workaround.

---

### Page Extractor tabs not opening

**Cause**: Chrome may block pop-ups or tab creation if the extension lost permission.  
**Fix**:
1. Check Chrome's pop-up blocker settings for your site.
2. Reduce concurrent tabs to 2–3.
3. Restart Chrome and try again.

---

### Text Summarizer shows no output

**Cause**: The page has no extractable main content, or it's behind a login wall.  
**Fix**: Try a different page. The tool works best on public article pages. Pages heavily reliant on JavaScript rendering or login may not yield content.

---

### Storage usage is high

**Fix**: Go to **Settings** → set a data retention window (e.g., 30 days) → click **Clear Old Data**. For a full reset, use **Clear All Data** (irreversible).

---

## 9. FAQ

**Q: Is my data sent to any server?**  
A: No. All extracted data is stored locally in your browser's IndexedDB. Nothing leaves your device unless you configure an integration (Webhook, Airtable, etc.) in Settings. The Text Summarizer sends page text to Anthropic's API for AI processing — this is the only network call involving your extracted content.

---

**Q: Does CrawlPilot work on all websites?**  
A: It works on the vast majority of public websites. Exceptions include Chrome's internal pages (`chrome://`), the Chrome Web Store, pages inside cross-origin iframes, and sites with aggressive anti-bot measures that block script execution. Pages requiring login work if you are already logged in when you run the extraction.

---

**Q: Will CrawlPilot slow down my browser?**  
A: For single-page extractions, performance impact is minimal. For Page Extractor jobs with many concurrent tabs, you may notice Chrome using more memory. Keep concurrent tabs at 5 or below for smooth performance. Close other heavy tabs if running a large bulk job.

---

**Q: Can I pause and resume an extraction?**  
A: Yes. Click **Stop** during an active extraction to pause it. The data collected so far is saved. Go to **History** to re-run the job, which will pick up from the saved state.

---

**Q: How do I extract data from a website that requires login?**  
A: Log in to the website normally in Chrome. CrawlPilot runs in your browser session, so it has access to the same pages you can view. As long as you are logged in and the page is accessible in your browser, CrawlPilot can extract from it.

---

**Q: What is the maximum amount of data I can extract?**  
A: CrawlPilot stores data in IndexedDB, which has no hard limit (typically up to 80% of available disk space in Chrome). For very large datasets (hundreds of thousands of rows), performance in the Data Table may slow. Export to CSV for large datasets.

---

**Q: Can I run extractions on a schedule automatically?**  
A: Scheduled/automated runs are not yet built into the extension, but this feature is on the roadmap. For now, use **History → Re-run** to repeat a previous extraction manually.

---

**Q: I picked the wrong element. Can I redo the selection?**  
A: Yes. In the List Extractor wizard, click the **Edit** icon next to any selector to re-pick it. The picker overlay will reopen so you can choose a different element.

---

**Q: Can I export to formats other than CSV?**  
A: Currently CSV is the export format. JSON export and direct integrations (Airtable, Google Sheets, Webhooks) are available in Settings once configured. Additional export formats are planned.

---

**Q: How do I delete a specific dataset?**  
A: Go to **History**, find the job, and click the **Delete** icon. This removes the job record and all associated rows from your local storage.

---

**Q: The extension icon is missing from my toolbar.**  
A: Click the puzzle icon in Chrome's toolbar → find CrawlPilot → click the **pin** icon to permanently show it.

---

## 10. Release Notes

### Version 1.0 — June 2026 (Initial Release)

**New Features:**
- **List Extractor**: Visual element picker with 3-step wizard, CSS/XPath selector support, auto-scroll (mutation-aware and indexed strategies), pagination, and "Load More" support
- **Page Extractor**: Bulk multi-URL extraction with configurable concurrency (up to 10 parallel tabs), per-URL status tracking, and automatic tab management
- **Metadata Extractor**: Open Graph, JSON-LD, Twitter Card, standard meta tags, HTML-to-Markdown text extraction, link and table collection
- **Text Summarizer**: AI-powered page summarization via Anthropic API
- **Image Downloader**: Full-page image scan with lazy-load support, dimension filtering, bulk ZIP download, CORS proxy for cross-origin images
- **Browser Utilities**: Right-click unlocker for restricted pages
- **History**: Full job history with re-run and delete capabilities
- **Data Table**: Full-screen grid with sort, filter, row editing, CSV export, and dataset merge
- **Settings**: Language selector (9 languages), storage management with auto-cleanup, integrations UI (Webhook, Airtable, Google Sheets — configuration UI available; outbound sending coming in 1.1)
- **Local Storage**: All data stored in IndexedDB — private, offline-capable
- **Deduplication**: Automatic in-memory and database-level row deduplication
- **Internationalization**: UI available in English, Spanish, French, German, Italian, Chinese (Simplified), Japanese, Russian, Portuguese

**Known Limitations in 1.0:**
- Scheduled/automated recurring extractions not yet supported
- Integration outbound sending (Webhook, Airtable) is UI-only; data transmission coming in 1.1
- Email Extractor feature is marked "Coming Soon"
- Page Extractor does not support JavaScript-heavy SPAs that require user interaction beyond simple clicks
- Safari and Firefox are not supported

---

*For bugs and feature requests, please open an issue in the [CrawlPilot GitHub repository](https://github.com/crawlpilot/crawlpilot).*
