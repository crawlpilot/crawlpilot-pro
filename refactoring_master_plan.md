# Codebase Refactoring Master Plan v2

## 1. Executive Summary
This plan transitions the codebase to a **Domain-Driven Modular Architecture** optimized for extensibility. By adopting standard design patterns (Strategy, Factory, Observer), we ensure that adding new capabilities (like Product Page extraction or Deep Scraping) requires **extending** the system, not modifying existing code (Open/Closed Principle).

---

## 2. Core Design Patterns
We will explicitly implement these patterns to solve structural problems:

| Pattern | Usage | Benefit |
| :--- | :--- | :--- |
| **Strategy** | `ExtractionStrategy` (List vs. Single vs. Grid) | switch extraction logic without changing the core engine. |
| **Factory** | `FlowFactory` | Dynamically creates `PaginationFlow`, `InfiniteScrollFlow`, or `ProductPageFlow` based on user config. |
| **Observer** | `MessageBus` | Decouples components. Features subscribe to events (`NAVIGATE`, `EXTRACT`) rather than being called directly. |
| **State** | `ExtractionContext` | Manages the workflow state (Idle -> Extracting -> Navigating -> Paused) centrally. |

---

## 3. Directory Structure (Revised)

```text
src/
├── content/
│   ├── core/                    # The "Brain"
│   │   ├── bus/                 # MessageBus (Observer)
│   │   ├── flows/               # Extraction Flows (Factory + Strategy)
│   │   │   ├── BaseFlow.ts
│   │   │   ├── PaginationFlow.ts
│   │   │   └── InfiniteScrollFlow.ts
│   │   └── state/               # Global State (Context)
│   │
│   ├── services/                # Reusable Tools (Singleton)
│   │   ├── dom/                 # DOMService (consolidated domBase + utils)
│   │   │   ├── query.ts
│   │   │   ├── highlight.ts
│   │   │   └── observer.ts      # MutationObserver wrappers
│   │   └── extraction/          # The Helper Engines
│   │       ├── SchemaGenerator.ts
│   │       ├── DataAggregator.ts
│   │       └── strategies/      # Extraction Strategies
│   │
│   ├── features/                # UI/Interaction Modules
│   │   ├── picker/              # Visual Picker
│   │   └── overlay/             # UI Overlays (Status bars, Counters)
│   │
│   └── index.ts                 # Bootstrapper
```

---

## 4. Refactoring Roadmap

### Phase 1: De-duplication & Shared Kernel (Foundation)
*Goal: Remove "Duplicate Code" and create a stable `services/dom` layer.*

1.  **Consolidate DOM Utils**:
    *   Identify all `querySelector`, `xpath`, `highlight` logic scattered across `classes/` and `utils/`.
    *   Move them into `services/dom/DOMService.ts`.
    *   *Win*: "Fix once, fix everywhere" (like the ID selector crash).
2.  **Standardize DOM Observation**:
    *   Replace ad-hoc `MutationObserver` usage in `AutoScroll` and `PaginationManager` with a shared `DOMObserver` service.

### Phase 2: Core Engine & Design Patterns
*Goal: Implement the Flow Engine so new features are just "plug-ins".*

1.  **Implement `Flow` Interface**:
    ```typescript
    interface ExtractionFlow {
        start(config: Config): Promise<void>;
        pause(): void;
        resume(): void;
        stop(): void;
    }
    ```
2.  **Refactor Pagination**:
    *   Convert `PaginationManager` into `PaginationFlow` implementing the interface.
    *   Use **State Pattern** internally to manage `WAITING_FOR_URL`, `EXTRACTING`.
3.  **Refactor Auto-Scroll**:
    *   Convert `AutoScroll` into `InfiniteScrollFlow`.

### Phase 3: Extraction Strategies
*Goal: Support "Product Page" and "Deep Scraping".*

1.  **Abstract Data Extraction**:
    *   Current: `DataExtractor` is hardcoded for lists/tables.
    *   New: `ExtractionStrategy` interface.
        *   `ListExtractionStrategy`: (Current behavior)
        *   `DeepCrawlStrategy`: (Future) Extracts links, visits them, extracts details.
        *   `ProductDetailStrategy`: (Future) distinct fields (Title, Price, SKU) from a single page.

### Phase 4: Feature Migration (The "Controller" Cleanup)
1.  **Decouple `element-selector.ts`**:
    *   Turn it into a dumb bootstrapper that basically just says:
        *   `MessageBus.on('START_PICKER', () => picker.enable())`
        *   `MessageBus.on('EXECUTE_FLOW', (cfg) => FlowFactory.create(cfg).start())`

---

## 5. Future Extensibility Scenarios

### Scenario A: Supporting Product Detail Pages
*Requirement*: User wants to scrape a single Amazon product page (Title, Price, Description, Reviews).
*   **Action**:
    1.  Create `ProductDetailStrategy` in `services/extraction/strategies/`.
    2.  Create `SinglePageFlow` in `core/flows/`.
    3.  **No changes** needed to `element-selector.ts` or messaging logic.

### Scenario B: Deep Scraping (Crawl Links)
*Requirement*: Scrape a list of links, then visit each link to get more data.
*   **Action**:
    1.  Create `DeepCrawlFlow` in `core/flows/`.
    2.  This flow composes two strategies: `ListExtractionStrategy` (collect URLs) -> `ProductDetailStrategy` (visit URLs).
    3.  Reuse `PaginationFlow` logic for the list part.

## 6. Immediate Next Steps
1.  Create the directory structure.
2.  Perform **Phase 1 (DOM Consolidation)** immediately to clean up `domBase.ts` usage.
