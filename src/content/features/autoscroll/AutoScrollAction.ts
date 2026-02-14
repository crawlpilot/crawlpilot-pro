
import { BaseAction, ActionContext } from '../../core/BaseAction';

export interface AutoScrollConfig {
    selector?: string;
    selectorType?: 'selector' | 'xpath';
    selectionMode?: 'container' | 'items';
    enableInfiniteScroll?: boolean;
    maxNoChanges?: number;
    scrollDelay?: number;
    contentLoadDelay?: number;
    loadMoreSelector?: string;
    loadMoreSelectorType?: 'selector' | 'xpath';
    scrollCallback?: (data: any) => Promise<void>;

    // Merged fields from ScrollOptions
    parentSelector?: string;
    startIndex?: number;
    childHash?: string | null;
    highlightColor?: string;
    rootElement?: HTMLElement;
}

interface ContentHashResult {
    count: number;
    hash: string;
    scrollTop: number;
    scrollHeight: number;
    sampleSize: number;
    containerHeight: number;
}

interface ChildHashData {
    hash: string;
    contextData: {
        index: number;
        tagName: string;
        id: string;
        className: string;
        attributes: string;
        dimensions: { width: number; height: number };
        childCount: number;
        textLength: number;
        firstFewChars: string;
    }
}

/**
 * AutoScrollAction handles scrolling logic for loading more content.
 * Roles: Content tracking and scraping helper.
 */
export class AutoScrollAction extends BaseAction {

    constructor(private config: AutoScrollConfig = { selector: '' }) {
        super();
    }

    public async execute(context: ActionContext): Promise<void> {
        this.context = context;
        const config = this.config;

        if (this.context.onProgress) {
            this.context.onProgress({ type: 'initialize', message: 'Starting autoscroll...' });
        }

        try {
            if (config.enableInfiniteScroll || config.loadMoreSelector) {
                await this.executeInfiniteScroll(config.selector || '', config.selectorType || 'selector', config);
            } else {
                await this.scrollByRows(config);
            }
        } catch (error: any) {
            if (error.message === 'Action aborted') {
                // Handled by caller or swallow if expected
                return;
            }
            throw error;
        }
    }

