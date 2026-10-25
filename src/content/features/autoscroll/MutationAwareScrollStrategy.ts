import { IScrollStrategy, ScrollStrategyConfig, ScrollStrategyResult } from './IScrollStrategy';
import { resolveOne } from '../../../shared/selectors/resolve';
import { findLoadMore, scrollerFor, settle } from '../../utils/settle';
import { itemKey, ItemKeys, visualOrder } from './identity';

/** How far each step scrolls, as a share of the scroller's height: the rows between two steps are all seen. */
const STEP = 0.8;
/** How often a wait looks for new items. */
const POLL_MS = 150;

/**
 * MutationAwareScrollStrategy: the default for scrolled lists, infinite feeds and virtual lists
 * (docs/plans/virtual-feeds-plan.md §3.1).
 *
 * A **harvest** loop: at each step, every item in the page now is read right away, in the order on
 * screen, and known by what it shows (`identity.ts`), never by its node. Then the list scrolls by most
 * of a screen and waits until an item it hasn't read appears. So a virtual list that unmounts rows,
 * mounts them back as new nodes or recycles a node for item after item is read once per item, each
 * with its own content.
 *
 * - The container is found again (`resolveRoot`) when the app replaces it.
 * - A "Load more" control (configured, or the page's own) is clicked when scrolling loads nothing.
 * - The run ends after `maxNoChanges` steps with nothing new at the end of the list, at `maxItems`,
 *   after `maxMs`, or on Stop.
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
            selector: itemSelector = '',
            selectorType = 'selector',
            scrollDelay = 50,
            contentLoadDelay = 2500,
            maxNoChanges = 3,
            selectionMode = 'container',
            rootElement,
            maxItems,
            maxMs,
        } = config;

        let container: HTMLElement | null = rootElement ?? (itemSelector ? resolveOne([itemSelector]).result as HTMLElement | null : null);
        if (!container) return { success: false, error: 'Container not found' };

        const itemsMode = selectionMode === 'items' && selectorType === 'selector' && !!itemSelector;
        /** The list now: found again when the app replaced it. */
        const list = (): HTMLElement => {
            if (container!.isConnected) return container!;
            const again = config.resolveRoot?.();
            if (again && again !== container) {
                console.log('[MutationAwareScrollStrategy] The list was replaced: found it again.');
                container = again;
            }
            return container!;
        };
        /** The items in the page now, in the order on screen. */
        const mounted = (): HTMLElement[] => {
            const root = list();
            let els: HTMLElement[] = [];
            if (itemsMode) { try { els = Array.from(root.querySelectorAll<HTMLElement>(itemSelector)); } catch { /* bad selector */ } }
            if (!els.length) els = Array.from(root.children) as HTMLElement[];
            return visualOrder(els);
        };

        const keys = new ItemKeys();
        const seen = new Set<string>();
        const started = Date.now();
        let read = 0;
        const limitHit = () => (!!maxItems && read >= maxItems) || (!!maxMs && Date.now() - started >= maxMs);
        const unseen = () => keys.keys(mounted()).some(k => k && !seen.has(k));

        /** Reads every item in the page now that wasn't read yet. Returns how many it read. */
        const harvest = async (): Promise<number> => {
            let fresh = 0;
            const els = mounted();
            const before = keys.keys(els);
            for (const [i, el] of els.entries()) {
                this.throwIfAborted();
                if (!el.isConnected || !before[i] || seen.has(before[i])) continue;
                el.scrollIntoView({ behavior: 'auto', block: 'nearest' });
                // What it shows now: a recycled node may have moved on to another item.
                const key = keys.key(el);
                if (!key || seen.has(key)) continue;
                seen.add(key);
                // Under both keys: a link key that later needs its text still finds this item.
                seen.add(itemKey(el)).add(itemKey(el, true));
                if (config.scrollCallback) {
                    try {
                        await config.scrollCallback({ scrolledToIndex: read, element: el, totalCount: seen.size, key });
                    } catch (err) {
                        console.error(`[MutationAwareScrollStrategy] Callback failed at item ${read}:`, err);
                    }
                }
                read++;
                fresh++;
                if (limitHit()) return fresh;
                if (scrollDelay > 0) await this.wait(scrollDelay);
            }
            return fresh;
        };

        /** The list's end is above the bottom of what's shown: scrolling on only passes what's after it. */
        const pastList = () => {
            const scroller = scrollerFor(list());
            const bottom = scroller instanceof Window ? window.innerHeight : scroller.getBoundingClientRect().bottom;
            return list().getBoundingClientRect().bottom <= bottom + 2;
        };

        let noChanges = 0;
        /** Steps that scrolled but found nothing: a page that keeps moving without loading ends too. */
        let emptySteps = 0;
        let waitMs = contentLoadDelay;
        try {
            while (true) {
                this.throwIfAborted();
                if (await harvest() > 0) { noChanges = 0; emptySteps = 0; waitMs = contentLoadDelay; }
                if (limitHit()) { console.log(`[MutationAwareScrollStrategy] Limit reached (${read} items).`); break; }

                const moved = this.triggerScroll(scrollerFor(list()), list());
                if (await this.waitFor(waitMs, unseen)) {
                    // Let them finish rendering (prices, images) before they are read.
                    await settle(list(), 300, 2000, this.abortSignal);
                    continue;
                }
                // Still scrolling through the list: its next items may be further down.
                if (moved && !pastList() && ++emptySteps < maxNoChanges * 6) continue;

                // At the end with nothing new: a "Load more" control (the configured one, else the page's own).
                if (config.loadMoreSelectors?.length || findLoadMore(list())) {
                    const clicked = config.loadMoreSelectors?.length
                        ? await this.clickLoadMoreWithRetry(config.loadMoreSelectors)
                        : await this.clickFound(list());
                    if (clicked && await this.waitFor(waitMs, unseen)) { noChanges = 0; continue; }
                }

                noChanges++;
                if (noChanges >= maxNoChanges) break;
                // Slow sites: wait longer each time (up to twice the delay).
                waitMs = Math.min(Math.round(waitMs * 1.5), contentLoadDelay * 2);
                console.log(`[MutationAwareScrollStrategy] Nothing new (${noChanges}/${maxNoChanges}). Next wait: ${waitMs}ms`);
            }
        } finally {
            console.log(`[MutationAwareScrollStrategy] Done: ${read} items.`);
        }

        return { success: true, result: { currentIndex: read, lastChildHashData: null } };
    }

    /**
     * Triggers a scroll and returns whether scroll position actually changed.
     */
    private triggerScroll(target: HTMLElement | Window, container: HTMLElement): boolean {
        try {
            let before: number;
            if (target instanceof Window) {
                before = window.scrollY;
                window.scrollBy({ top: Math.round(window.innerHeight * STEP), behavior: 'auto' });
            } else {
                before = target.scrollTop;
                target.scrollTop += Math.round(target.clientHeight * STEP);
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

    /** Resolves true as soon as `check` holds, false after `timeoutMs` (or on Stop). */
    private async waitFor(timeoutMs: number, check: () => boolean): Promise<boolean> {
        for (let waited = 0; waited < timeoutMs; waited += POLL_MS) {
            if (this.abortSignal?.aborted) return false;
            await this.wait(POLL_MS);
            if (check()) return true;
        }
        return false;
    }

    /**
     * Attempts to click a "Load More" button with retry.
     */
    private async clickLoadMoreWithRetry(chain: string[]): Promise<boolean> {
        for (let attempt = 0; attempt < 2; attempt++) {
            const clicked = await this.clickLoadMore(chain);
            if (clicked) return true;
            if (attempt < 1) await this.wait(1000);
        }
        return false;
    }

    /** Clicks the page's own "Show more" control for the list, when there is one. */
    private async clickFound(container: HTMLElement): Promise<boolean> {
        const el = findLoadMore(container);
        if (!el) return false;
        el.scrollIntoView({ behavior: 'auto', block: 'center' });
        el.click();
        await settle(container, 300, 2000, this.abortSignal);
        return true;
    }

    private async clickLoadMore(chain: string[]): Promise<boolean> {
        try {
            const element = resolveOne(chain).result as HTMLElement | null;

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
}
