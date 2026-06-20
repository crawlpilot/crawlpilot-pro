import { BaseAction, ActionContext } from '../../core/BaseAction';
import { IScrollStrategy, ScrollStrategyConfig } from './IScrollStrategy';
import { MutationAwareScrollStrategy } from './MutationAwareScrollStrategy';
import { IndexedScrollStrategy } from './IndexedScrollStrategy';

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

}
