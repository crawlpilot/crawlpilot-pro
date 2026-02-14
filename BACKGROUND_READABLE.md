# Background Script Documentation (`background-readable.js`)

## Overview
`background-readable.js` is the legacy background script for the CrawlPilot extension. It is a Webpack-bundled file containing the core logic for automation, message handling, and database interactions. Although essentially a "black box" of bundled code, this document breaks down its internal structure and exposed functionality based on analysis.

## Architecture
The file is structured as a Webpack bundle with an Immediately Invoked Function Expression (IIFE) that serves as the entry point. It manages several internal modules:

*   **Message Router (Main Entry)**: Handles Chrome runtime messages and routes them to appropriate services.
*   **Automation Service (Module 363)**: Manages the lifecycle of automation tasks (start, stop, rerunning) and state.
*   **Runner Registry (Module 588)**: Contains the logic for executing specific automation actions (clicking, scrolling, extracting).
*   **Event Bus (Module 81)**: Facilitates internal communication between modules.
*   **Database Service (Module 750)**: Wrapper around IndexedDB for storing automation results and configurations.

## Message Protocol
The background script listens for messages via `chrome.runtime.onMessage`. The following message types are supported:

| Message Type | Payload | Description |
| :--- | :--- | :--- |
| `START_AUTOMATION` | `{ actions, runnerType, config, metadata, tabId }` | Initiates a new automation task. |
| `STOP_AUTOMATION` | N/A | Stops the currently running automation. |
| `STOP_AUTOMATION_BY_ID` | `{ automationId }` | Stops a specific automation instance. |
| `RERUN_AUTOMATION` | `{ automationId }` | Restarts a previously run automation. |
| `GET_AUTOMATION_RUNNERS` | N/A | Returns a list of available automation runner types. |
| `PING_BACKGROUND` | N/A | Returns `{ status: 'active' }` to check health. |
| `WAKE_UP_BACKGROUND` | N/A | Ensures the service worker is active. |
| `OPEN_SIDE_PANEL` | `{ tab: { windowId } }` | Opens the extension side panel. |
| `LICENSE_REGISTERED` | `{ source }` | Broadcasts license updates to other parts of the app. |

## Key Functionality & Functions

### 1. Automation Service (Module 363)
Manages the execution context.
*   **`startAutomation(config)`**: Creates a database entry for the automation and initializes the runner.
*   **`createTableData(automationId, schema)`**: Creates a table in IndexedDB to store extracted data associated with the automation.
*   **`updateAutomationStatus(id, status)`**: Updates the state (e.g., 'running', 'completed', 'failed').

### 2. Element Interaction (Module 588)
This module contains robust logic for finding and interacting with DOM elements.

#### `clickElementRobust(tabId, selector, method, options)`
A sophisticated function to perform clicks with reliability features:
*   **Retries**: Attempts the action `maxRetries` times (default 3) if it fails.
*   **Stability Check**: Waits for the element to stop moving/animating (`waitForStability: true`).
*   **Visibility Check**: Ensures element is in the viewport, visible, and enabled.
*   **Human-like Interaction**:
    *   Simulates mouse movement to the element with random jitter.
    *   Triggers partial events: `mouseenter`, `mouseover`, `mousemove`, `mousedown`, `mouseup`, `click`.
    *   Adds random delays between events to mimic human behavior.
*   **Highlighting**: Visually highlights the element (yellow outline) before clicking for user feedback.

#### `findElementInHierarchy(tabId, elementData)`
Locates elements using a fallback strategy:
1.  **Selector**: Standard CSS selector.
2.  **ID**: Direct ID lookup.
3.  **XPath**: XPath evaluation.
4.  **Hierarchy Scoring**: A robust heuristic search if exact match fails. It scores potential candidates based on:
    *   Tag name match (+10)
    *   Class intersection (+5)
    *   Text content similarity (+4)
    *   Position/Dimensions match (+3)
    *   Parent hierarchy match (recursive)

### 3. Container & Pattern Detection
The script includes logic (likely within the helper functions of Module 588) for identifying list containers:
*   **`findSimilarSiblings`**: Looks for elements with similar DOM structure (tag, class distribution) to identify rows or repeated items.
*   **Recursive Expansion**: (As identified during debugging) Capable of understanding nested structures (e.g., Grid > Row > Item) to select the largest valid dataset.

## Usage Example (Content Script)
To trigger an automation from a content script or popup:

```javascript
chrome.runtime.sendMessage({
    type: "START_AUTOMATION",
    runnerType: "pageExtractor", // or 'workflow'
    config: {
        maxPages: 5,
        targetUrl: "https://example.com"
    },
    actions: [
        { type: "click", selector: ".next-button" },
        { type: "extract", selector: ".product-item" }
    ]
});
```

To stop:
```javascript
chrome.runtime.sendMessage({ type: "STOP_AUTOMATION" });
```

## Database Schema (Inferred)
*   **Automations Store**: Stores config, status, and timestamps.
*   **TableData Store**: Stores the actual extracted rows/items.
*   **Context Store**: Likely manages saved selectors or user preferences.
