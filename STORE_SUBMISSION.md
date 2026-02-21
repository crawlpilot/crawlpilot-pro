# Chrome Web Store Submission Guide

## 1. Permissions Justification

| Permission | Justification |
| :--- | :--- |
| `sidePanel` | **Core Feature**: The extension's primary interface is a Side Panel that allows users to interact with the scraper while viewing the target webpage. |
| `activeTab` | **Context Awareness**: Required to identify the current tab URL and title when saving extraction results, and to facilitate interaction between the side panel and the current page. |
| `scripting` | **Dynamic Injection**: Required to strategically inject the scraping interface (`element-selector.ts`) only when the user explicitly triggers it via the side panel, preventing unnecessary background execution and respecting user privacy. |
| `storage` | **State Persistence**: Required to save and retrieve the scraper's state (e.g., pagination progress) locally, allowing the extension to auto-resume scraping tasks if the page reloads. |
| `content_scripts` | **Functionality**: The extension injects a content script (`element-selector.ts`) to allow users to visually select elements on the page for scraping. This is the core functionality of "Crawl Pilot". |

**Note on Host Permissions**:
The extension uses `content_scripts` with `matches: ["<all_urls>"]` because it is a general-purpose web scraper designed to work on *any* website the user chooses. It does not run in the background on all tabs; the script is only active when the user engages with the extension. We have removed explicit `host_permissions` to minimize scope, relying on the content script injection.

## 2. Privacy & Data Handling

*   **Data Storage**: All extracted data, recipes, and job history are stored **locally** within the user's browser (IndexedDB/Storage).
*   **Remote Servers**: The extension **does NOT** communicate with any remote servers (unless user explicitly configures a webhook, if applicable).
*   **Analytics**: The extension **does NOT** contain any tracking or analytics scripts.
*   **User Data**: No user personal data is collected or shared.

## 3. Remote Code Policy

*   **Compliance**: The extension complies with the "No Remote Code Execution" policy.
*   **Implementation**: All logic is bundled within the extension package. No external scripts are loaded via `script` tags or `eval()`.
*   **CSP**: The extension uses the default Manifest V3 Content Security Policy.

## 4. Store Listing Information

*   **Privacy Policy URL**: `https://crawlpilot.github.io/crawlpilot/privacy` (Ensure this live URL is provided in the "Privacy" tab of the Store Dashboard).
*   **Description**: "Visual web scraper to extract data from any website into Excel/JSON. AI-powered, point-and-click interface. No coding required."
    *   *Detailed Description (For Store Listing - Copy & Paste)*:

        **Turn any website into a spreadsheet. Extract data instantly with a visual point-and-click interface. No coding required.**

        ⚡️ **Crawl Pilot - The Visual Web Scraper for Everyone**

        Tired of copy-pasting? Crawl Pilot automates data collection from the web. Whether it's a list of leads, product prices, or real estate listings, Crawl Pilot extracts it for you in seconds.

        **🚀 KEY FEATURES**
        ---------------------

        👇 **Visual "Point & Click" Scraper**
        Don't know code? No problem. Simply click on the data you want (like a product title or price), and Crawl Pilot automatically identifies similar items on the page.

        🔄 **Smart Pagination & Infinite Scroll**
        Most scrapers break on multi-page lists. Crawl Pilot handles it automatically:
        *   **Next Button Mode**: Clicks through pages for you.
        *   **Infinite Scroll Mode**: Automatically scrolls down to load more items.

        �️ **Privacy-First & Local**
        Unlike cloud scrapers, Crawl Pilot runs 100% in your browser. Your data never leaves your machine until you export it. No accounts, no tracking, no hidden servers.

        � **Export to Excel, CSV, or JSON**
        Download your extracted data instantly. Compatible with Google Sheets, Microsoft Excel, and any data analysis tool.

        🧠 **Intelligent List Detection**
        Our algorithm detects repeating patterns (lists, tables, grids) instantly, saving you hours of manual work.


        **💡 USE CASES**
        ------------------

        📈 **For Sales & Growth**
        *   Build targeted lead lists from directories.
        *   Extract email addresses and phone numbers for outreach.
        *   Scrape business profiles for B2B prospecting.

        🛒 **For E-Commerce**
        *   Monitor competitor prices and stock levels.
        *   Extract product reviews and ratings for analysis.
        *   Download product images in bulk.

        � **For Research & Data Science**
        *   Gather training datasets for AI models.
        *   Collect public data for academic research.
        *   Aggregate news articles and blog posts.

        🎯 **For Recruiters**
        *   Standardize candidate profiles from job boards.
        *   Create lists of potential hires with skills and roles.


        **🛠️ POWERFUL TOOLS INCLUDED**
        --------------------------------

        *   **Right-Click Unlocker**: Enable right-click and copy on sites that block it.
        *   **Auto-Resume**: Scrapes are saved locally; if you close the tab, you can resume right where you left off.
        *   **Visual Element Picker**: High-precision selection tool.


        **🔒 PRIVACY & SECURITY**
        -------------------------

        Crawl Pilot is built with privacy at its core.
        *   **Zero Remote Code**: All logic is bundled in the extension.
        *   **Local Storage**: Data is stored in your browser's IndexedDB.
        *   **No Data Selling**: We do not collect or sell your scraped data.

        � **Start scraping for free today with Crawl Pilot!**

## 5. Deployment Steps

1.  Run `npm run build` to generate the `dist` folder.
2.  Zip the `contents` of the `dist` folder (not the folder itself, select all files inside `dist` -> Compress).
3.  Upload the `.zip` file to the Chrome Web Store Developer Dashboard.
4.  Fill in the "Privacy" tab with the justifications above.

## 6. Single Purpose Description

## 7. Support & Contact

*   **Support URL**: `https://crawlpilot.github.io/crawlpilot/support`
*   **Contact Email**: `crawlpilot6365@gmail.com`
*   **Issue Tracker**: `https://github.com/RahulBisht/crawlPilot/issues`
