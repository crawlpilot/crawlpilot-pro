/**
 * Shared config and result types for scroll strategies.
 */
export interface ScrollStrategyConfig {
    /** CSS selector or XPath for the list container */
    selector?: string;
    selectorType?: 'selector' | 'xpath';
    /** 'container' = selector points to parent; 'items' = selector matches each item */
    selectionMode?: 'container' | 'items';
    /** Delay (ms) between scrolling to each item */
    scrollDelay?: number;
    /** Delay (ms) to wait after scrolling before checking for new content */
    contentLoadDelay?: number;
    /** How many consecutive no-change cycles before giving up */
    maxNoChanges?: number;
    /** Optional CSS selector for a "Load More" button */
    loadMoreSelector?: string;
    loadMoreSelectorType?: 'selector' | 'xpath';
    /** Called after each item is scrolled into view */
    scrollCallback?: (data: ScrollCallbackData) => Promise<void>;
    /** Directly pass a root element instead of a selector */
    rootElement?: HTMLElement;
    /** Resume from a specific child index */
    startIndex?: number;
    /** Resume from a serialized ChildHashData string */
    childHash?: string | null;
}

export interface ScrollCallbackData {
    scrolledToIndex: number;
    element: HTMLElement;
    totalCount: number;
}

export interface ScrollStrategyResult {
    success: boolean;
    error?: string;
    result?: {
        currentIndex: number;
        lastChildHashData: string | null;
    };
}

/**
 * Interface for pluggable scroll strategies.
 * Implementations differ in how they detect and handle new elements during scrolling.
 */
export interface IScrollStrategy {
    /**
     * Execute the scroll strategy.
     * Must call config.scrollCallback for each item scrolled into view.
     * Must respect abort signals (call throwIfAborted if available).
     */
    execute(config: ScrollStrategyConfig): Promise<ScrollStrategyResult>;
}