    private async executeInfiniteScroll(selector: string, selectorType: string = 'selector', options: any = {}) {
        const config = {
            maxNoChanges: 2,
            contentLoadDelay: 2000,
            scrollDelay: 10, // [SPEED] Drastically reduced for faster scraping
            minScrollChange: 100,
            minHeightChange: 100,
            sampleSize: 10,
            selectionMode: 'container',
            loadMoreSelector: options.loadMoreSelector,
            loadMoreSelectorType: options.loadMoreSelectorType,
            ...options
        };

        const state = {
            consecutiveNoChanges: 0,
            previousContentHash: "",
            lastScrollPosition: 0,
            lastChildHashData: null as ChildHashData | null,
            totalItemsFound: 0
        };

        console.log(`[AutoScrollAction] Initializing infinite scroll...`);

        while (state.consecutiveNoChanges < config.maxNoChanges) {
            this.throwIfAborted();

            const hashBefore = this.calculateContentHash(selector, config.sampleSize, selectorType, config.selectionMode);

            const scrollResult = await this.scrollByRows({
                parentSelector: selector,
                selectorType: selectorType as any,
                scrollDelay: config.scrollDelay,
                startIndex: state.lastScrollPosition,
                childHash: state.lastChildHashData ? JSON.stringify(state.lastChildHashData) : null,
                scrollCallback: config.scrollCallback,
                selectionMode: config.selectionMode
            });

            this.throwIfAborted();

            if (scrollResult.success && scrollResult.result) {
                // Update state based on where we actually stopped
                state.lastScrollPosition = scrollResult.result.currentIndex;

                if (scrollResult.result.lastChildHashData) {
                    try {
                        const hashData = typeof scrollResult.result.lastChildHashData === 'string'
                            ? JSON.parse(scrollResult.result.lastChildHashData)
                            : scrollResult.result.lastChildHashData;
                        state.lastChildHashData = hashData;
                    } catch (e) {
                        console.warn("Failed to parse lastChildHashData", e);
                    }
                }
            }

            await this.wait(config.contentLoadDelay);
            this.throwIfAborted();

            const hashAfter = this.calculateContentHash(selector, config.sampleSize, selectorType, config.selectionMode);
            const changes = this.detectContentChanges(hashBefore, hashAfter, config, state.previousContentHash);

            if (changes.anyChange) {
                state.consecutiveNoChanges = 0;
                state.previousContentHash = hashAfter.hash;
                if (this.context?.onProgress) this.context.onProgress({ type: 'status', message: 'Content updated, continuing scroll...' });
            } else if (changes.scrollPositionChanged) {
                // If only scroll position changed but no new items found, we don't necessarily want to stay in loop forever
                // if we are already at the end. But for now, let's just increment slightly or keep waiting.
                if (this.context?.onProgress) this.context.onProgress({ type: 'status', message: 'Movement detected without new content...' });
                // We DON'T reset consecutiveNoChanges here to prevent infinite bumping at the bottom
            } else {
                // If no changes, check for Load More button
                if (config.loadMoreSelector) {
                    if (this.context?.onProgress) this.context.onProgress({ type: 'status', message: 'No scroll changes, checking for Load More button...' });

                    console.log(`[AutoScroll] Checking for Load More button: ${config.loadMoreSelector} (${config.loadMoreSelectorType})`);
                    const clicked = await this.clickLoadMore(config.loadMoreSelector, config.loadMoreSelectorType);

                    if (clicked) {
                        console.log('[AutoScroll] Load More button clicked!');
                        if (this.context?.onProgress) this.context.onProgress({ type: 'status', message: 'Clicked Load More button, waiting for content...' });
                        state.consecutiveNoChanges = 0; // Reset as we expect changes now
                        await this.wait(config.contentLoadDelay);
                        continue;
                    } else {
                        console.log('[AutoScroll] Load More button NOT clicked.');
                    }
                }

                state.consecutiveNoChanges++;
                if (this.context?.onProgress) this.context.onProgress({ type: 'status', message: `No changes detected (${state.consecutiveNoChanges}/${config.maxNoChanges})` });
            }
        }

        return { success: true };
    }

