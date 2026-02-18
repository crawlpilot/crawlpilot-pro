import { IScrollStrategy, ScrollStrategyConfig, ScrollStrategyResult } from './IScrollStrategy';

/**
 * MutationAwareScrollStrategy — new default for infinite/dynamic feeds.
 *
 * Designed for sites like Instagram, Twitter, TikTok, LinkedIn where new items
 * are appended to the DOM asynchronously after the user scrolls to the bottom.
 *
 * How it works:
 * 1. Resolves the container element from the selector.
 * 2. Attaches a MutationObserver to the container (or document.body as fallback)
 *    to detect when new child nodes are added.
 * 3. Iterates through existing children by index, scrolling each into view.
 * 4. When the index reaches the end of known children, scrolls the page/container
 *    downward and waits up to `contentLoadDelay` ms for new nodes to appear
 *    (detected by the MutationObserver).
 * 5. If new nodes appear, resets the "no-change" counter and continues.
 * 6. If no new nodes appear after `maxNoChanges` cycles, stops.
 *
 * Strengths:
 *   - Works on virtualized/infinite feeds (Instagram, Twitter, LinkedIn)
 *   - Handles both container-level scroll (overflow: auto) and window-level scroll
 *   - Detects new items even if they appear with a delay after scrolling
 *   - Falls back gracefully to window scroll if container doesn't scroll
 *
 * Weaknesses:
 *   - Slightly more complex than IndexedScrollStrategy
 *   - MutationObserver adds a small overhead (negligible in practice)
 *   - If the site removes old items (true virtualization), items may be missed;
 *     use IndexedScrollStrategy with a very small scrollDelay for those cases.
 */
export class MutationAwareScrollStrategy implements IScrollStrategy {
    private abortSignal?: AbortSignal;

    constructor(abortSignal?: AbortSignal) {
        this.abortSignal = abortSignal;
    }

    private throwIfAborted() {
        if (this.abortSignal?.aborted) {
            throw new Error('Action aborted');
        }
    }

