# Chrome Web Store Submission Guide

## 1. Permissions Justification

| Permission | Justification |
| :--- | :--- |
| `sidePanel` | **Core Feature**: The extension's primary interface is a Side Panel that allows users to interact with the scraper while viewing the target webpage. |
| `activeTab` | **Context Awareness**: Required to identify the current tab URL and title when saving extraction results, and to facilitate interaction between the side panel and the current page. |
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
    *   *Extended Description (for Store Listing)*:
        Crawl Pilot is the ultimate browser-based web scraper.
        - **Visual Selector**: Point and click to select elements.
        - **Intelligent Extraction**: Automatically detects lists and repetitive patterns.
        - **Pagination Handling**: Scrape multiple pages automatically.
        - **Export**: Save data instantly as CSV (Excel compatible) or JSON.
        - **Privacy First**: All data runs locally in your browser.

## 5. Deployment Steps

1.  Run `npm run build` to generate the `dist` folder.
2.  Zip the `contents` of the `dist` folder (not the folder itself, select all files inside `dist` -> Compress).
3.  Upload the `.zip` file to the Chrome Web Store Developer Dashboard.
4.  Fill in the "Privacy" tab with the justifications above.