    private async clickLoadMore(selector: string, selectorType: 'selector' | 'xpath' = 'selector'): Promise<boolean> {
        try {
            const cleanSelector = selector.trim();
            // Auto-detect type if it looks like XPath, overriding the passed type if necessary
            // This prevents crashes when "selector" is passed for an XPath string
            let actualType = selectorType;
            if (cleanSelector.startsWith('//') || cleanSelector.startsWith('(')) {
                actualType = 'xpath';
            }

            let element: HTMLElement | null = null;
            if (actualType === 'selector') {
                try {
                    element = document.querySelector(cleanSelector) as HTMLElement;
                } catch (e) {
                    // Fallback: If querySelector fails (e.g. invalid syntax), try XPath just in case
                    console.warn(`[AutoScroll] querySelector failed for "${cleanSelector}", trying XPath fallback.`);
                    actualType = 'xpath';
                }
            }

            if (actualType === 'xpath') {
                try {
                    const result = document.evaluate(cleanSelector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                    element = result.singleNodeValue as HTMLElement;
                } catch (e) {
                    console.warn(`[AutoScroll] XPath evaluation failed for "${cleanSelector}"`);
                }
            }

            if (element) {
                return await this.clickElementRobust(element);
            }
        } catch (e) {
            console.warn('Failed to find/click load more', e);
        }
        return false;
    }

    private async clickElementRobust(element: HTMLElement): Promise<boolean> {
        try {
            element.scrollIntoView({ behavior: "smooth", block: "center" });
            await this.wait(500);
            element.click();
            return true;
        } catch (e) {
            try {
                const clickEvent = new MouseEvent("click", { view: window, bubbles: true, cancelable: true });
                element.dispatchEvent(clickEvent);
                return true;
            } catch (e2) {
                return false;
            }
        }
    }

    public calculateContentHash(selector: string, sampleSize: number = 30, selectorType: string = 'selector', selectionMode: 'container' | 'items' = 'container'): ContentHashResult {
        let container: HTMLElement | null = null;
        let children: Element[] = [];

        if (selectorType.toLowerCase() === 'selector') {
            if (selectionMode === 'items') {
                children = Array.from(document.querySelectorAll(selector));
                container = children.length > 0 ? (children[0].parentElement as HTMLElement) : null;
            } else {
                container = document.querySelector(selector) as HTMLElement;
            }
        } else if (selectorType.toLowerCase() === 'xpath') {
            const result = document.evaluate(selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            container = result.singleNodeValue as HTMLElement;
        }

        if (!container && selectionMode === 'container') {
            return { count: 0, hash: '0', scrollTop: 0, scrollHeight: 0, sampleSize: 0, containerHeight: 0 };
        }

        if (selectionMode === 'container' && container) {
            children = Array.from(container.children);
        }

        const count = children.length;
        let diffString = '';
        const indices: number[] = [];
        const limit = Math.min(sampleSize, count);

        for (let i = 0; i < limit; i++) indices.push(i);
        if (count > sampleSize) {
            for (let i = Math.max(limit, count - sampleSize); i < count; i++) indices.push(i);
        }

        const uniqueIndices = [...new Set(indices)];
        uniqueIndices.forEach(idx => {
            const child = children[idx];
            diffString += child.textContent?.substring(0, 50) || '';
        });

        return {
            count,
            // Encode content safely to support Unicode characters (avoid btoa error)
            hash: btoa(encodeURIComponent(diffString.substring(0, 1000)).replace(/%([0-9A-F]{2})/g, (_, p1) => {
                return String.fromCharCode(parseInt(p1, 16))
            })),
            scrollTop: container ? container.scrollTop : window.scrollY,
            scrollHeight: container ? container.scrollHeight : document.body.scrollHeight,
            sampleSize: uniqueIndices.length,
            containerHeight: container ? container.offsetHeight : window.innerHeight
        };
    }

    private detectContentChanges(oldState: ContentHashResult, newState: ContentHashResult, options: any, previousHash: string) {
        const countChanged = newState.count !== oldState.count;
        const contentChanged = newState.hash !== oldState.hash && newState.hash !== previousHash;
        const scrollPositionChanged = Math.abs(newState.scrollTop - oldState.scrollTop) > (options.minScrollChange || 100);
        const scrollHeightChanged = newState.scrollHeight > oldState.scrollHeight + (options.minHeightChange || 100);

        return {
            countChanged,
            contentChanged,
            scrollPositionChanged,
            scrollHeightChanged,
            anyChange: countChanged || contentChanged || scrollHeightChanged
        };
    }

    private generateChildHash(element: HTMLElement, index: number): ChildHashData {
        const innerText = element.innerText || "";
        const id = element.id || "";
        const className = element.className || "";
        const tagName = element.tagName || "";
        const rect = element.getBoundingClientRect();
        const dimensions = `${Math.round(rect.width)}x${Math.round(rect.height)}:${index}`;

        let attributesStr = "";
        for (const attr of Array.from(element.attributes)) {
            attributesStr += `${attr.name}="${attr.value}" `;
        }

        let childrenStr = "";
        if (element.children.length > 0) {
            const limit = Math.min(3, element.children.length);
            for (let i = 0; i < limit; i++) {
                const child = element.children[i];
                childrenStr += `${child.tagName}:${child.className}:`;
            }
        }

        const rawString = `${tagName}#${id}.${className}[${dimensions}][${attributesStr}][${childrenStr}]${innerText.substring(0, 100)}`;

        // Simple string hash
        let hash = 0;
        for (let i = 0; i < rawString.length; i++) {
            hash = ((hash << 5) - hash) + rawString.charCodeAt(i);
            hash |= 0; // Convert to 32bit integer
        }

        return {
            hash: hash.toString(),
            contextData: {
                index: index,
                tagName: tagName,
                id: id,
                className: className,
                attributes: attributesStr,
                dimensions: {
                    width: Math.round(rect.width),
                    height: Math.round(rect.height)
                },
                childCount: element.children.length,
                textLength: innerText.length,
                firstFewChars: innerText.substring(0, 30)
            }
        };
    }

    private findChildByHash(children: Element[], targetHashDataStr: string | null): { index: number, confidence: 'high' | 'medium' | 'low' | 'none' } {
        if (!targetHashDataStr) return { index: -1, confidence: 'none' };

        let targetData: ChildHashData;
        try {
            targetData = JSON.parse(targetHashDataStr);
        } catch (e) {
            // Deprecated: simplistic string hash fallback if we ever pass just a string
            return { index: -1, confidence: 'none' };
        }

        const targetHash = targetData.hash;
        const context = targetData.contextData;
        const kids = children as HTMLElement[];

        // 1. Try Exact Hash Match
        for (let i = 0; i < kids.length; i++) {
            const h = this.generateChildHash(kids[i], i);
            if (h.hash === targetHash) {
                return { index: i, confidence: 'high' };
            }
        }

        // 2. Try Fuzzy Match (Context Scoring)
        if (context) {
            const scores = kids.map((kid, idx) => {
                const kidData = this.generateChildHash(kid, idx).contextData;
                let score = 0;

                if (kidData.tagName === context.tagName) score += 10;
                if (kidData.id && kidData.id === context.id) score += 20;
                if (kidData.className === context.className) score += 15;

                const dimDiffW = Math.abs(kidData.dimensions.width - context.dimensions.width);
                const dimDiffH = Math.abs(kidData.dimensions.height - context.dimensions.height);
                if (dimDiffW < 5 && dimDiffH < 5) score += 10;

                if (Math.abs(kidData.childCount - context.childCount) < 2) score += 5;
                if (Math.abs(kidData.textLength - context.textLength) < 20) score += 5;

                if (kidData.firstFewChars && context.firstFewChars && kidData.firstFewChars.includes(context.firstFewChars.substring(0, 10))) {
                    score += 10;
                }

                return { index: idx, score };
            });

            scores.sort((a, b) => b.score - a.score);

            if (scores.length > 0 && scores[0].score >= 65) { // [FIX] Increased threshold from 40 to 65 to avoid common false positives (score ~55)
                console.log(`[AutoScrollAction] Fuzzy match found at index ${scores[0].index} with score ${scores[0].score}`);
                return {
                    index: scores[0].index,
                    confidence: scores[0].score >= 70 ? 'high' : 'medium'
                };
            }
        }

        return { index: -1, confidence: 'none' };
    }

    public async scrollByRows(options: AutoScrollConfig) {
        const { parentSelector = '', selectorType = 'selector', scrollDelay = 10, startIndex = 0, selectionMode = 'container', rootElement, childHash } = options; // [SPEED] Default delay 10ms

        let container: HTMLElement | null = null;

        // Initial Container Resolution
        if (rootElement) {
            container = rootElement;
        } else if (selectorType === 'selector') {
            if (selectionMode === 'items') {
                const els = Array.from(document.querySelectorAll(parentSelector));
                container = els.length > 0 ? (els[0].parentElement as HTMLElement) : null;
            } else {
                container = document.querySelector(parentSelector) as HTMLElement;
            }
        }

        if (!container && selectionMode === 'container') return { success: false, error: 'Container not found' };

        // Helper to get current children
        const getChildren = () => {
            const containerItems = container ? (Array.from(container.children) as HTMLElement[]) : [];

            // For item mode, prefer the explicit matches from the selector if they are more inclusive
            if (selectionMode === 'items' && selectorType === 'selector') {
                const selectorItems = Array.from(document.querySelectorAll(parentSelector)) as HTMLElement[];
                if (selectorItems.length > containerItems.length) {
                    return selectorItems;
                }
            }

            return containerItems;
        };

        let children = getChildren();
        if (children.length === 0) return { success: false, error: 'No children found' };

        // Determine Start Index
        let currentIdx = startIndex;

        // Validating Resume Hash
        if (childHash) {
            const match = this.findChildByHash(children, childHash);
            if (match.confidence !== 'none') {
                console.log(`[AutoScrollAction] Resuming from hash match (confidence: ${match.confidence}) at index ${match.index}`);
                currentIdx = match.index + 1; // [FIX] Start from NEXT item to avoid processing the same item in a loop
            }
        }


        let lastProcessedHashData: ChildHashData | null = null;
        let consecutiveNoNewItems = 0;
        const maxNoNewItemsParams = 3; // [REFINED] More patient for lazy loads

        console.log(`[AutoScroll] Starting scroll from index ${currentIdx}. Initial count: ${children.length}`);

        while (true) {
            children = getChildren();

            if (currentIdx >= children.length) {
                if (consecutiveNoNewItems < maxNoNewItemsParams) {
                    consecutiveNoNewItems++;
                    if (container) {
                        container.scrollTop += 100;
                    } else {
                        window.scrollBy(0, 100);
                    }
                    await this.wait(200); // [SPEED] Reduced wait time for new items check
                    continue;
                }
                break;
            }

            // [NEW] Index Re-Sync for Virtualized Lists
            // If we have a hash for the previous item, find where it is now to ensure we don't skip items if the DOM shifted
            if (lastProcessedHashData) {
                const syncMatch = this.findChildByHash(children, JSON.stringify(lastProcessedHashData));
                // [FIX] Require 'high' confidence OR strict index proximity to re-sync backwards
                if (syncMatch.confidence !== 'none' && syncMatch.index !== -1) {
                    const expectedIdx = syncMatch.index + 1;

                    // Only re-sync if the jump is reasonable or confidence is very high
                    const isReasonableJump = Math.abs(currentIdx - expectedIdx) < 5;
                    const isHighConfidence = syncMatch.confidence === 'high';

                    if (currentIdx !== expectedIdx && (isReasonableJump || isHighConfidence)) {
                        console.log(`[AutoScrollAction] Re-syncing index: ${currentIdx} -> ${expectedIdx} (DOM shift detected, conf: ${syncMatch.confidence})`);
                        currentIdx = expectedIdx;

                        // If re-sync put us out of bounds, restart checks
                        if (currentIdx >= children.length) continue;
                    }
                }
            }

            consecutiveNoNewItems = 0; // Reset counter since we have items

            this.throwIfAborted();

            const child = children[currentIdx];

            // Generate hash
            lastProcessedHashData = this.generateChildHash(child, currentIdx);

            // [SPEED] Changed 'smooth' to 'auto' for instant scrolling
            child.scrollIntoView({ behavior: 'auto', block: 'center' });

            if (options.scrollCallback) {
                try {
                    await options.scrollCallback({ scrolledToIndex: currentIdx, element: child, totalCount: children.length });
                } catch (callbackErr) {
                    console.error(`[AutoScrollAction] Callback failed for index ${currentIdx}, skipping:`, callbackErr);
                }
            }

            // [SPEED] Only wait if delay > 0
            if (scrollDelay > 0) {
                await this.wait(scrollDelay);
            }

            currentIdx++;
            consecutiveNoNewItems = 0; // Reset counter after successful advance
        }

        return {
            success: true,
            result: {
                currentIndex: currentIdx,
                lastChildHashData: lastProcessedHashData ? JSON.stringify(lastProcessedHashData) : null
            }
        };
    }
}
