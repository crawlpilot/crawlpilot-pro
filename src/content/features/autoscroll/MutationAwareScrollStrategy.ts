import { IScrollStrategy, ScrollStrategyConfig, ScrollStrategyResult } from './IScrollStrategy';
import { hashString } from '../../../shared/utils/hash';

/**
 * MutationAwareScrollStrategy — default for infinite/dynamic feeds.
 *
 * Designed for sites like Instagram, Twitter, TikTok, LinkedIn where new items
 * are appended to the DOM asynchronously after the user scrolls to the bottom.
 *
 * Features:
 *   - MutationObserver with subtree support to detect new nodes
 *   - Adaptive backoff for slow-loading sites
 *   - Scroll position verification to detect stuck-at-bottom
 *   - Content fingerprinting for dedup (handles virtualized DOM recycling)
 *   - Abort-signal-aware polling for responsive Stop button
 *   - Load More button retry logic
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
        } else if (selectorType === 'xpath') {
            const result = document.evaluate(parentSelector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            container = result.singleNodeValue as HTMLElement;
        } else {
            container = document.querySelector(parentSelector) as HTMLElement;
        }

        if (!container) {
            return { success: false, error: 'Container not found' };
        }

        console.log('[MutationAwareScrollStrategy] Container resolved:', container.tagName, container.className);

        // --- 2. Determine scroll target ---
        const isContainerScrollable = this.isScrollable(container);
        const scrollTarget: HTMLElement | Window = isContainerScrollable ? container : window;
        console.log(`[MutationAwareScrollStrategy] Scroll target: ${isContainerScrollable ? 'container' : 'window'}`);

        // --- 3. Initialize Tracking Queue & Content Fingerprint Set ---
        const seenFingerprints = new Set<string>();
        const pendingQueue: HTMLElement[] = [];
        let currentIdx = 0;
        let lastChildHashData: string | null = null;

        const fingerprint = (el: HTMLElement): string => {
            const text = (el.textContent || '').substring(0, 200);
            const img = el.querySelector('img')?.getAttribute('src') || '';
            const href = el.querySelector('a')?.getAttribute('href') || '';
            return `${text}|${img}|${href}`;
        };

        const addToQueue = (elements: HTMLElement[]) => {
            for (const el of elements) {
                const fp = fingerprint(el);
                if (!seenFingerprints.has(fp)) {
                    seenFingerprints.add(fp);
                    pendingQueue.push(el);
                }
            }
        };

        // --- 4. Attach MutationObserver (subtree: true, filtered to relevant depth) ---
        let newItemsDetected = false;
        const observeTarget = container.children.length > 0 ? container : document.body;
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    const addedElements = Array.from(mutation.addedNodes)
                        .filter(n => n.nodeType === Node.ELEMENT_NODE)
                        .filter(n => {
                            // Accept direct children of container or one level deep
                            const el = n as HTMLElement;
                            return el.parentElement === container || el.parentElement?.parentElement === container;
                        }) as HTMLElement[];

                    if (addedElements.length > 0) {
                        newItemsDetected = true;
                        addToQueue(addedElements);
                        console.log(`[MutationAwareScrollStrategy] Queued ${addedElements.length} new element(s)`);
                    }
                }
            }
        });

        observer.observe(observeTarget, { childList: true, subtree: true });

        // --- 5. Initial Population ---
        const getInitialChildren = (): HTMLElement[] => {
            if (selectionMode === 'items' && selectorType === 'selector' && parentSelector) {
                const scoped = Array.from(container!.querySelectorAll(parentSelector)) as HTMLElement[];
                if (scoped.length > 0) return scoped;
            }
            return Array.from(container!.children) as HTMLElement[];
        };
        addToQueue(getInitialChildren());

        // Respect startIndex if provided
        if (startIndex > 0 && startIndex < pendingQueue.length) {
            console.log(`[MutationAwareScrollStrategy] Skipping ${startIndex} items based on startIndex`);
            const skipped = pendingQueue.splice(0, startIndex);
            currentIdx = startIndex;
            for (const el of skipped) seenFingerprints.add(fingerprint(el));
        }

        // --- 6. Main Execution Loop with Adaptive Backoff ---
        let consecutiveNoChanges = 0;
        let currentWaitTime = contentLoadDelay;
        const maxWaitTime = contentLoadDelay * 2;

        try {
            while (consecutiveNoChanges < maxNoChanges) {
                this.throwIfAborted();

                // DRAIN THE QUEUE
                if (pendingQueue.length > 0) {
                    console.log(`[MutationAwareScrollStrategy] Draining queue (${pendingQueue.length} items pending)`);

                    let queueIdx = 0;
                    while (queueIdx < pendingQueue.length) {
                        this.throwIfAborted();
                        const child = pendingQueue[queueIdx];
                        queueIdx++;

                        child.scrollIntoView({ behavior: 'auto', block: 'center' });

                        if (config.scrollCallback) {
                            try {
                                await config.scrollCallback({
                                    scrolledToIndex: currentIdx,
                                    element: child,
                                    totalCount: seenFingerprints.size
                                });
                            } catch (err) {
                                console.error(`[MutationAwareScrollStrategy] Callback failed at index ${currentIdx}:`, err);
                            }
                        }

                        lastChildHashData = this.generateSimpleHash(child, currentIdx);
                        currentIdx++;

                        if (scrollDelay > 0) await this.wait(scrollDelay);
                    }
                    // Clear processed items in one operation (O(1) vs O(n) per shift)
                    pendingQueue.splice(0, queueIdx);

                    consecutiveNoChanges = 0;
                    currentWaitTime = contentLoadDelay; // Reset backoff on progress
                }

                // TRIGGER LOAD MORE
                console.log(`[MutationAwareScrollStrategy] Queue empty. Triggering scroll to load more...`);
                newItemsDetected = false;

                const scrollMoved = this.triggerScroll(scrollTarget, container);
                if (!scrollMoved) {
                    // Try scrolling to absolute bottom as fallback
                    this.scrollToBottom(scrollTarget);
                }

                const gotNewItems = await this.waitForNewItems(currentWaitTime, () => newItemsDetected);

                if (gotNewItems) {
                    console.log(`[MutationAwareScrollStrategy] New items appeared via MutationObserver.`);
                    consecutiveNoChanges = 0;
                    currentWaitTime = contentLoadDelay; // Reset backoff
                } else {
                    // Fallback: Check if children count increased without MutationObserver firing
                    const currentChildren = getInitialChildren();
                    const newChildren = currentChildren.filter(el => !seenFingerprints.has(fingerprint(el)));
                    if (newChildren.length > 0) {
                        console.log(`[MutationAwareScrollStrategy] ${newChildren.length} items found via DOM check (MutationObserver missed).`);
                        addToQueue(currentChildren);
                        consecutiveNoChanges = 0;
                        currentWaitTime = contentLoadDelay;
                        continue;
                    }

                    // Try clicking Load More if configured (with retry)
                    if (config.loadMoreSelector) {
                        const clicked = await this.clickLoadMoreWithRetry(config.loadMoreSelector, config.loadMoreSelectorType);
                        if (clicked) {
                            console.log('[MutationAwareScrollStrategy] Clicked Load More, waiting...');
                            consecutiveNoChanges = 0;
                            await this.wait(currentWaitTime);
                            addToQueue(getInitialChildren());
                            continue;
                        }
                    }

                    consecutiveNoChanges++;
                    // Adaptive backoff: increase wait time by 50% each failed cycle (capped at 2x)
                    currentWaitTime = Math.min(Math.round(currentWaitTime * 1.5), maxWaitTime);
                    console.log(`[MutationAwareScrollStrategy] No progress (${consecutiveNoChanges}/${maxNoChanges}). Next wait: ${currentWaitTime}ms`);
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

    private isScrollable(el: HTMLElement): boolean {
        try {
            const style = window.getComputedStyle(el);
            const overflow = style.overflow + style.overflowY;
            if (!/(auto|scroll)/.test(overflow)) return false;
            return el.scrollHeight > el.clientHeight;
        } catch {
            return false;
        }
    }

    /**
     * Triggers a scroll and returns whether scroll position actually changed.
     */
    private triggerScroll(target: HTMLElement | Window, container: HTMLElement): boolean {
        try {
            let before: number;
            if (target instanceof Window) {
                before = window.scrollY;
                window.scrollBy({ top: window.innerHeight, behavior: 'auto' });
            } else {
                before = target.scrollTop;
                target.scrollTop += target.clientHeight;
            }

            // Fire scroll event for synthetic listeners
            container.dispatchEvent(new Event('scroll', { bubbles: true }));
            window.dispatchEvent(new Event('scroll', { bubbles: false }));

            const after = target instanceof Window ? window.scrollY : target.scrollTop;
            return after !== before;
        } catch (e) {
            console.warn('[MutationAwareScrollStrategy] triggerScroll error:', e);
            return false;
        }
    }

    /**
     * Scrolls to absolute bottom as a fallback when incremental scroll fails.
     */
    private scrollToBottom(target: HTMLElement | Window): void {
        try {
            if (target instanceof Window) {
                window.scrollTo(0, document.body.scrollHeight);
            } else {
                target.scrollTop = target.scrollHeight;
            }
        } catch { /* ignore */ }
    }

    /**
     * Abort-aware polling: resolves early if items arrive OR abort signal fires.
     */
    private waitForNewItems(timeoutMs: number, check: () => boolean): Promise<boolean> {
        return new Promise(resolve => {
            const interval = 100;
            let elapsed = 0;

            const poll = () => {
                if (this.abortSignal?.aborted) {
                    resolve(false);
                    return;
                }
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
     * Attempts to click a "Load More" button with retry.
     */
    private async clickLoadMoreWithRetry(selector: string, selectorType: 'selector' | 'xpath' = 'selector'): Promise<boolean> {
        for (let attempt = 0; attempt < 2; attempt++) {
            const clicked = await this.clickLoadMore(selector, selectorType);
            if (clicked) return true;
            if (attempt < 1) await this.wait(1000);
        }
        return false;
    }

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

    private generateSimpleHash(element: HTMLElement, index: number): string {
        const text = element.innerText || '';
        const id = element.id || '';
        const className = element.className || '';
        const raw = `${element.tagName}#${id}.${className}[${index}]${text.substring(0, 100)}`;
        return JSON.stringify({ hash: hashString(raw).toString(), index });
    }
}
