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
        // Instagram/Twitter scroll the window, not the container.
        // Detect if the container itself is scrollable.
        const isContainerScrollable = this.isScrollable(container);
        const scrollTarget: HTMLElement | Window = isContainerScrollable ? container : window;
        console.log(`[MutationAwareScrollStrategy] Scroll target: ${isContainerScrollable ? 'container' : 'window'}`);

        // --- 3. Attach MutationObserver to detect new items ---
        let newItemsDetected = false;
        let newItemCount = 0;

        // Observe the container OR document.body (for feeds that append to body/root)
        const observeTarget = container.children.length > 0 ? container : document.body;
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    // Only count element nodes (not text/comment nodes)
                    const addedElements = Array.from(mutation.addedNodes).filter(n => n.nodeType === Node.ELEMENT_NODE);
                    if (addedElements.length > 0) {
                        newItemsDetected = true;
                        newItemCount += addedElements.length;
                        console.log(`[MutationAwareScrollStrategy] MutationObserver: ${addedElements.length} new element(s) added`);
                    }
                }
            }
        });

        observer.observe(observeTarget, { childList: true, subtree: false });
        console.log('[MutationAwareScrollStrategy] MutationObserver attached to:', observeTarget.tagName);

        // --- 4. Helper to get current children ---
        const getChildren = (): HTMLElement[] => {
            if (selectionMode === 'items' && selectorType === 'selector') {
                const selectorItems = Array.from(document.querySelectorAll(parentSelector)) as HTMLElement[];
                const containerItems = Array.from(container!.children) as HTMLElement[];
                return selectorItems.length > containerItems.length ? selectorItems : containerItems;
            }
            return Array.from(container!.children) as HTMLElement[];
        };

        // --- 5. Main scroll loop ---
        let currentIdx = startIndex;
        let consecutiveNoChanges = 0;
        let lastChildHashData: string | null = null;

        try {
            while (consecutiveNoChanges < maxNoChanges) {
                this.throwIfAborted();

                const children = getChildren();

                if (currentIdx < children.length) {
                    // We have an item to scroll to
                    const child = children[currentIdx];

                    // Scroll item into view
                    child.scrollIntoView({ behavior: 'auto', block: 'center' });

                    // Also scroll the window down a bit to trigger lazy loading
                    // (some sites only load new content when the viewport bottom is near the page bottom)
                    if (!isContainerScrollable) {
                        window.scrollBy({ top: child.getBoundingClientRect().height, behavior: 'auto' });
                    }

                    // Generate a simple hash for resume capability
                    lastChildHashData = this.generateSimpleHash(child, currentIdx);

                    // Fire callback
                    if (config.scrollCallback) {
                        try {
                            await config.scrollCallback({
                                scrolledToIndex: currentIdx,
                                element: child,
                                totalCount: children.length
                            });
                        } catch (err) {
                            console.error(`[MutationAwareScrollStrategy] Callback error at index ${currentIdx}:`, err);
                        }
                    }

                    if (scrollDelay > 0) await this.wait(scrollDelay);
                    currentIdx++;
                    consecutiveNoChanges = 0; // Reset since we made progress

                } else {
                    // We've reached the end of known children — try to trigger more content
                    console.log(`[MutationAwareScrollStrategy] Reached end at index ${currentIdx}. Triggering scroll to load more...`);

                    // Reset detection flag before triggering scroll
                    newItemsDetected = false;
                    newItemCount = 0;

                    // Scroll down to trigger lazy loading
                    this.triggerScroll(scrollTarget, container);

                    // Wait for new items to appear (up to contentLoadDelay ms)
                    const gotNewItems = await this.waitForNewItems(contentLoadDelay, () => newItemsDetected);

                    if (gotNewItems) {
                        console.log(`[MutationAwareScrollStrategy] New items detected (${newItemCount}), continuing...`);
                        consecutiveNoChanges = 0;
                        // Don't increment currentIdx — let the loop re-check children.length
                    } else {
                        // No new items appeared — check if a "Load More" button exists
                        if (config.loadMoreSelector) {
                            const clicked = await this.clickLoadMore(config.loadMoreSelector, config.loadMoreSelectorType);
                            if (clicked) {
                                console.log('[MutationAwareScrollStrategy] Clicked Load More, waiting for content...');
                                consecutiveNoChanges = 0;
                                await this.wait(contentLoadDelay);
                                continue;
                            }
                        }

                        consecutiveNoChanges++;
                        console.log(`[MutationAwareScrollStrategy] No new items (${consecutiveNoChanges}/${maxNoChanges})`);
                    }
                }
            }
        } finally {
            observer.disconnect();
            console.log('[MutationAwareScrollStrategy] MutationObserver disconnected.');
        }

        return {
            success: true,
            result: {
                currentIndex: currentIdx,
                lastChildHashData
            }
        };
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

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
     * Triggers a scroll event on the target to prompt lazy loading.
     * Uses multiple strategies to maximize compatibility:
     * - scrollBy on the element/window
     * - Dispatches a 'scroll' event (some sites listen for this)
     */
    private triggerScroll(target: HTMLElement | Window, container: HTMLElement): void {
        try {
            if (target instanceof Window) {
                // Scroll to near the bottom of the page
                const scrollAmount = Math.max(window.innerHeight * 0.8, 500);
                window.scrollBy({ top: scrollAmount, behavior: 'auto' });
                // Also try scrolling to the very bottom
                window.scrollTo({ top: document.body.scrollHeight, behavior: 'auto' });
            } else {
                const scrollAmount = Math.max(target.clientHeight * 0.8, 300);
                target.scrollTop += scrollAmount;
                target.scrollTo({ top: target.scrollHeight, behavior: 'auto' });
            }

            // Dispatch a scroll event — some React/Vue apps use synthetic scroll listeners
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
