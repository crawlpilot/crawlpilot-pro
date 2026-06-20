import { IScrollStrategy, ScrollStrategyConfig, ScrollStrategyResult } from './IScrollStrategy';

interface ChildHashData {
    hash: string;
    contextData: {
        index: number;
        tagName: string;
        id: string;
        className: string;
        attributes: string;
        childCount: number;
        textLength: number;
        firstFewChars: string;
    };
}

/**
 * IndexedScrollStrategy — the original implementation, extracted from AutoScrollAction.
 *
 * Iterates through a container's children by index, scrolling each into view.
 * Uses hash-based resume to pick up where it left off after page reloads or
 * between extraction batches.
 *
 * Strengths: Reliable for static lists and paginated content.
 * Weaknesses: Does not wait for new DOM nodes to appear after scrolling.
 *             Fails on virtualized/infinite feeds (Instagram, Twitter) where
 *             new items are appended asynchronously after the scroll event.
 */
export class IndexedScrollStrategy implements IScrollStrategy {
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
            scrollDelay = 10,
            startIndex = 0,
            selectionMode = 'container',
            rootElement,
            childHash
        } = config;

        let container: HTMLElement | null = null;

        if (rootElement) {
            container = rootElement;
        } else if (selectorType === 'xpath') {
            const result = document.evaluate(parentSelector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            container = result.singleNodeValue as HTMLElement;
        } else {
            container = document.querySelector(parentSelector) as HTMLElement;
        }

        if (!container && selectionMode === 'container') {
            return { success: false, error: 'Container not found' };
        }

        const getChildren = (): HTMLElement[] => {
            if (!container) return [];
            if (selectionMode === 'items' && selectorType === 'selector' && parentSelector) {
                const scoped = Array.from(container.querySelectorAll(parentSelector)) as HTMLElement[];
                if (scoped.length > 0) return scoped;
            }
            return Array.from(container.children) as HTMLElement[];
        };

        let children = getChildren();
        if (children.length === 0) return { success: false, error: 'No children found' };

        let currentIdx = startIndex;

        if (childHash) {
            const match = this.findChildByHash(children, childHash);
            if (match.confidence !== 'none') {
                console.log(`[IndexedScrollStrategy] Resuming from hash match (confidence: ${match.confidence}) at index ${match.index}`);
                currentIdx = match.index + 1;
            }
        }

        let lastProcessedHashData: ChildHashData | null = null;
        let consecutiveNoNewItems = 0;
        const maxNoNewItems = 5;
        let resyncCounter = 0;

        console.log(`[IndexedScrollStrategy] Starting from index ${currentIdx}. Initial count: ${children.length}`);

        while (true) {
            children = getChildren();

            if (currentIdx >= children.length) {
                if (consecutiveNoNewItems < maxNoNewItems) {
                    consecutiveNoNewItems++;
                    const scrollAmount = container ? Math.max(container.clientHeight / 2, 200) : Math.max(window.innerHeight / 2, 200);
                    if (container) {
                        container.scrollTop += scrollAmount;
                    } else {
                        window.scrollBy(0, scrollAmount);
                    }
                    await this.wait(500);
                    continue;
                }
                break;
            }

            // Re-sync index if DOM shifted — checked every 10 elements to avoid O(n) scan per tick
            resyncCounter++;
            if (lastProcessedHashData && resyncCounter % 10 === 0) {
                const syncMatch = this.findChildByHash(children, JSON.stringify(lastProcessedHashData));
                if (syncMatch.confidence !== 'none' && syncMatch.index !== -1) {
                    const expectedIdx = syncMatch.index + 1;
                    const isReasonableJump = Math.abs(currentIdx - expectedIdx) < 5;
                    const isHighConfidence = syncMatch.confidence === 'high';
                    if (currentIdx !== expectedIdx && (isReasonableJump || isHighConfidence)) {
                        console.log(`[IndexedScrollStrategy] Re-syncing index: ${currentIdx} -> ${expectedIdx}`);
                        currentIdx = expectedIdx;
                        if (currentIdx >= children.length) continue;
                    }
                }
            }

            consecutiveNoNewItems = 0;
            this.throwIfAborted();

            const child = children[currentIdx];
            lastProcessedHashData = this.generateChildHash(child, currentIdx);

            child.scrollIntoView({ behavior: 'auto', block: 'center' });

            if (config.scrollCallback) {
                try {
                    await config.scrollCallback({ scrolledToIndex: currentIdx, element: child, totalCount: children.length });
                } catch (err) {
                    console.error(`[IndexedScrollStrategy] Callback failed at index ${currentIdx}:`, err);
                }
            }

            if (scrollDelay > 0) await this.wait(scrollDelay);
            currentIdx++;
            consecutiveNoNewItems = 0;
        }

        return {
            success: true,
            result: {
                currentIndex: currentIdx,
                lastChildHashData: lastProcessedHashData ? JSON.stringify(lastProcessedHashData) : null
            }
        };
    }

    private generateChildHash(element: HTMLElement, index: number): ChildHashData {
        const innerText = element.innerText || '';
        const id = element.id || '';
        const className = element.className || '';
        const tagName = element.tagName || '';

        let attributesStr = '';
        for (const attr of Array.from(element.attributes)) {
            attributesStr += `${attr.name}="${attr.value}" `;
        }

        let childrenStr = '';
        if (element.children.length > 0) {
            const limit = Math.min(3, element.children.length);
            for (let i = 0; i < limit; i++) {
                const child = element.children[i];
                childrenStr += `${child.tagName}:${child.className}:`;
            }
        }

        const rawString = `${tagName}#${id}.${className}[${index}][${attributesStr}][${childrenStr}]${innerText.substring(0, 100)}`;
        let hash = 0;
        for (let i = 0; i < rawString.length; i++) {
            hash = ((hash << 5) - hash) + rawString.charCodeAt(i);
            hash |= 0;
        }

        return {
            hash: hash.toString(),
            contextData: {
                index, tagName, id, className,
                attributes: attributesStr,
                childCount: element.children.length,
                textLength: innerText.length,
                firstFewChars: innerText.substring(0, 30)
            }
        };
    }

    private findChildByHash(children: HTMLElement[], targetHashDataStr: string | null): { index: number; confidence: 'high' | 'medium' | 'low' | 'none' } {
        if (!targetHashDataStr) return { index: -1, confidence: 'none' };

        let targetData: ChildHashData;
        try {
            targetData = JSON.parse(targetHashDataStr);
        } catch {
            return { index: -1, confidence: 'none' };
        }

        const targetHash = targetData.hash;
        const context = targetData.contextData;

        // 1. Exact hash match
        for (let i = 0; i < children.length; i++) {
            const h = this.generateChildHash(children[i], i);
            if (h.hash === targetHash) return { index: i, confidence: 'high' };
        }

        // 2. Fuzzy match — dimensions removed; score on structure and text only
        if (context) {
            const scores = children.map((kid, idx) => {
                const kidData = this.generateChildHash(kid, idx).contextData;
                let score = 0;
                if (kidData.tagName === context.tagName) score += 10;
                if (kidData.id && kidData.id === context.id) score += 20;
                if (kidData.className === context.className) score += 15;
                if (Math.abs(kidData.childCount - context.childCount) < 2) score += 5;
                if (Math.abs(kidData.textLength - context.textLength) < 20) score += 5;
                if (kidData.firstFewChars && context.firstFewChars && kidData.firstFewChars.includes(context.firstFewChars.substring(0, 10))) score += 10;
                return { index: idx, score };
            });

            scores.sort((a, b) => b.score - a.score);
            if (scores.length > 0 && scores[0].score >= 55) {
                return { index: scores[0].index, confidence: scores[0].score >= 60 ? 'high' : 'medium' };
            }
        }

        return { index: -1, confidence: 'none' };
    }
}
