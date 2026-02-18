import { BaseAction, ActionContext } from '../../core/BaseAction';
import { IScrollStrategy, ScrollStrategyConfig } from './IScrollStrategy';
import { MutationAwareScrollStrategy } from './MutationAwareScrollStrategy';
import { IndexedScrollStrategy } from './IndexedScrollStrategy';

export type { ScrollStrategyConfig as AutoScrollConfig };

export type ScrollStrategyType = 'mutationAware' | 'indexed';

/**
 * AutoScrollAction — public facade for auto-scroll behavior.
 *
 * Delegates to a pluggable IScrollStrategy implementation.
 *
 * Default strategy: MutationAwareScrollStrategy
 *   - Uses MutationObserver to detect new DOM nodes after scrolling
 *   - Works on Instagram, Twitter, LinkedIn, TikTok and other infinite feeds
 *   - Handles both container-scroll and window-scroll automatically
 *
 * Alternative strategy: IndexedScrollStrategy
 *   - Original implementation: iterates children by index
 *   - Best for static/paginated lists where all items are in the DOM upfront
 *
 * Usage:
 *   new AutoScrollAction(config)                          // MutationAware (default)
 *   new AutoScrollAction(config, 'indexed')               // IndexedScroll
 *   new AutoScrollAction(config, myCustomStrategy)        // Custom IScrollStrategy
 */
export class AutoScrollAction extends BaseAction {
    private strategy: IScrollStrategy;
    private config: ScrollStrategyConfig;

    constructor(
        config: ScrollStrategyConfig = {},
        strategy: ScrollStrategyType | IScrollStrategy = 'mutationAware'
    ) {
        super();
        this.config = config;

        if (typeof strategy === 'object') {
            this.strategy = strategy;
        } else if (strategy === 'indexed') {
            this.strategy = new IndexedScrollStrategy();
        } else {
            this.strategy = new MutationAwareScrollStrategy();
        }
    }

    public async execute(context: ActionContext): Promise<void> {
        this.context = context;

        if (this.context.onProgress) {
            this.context.onProgress({ type: 'initialize', message: 'Starting autoscroll...' });
        }

        try {
            // The abort signal lives in context.signal (set by ContentScriptController).
            // Re-create the strategy with the signal now that we have context,
            // so throwIfAborted() actually fires when the user clicks Stop.
            const abortSignal = context.signal;
            if (this.strategy instanceof MutationAwareScrollStrategy) {
                this.strategy = new MutationAwareScrollStrategy(abortSignal);
            } else if (this.strategy instanceof IndexedScrollStrategy) {
                this.strategy = new IndexedScrollStrategy(abortSignal);
            }

            const result = await this.strategy.execute(this.config);

            if (!result.success && result.error) {
                console.error('[AutoScrollAction] Strategy failed:', result.error);
            }
        } catch (error: any) {
            if (error.message === 'Action aborted') return;
            throw error;
        }
    }

    // -------------------------------------------------------------------------
    // Legacy API — kept for backward compatibility with existing callers
    // -------------------------------------------------------------------------

    /**
     * @deprecated Use AutoScrollAction with 'indexed' strategy instead.
     * Kept for backward compatibility.
     */
    public async scrollByRows(options: ScrollStrategyConfig) {
        const indexed = new IndexedScrollStrategy();
        return indexed.execute(options);
    }

    /**
     * @deprecated Use AutoScrollAction with 'mutationAware' strategy instead.
     * Kept for backward compatibility.
     */
    public async executeInfiniteScroll(selector: string, selectorType: string = 'selector', options: any = {}) {
        const strategy = new MutationAwareScrollStrategy();
        return strategy.execute({
            selector,
            selectorType: selectorType as 'selector' | 'xpath',
            ...options
        });
    }

    /**
     * Calculates a content hash for change detection.
     * Kept for backward compatibility with callers that use this directly.
     */
    public calculateContentHash(selector: string, sampleSize: number = 30, selectorType: string = 'selector', selectionMode: 'container' | 'items' = 'container') {
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
            hash: btoa(encodeURIComponent(diffString.substring(0, 1000)).replace(/%([0-9A-F]{2})/g, (_, p1) => {
                return String.fromCharCode(parseInt(p1, 16));
            })),
            scrollTop: container ? container.scrollTop : window.scrollY,
            scrollHeight: container ? container.scrollHeight : document.body.scrollHeight,
            sampleSize: uniqueIndices.length,
            containerHeight: container ? container.offsetHeight : window.innerHeight
        };
    }
}

// Re-export implementations for direct use
export { MutationAwareScrollStrategy } from './MutationAwareScrollStrategy';
export { IndexedScrollStrategy } from './IndexedScrollStrategy';
export type { IScrollStrategy } from './IScrollStrategy';