    private wait(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    public async execute(config: ScrollStrategyConfig): Promise<ScrollStrategyResult> {
        const {
            selector: parentSelector = '',
            selectorType = 'selector',
            scrollDelay = 50,
            contentLoadDelay = 2500,
            maxNoChanges = 3,
            selectionMode = 'container',
            rootElement,
            startIndex = 0,
        } = config;

        // --- 1. Resolve container ---
        let container: HTMLElement | null = null;

        if (rootElement) {
            container = rootElement;
        } else if (selectorType === 'selector') {
            if (selectionMode === 'items') {
                const els = Array.from(document.querySelectorAll(parentSelector));
                container = els.length > 0 ? (els[0].parentElement as HTMLElement) : null;
            } else {
                container = document.querySelector(parentSelector) as HTMLElement;
            }
        } else if (selectorType === 'xpath') {
            const result = document.evaluate(parentSelector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            container = result.singleNodeValue as HTMLElement;
        }

        if (!container) {
            return { success: false, error: 'Container not found' };
        }

        console.log('[MutationAwareScrollStrategy] Container resolved:', container.tagName, container.className);

        // --- 2. Determine scroll target ---
        const isContainerScrollable = this.isScrollable(container);
        const scrollTarget: HTMLElement | Window = isContainerScrollable ? container : window;
        console.log(`[MutationAwareScrollStrategy] Scroll target: ${isContainerScrollable ? 'container' : 'window'}`);

        // --- 3. Initialize Tracking Queue & Seen Set ---
        const seenSet = new Set<Element>();
        const pendingQueue: HTMLElement[] = [];
        let currentIdx = 0; // Absolute count of processed items
        let lastChildHashData: string | null = null;

        const addToQueue = (elements: HTMLElement[]) => {
            for (const el of elements) {
                if (!seenSet.has(el)) {
                    seenSet.add(el);
                    pendingQueue.push(el);
                }
            }
        };

        // --- 4. Attach MutationObserver to populate queue ---
        let newItemsDetected = false;
        const observeTarget = container.children.length > 0 ? container : document.body;
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    const addedElements = Array.from(mutation.addedNodes)
                        .filter(n => n.nodeType === Node.ELEMENT_NODE) as HTMLElement[];

                    if (addedElements.length > 0) {
                        newItemsDetected = true;
                        addToQueue(addedElements);
                        console.log(`[MutationAwareScrollStrategy] Queued ${addedElements.length} new element(s)`);
                    }
                }
            }
        });

        observer.observe(observeTarget, { childList: true, subtree: false });

        // --- 5. Initial Population ---
        const getInitialChildren = (): HTMLElement[] => {
            if (selectionMode === 'items' && selectorType === 'selector') {
                const selectorItems = Array.from(document.querySelectorAll(parentSelector)) as HTMLElement[];
                const containerItems = Array.from(container!.children) as HTMLElement[];
                return selectorItems.length > containerItems.length ? selectorItems : containerItems;
            }
            return Array.from(container!.children) as HTMLElement[];
        };
        addToQueue(getInitialChildren());

        // Respect startIndex if provided
        if (startIndex > 0 && startIndex < pendingQueue.length) {
            console.log(`[MutationAwareScrollStrategy] Skipping ${startIndex} items based on startIndex`);
            const skipped = pendingQueue.splice(0, startIndex);
            currentIdx = startIndex;
            for (const el of skipped) seenSet.add(el);
        }

        // --- 6. Main Execution Loop ---
        let consecutiveNoChanges = 0;

        try {
            while (consecutiveNoChanges < maxNoChanges) {
                this.throwIfAborted();

                // DRAIN THE QUEUE
                if (pendingQueue.length > 0) {
                    console.log(`[MutationAwareScrollStrategy] Draining queue (${pendingQueue.length} items pending)`);

                    while (pendingQueue.length > 0) {
                        this.throwIfAborted();
                        const child = pendingQueue.shift()!;

                        // Scroll item into view (block: center helps ensure it's fully loaded/visible)
                        child.scrollIntoView({ behavior: 'auto', block: 'center' });

                        // Callback
                        if (config.scrollCallback) {
                            try {
                                await config.scrollCallback({
                                    scrolledToIndex: currentIdx,
                                    element: child,
                                    totalCount: seenSet.size
                                });
                            } catch (err) {
                                console.error(`[MutationAwareScrollStrategy] Callback failed at index ${currentIdx}:`, err);
                            }
                        }

                        lastChildHashData = this.generateSimpleHash(child, currentIdx);
                        currentIdx++;

                        if (scrollDelay > 0) await this.wait(scrollDelay);
                    }

                    consecutiveNoChanges = 0; // Progress made
                }

                // TRIGGER LOAD MORE
                console.log(`[MutationAwareScrollStrategy] Queue empty. Triggering scroll to load more...`);
                newItemsDetected = false;
                this.triggerScroll(scrollTarget, container);

                const gotNewItems = await this.waitForNewItems(contentLoadDelay, () => newItemsDetected);

                if (gotNewItems) {
                    console.log(`[MutationAwareScrollStrategy] New items appeared via MutationObserver.`);
                    consecutiveNoChanges = 0;
                } else {
                    // Fallback: Check if children count increased without MutationObserver firing correctly
                    // (sometimes nodes are added to a parent of our container)
                    const currentChildrenCount = getInitialChildren().length;
                    if (currentChildrenCount > seenSet.size) {
                        console.log(`[MutationAwareScrollStrategy] More items found via DOM check (MutationObserver missed some).`);
                        addToQueue(getInitialChildren());
                        consecutiveNoChanges = 0;
                        continue;
                    }

                    // Try clicking Load More if configured
                    if (config.loadMoreSelector) {
                        const clicked = await this.clickLoadMore(config.loadMoreSelector, config.loadMoreSelectorType);
                        if (clicked) {
                            console.log('[MutationAwareScrollStrategy] Clicked Load More, waiting...');
                            consecutiveNoChanges = 0;
                            await this.wait(contentLoadDelay);
                            addToQueue(getInitialChildren());
                            continue;
                        }
                    }

                    consecutiveNoChanges++;
                    console.log(`[MutationAwareScrollStrategy] No progress (${consecutiveNoChanges}/${maxNoChanges})`);
                }
            }
        } finally {
            observer.disconnect();
            console.log('[MutationAwareScrollStrategy] Cleanup complete.');
        }

        return {
            success: true,
            result: {
                currentIndex: currentIdx,
                lastChildHashData
            }
        };
    }

    /**
     * Checks if an element has its own scroll (overflow: auto/scroll).
     */
    private isScrollable(el: HTMLElement): boolean {
        try {
            const style = window.getComputedStyle(el);
            const overflow = style.overflow + style.overflowY;
            if (!/(auto|scroll)/.test(overflow)) return false;
            // Also verify it actually has scrollable content
            return el.scrollHeight > el.clientHeight;
        } catch {
            return false;
        }
    }

    /**
     * Triggers a scroll event to trigger lazy loading. 
     * Uses incremental scrolling only to avoid jumping past items.
     */
    private triggerScroll(target: HTMLElement | Window, container: HTMLElement): void {
        try {
            if (target instanceof Window) {
                // Scroll by one viewport height
                window.scrollBy({ top: window.innerHeight, behavior: 'auto' });
            } else {
                target.scrollTop += target.clientHeight;
            }

            // Fire scroll event for synthetic listeners
            container.dispatchEvent(new Event('scroll', { bubbles: true }));
            window.dispatchEvent(new Event('scroll', { bubbles: false }));
        } catch (e) {
            console.warn('[MutationAwareScrollStrategy] triggerScroll error:', e);
        }
    }

    /**
     * Polls until `check()` returns true or `timeoutMs` elapses.
     * Uses 100ms polling intervals.
     */
    private waitForNewItems(timeoutMs: number, check: () => boolean): Promise<boolean> {
        return new Promise(resolve => {
            const interval = 100;
            let elapsed = 0;

            const poll = () => {
                if (check()) {
                    resolve(true);
                    return;
                }
                elapsed += interval;
                if (elapsed >= timeoutMs) {
                    resolve(false);
                    return;
                }
                setTimeout(poll, interval);
            };

            setTimeout(poll, interval);
        });
    }

    /**
     * Attempts to click a "Load More" button.
     */
    private async clickLoadMore(selector: string, selectorType: 'selector' | 'xpath' = 'selector'): Promise<boolean> {
        try {
            const cleanSelector = selector.trim();
            let actualType = selectorType;
            if (cleanSelector.startsWith('//') || cleanSelector.startsWith('(')) {
                actualType = 'xpath';
            }

            let element: HTMLElement | null = null;
            if (actualType === 'selector') {
                element = document.querySelector(cleanSelector) as HTMLElement;
            } else {
                const result = document.evaluate(cleanSelector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                element = result.singleNodeValue as HTMLElement;
            }

            if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                await this.wait(500);
                element.click();
                return true;
            }
        } catch (e) {
            console.warn('[MutationAwareScrollStrategy] clickLoadMore error:', e);
        }
        return false;
    }

    /**
     * Generates a lightweight string hash for resume capability.
     */
    private generateSimpleHash(element: HTMLElement, index: number): string {
        const text = element.innerText || '';
        const id = element.id || '';
        const className = element.className || '';
        const raw = `${element.tagName}#${id}.${className}[${index}]${text.substring(0, 100)}`;
        let hash = 0;
        for (let i = 0; i < raw.length; i++) {
            hash = ((hash << 5) - hash) + raw.charCodeAt(i);
            hash |= 0;
        }
        return JSON.stringify({ hash: hash.toString(), index });
    }
}
