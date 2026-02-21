import { IScrollStrategy, ScrollStrategyConfig, ScrollStrategyResult } from './IScrollStrategy';

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

        if (!container && selectionMode === 'container') {
            return { success: false, error: 'Container not found' };
        }

        const getChildren = (): HTMLElement[] => {
            const containerItems = container ? (Array.from(container.children) as HTMLElement[]) : [];
            if (selectionMode === 'items' && selectorType === 'selector') {
                const selectorItems = Array.from(document.querySelectorAll(parentSelector)) as HTMLElement[];
                if (selectorItems.length > containerItems.length) return selectorItems;
            }
            return containerItems;
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
        const maxNoNewItems = 3;

        console.log(`[IndexedScrollStrategy] Starting from index ${currentIdx}. Initial count: ${children.length}`);

        while (true) {
            children = getChildren();

            if (currentIdx >= children.length) {
                if (consecutiveNoNewItems < maxNoNewItems) {
                    consecutiveNoNewItems++;
                    if (container) {
                        container.scrollTop += 100;
                    } else {
                        window.scrollBy(0, 100);
                    }
                    await this.wait(200);
                    continue;
                }
                break;
            }

            // Re-sync index if DOM shifted
            if (lastProcessedHashData) {
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
        const rect = element.getBoundingClientRect();
        const dimensions = `${Math.round(rect.width)}x${Math.round(rect.height)}:${index}`;

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

        const rawString = `${tagName}#${id}.${className}[${dimensions}][${attributesStr}][${childrenStr}]${innerText.substring(0, 100)}`;
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
                dimensions: { width: Math.round(rect.width), height: Math.round(rect.height) },
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

        // 2. Fuzzy match
        if (context) {
            const scores = children.map((kid, idx) => {
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
                if (kidData.firstFewChars && context.firstFewChars && kidData.firstFewChars.includes(context.firstFewChars.substring(0, 10))) score += 10;
                return { index: idx, score };
            });

            scores.sort((a, b) => b.score - a.score);
            if (scores.length > 0 && scores[0].score >= 65) {
                return { index: scores[0].index, confidence: scores[0].score >= 70 ? 'high' : 'medium' };
            }
        }

        return { index: -1, confidence: 'none' };
    }
}
