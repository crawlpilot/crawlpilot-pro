import { refreshNetSourcesFor } from '../../services/extraction/structuredRows';
import { settle } from '../../utils/settle';
import { checkPage, hasReaders, inferFields, readWhenReady, similarSiblings, unmappedCount, ReaderColumn } from '../../services/extraction/fields';
import { withAtomCache } from '../../services/extraction/atoms';
import { NextButtonSelector } from '../../services/selectors/nextButton';
import { BaseAction, ActionContext } from '../../core/BaseAction';
import { AutoScrollAction } from '../autoscroll/AutoScrollAction';
import { HL_COLOR, HL_BG, HL_GLOW_STRONG } from '../../utils/highlight-tokens';
import { looksLikeXPath, resolveContainer, resolveItems } from '../../../shared/selectors/resolve';
import { listLocators } from '../../services/selectors/list';
import { hashString } from '../../../shared/utils/hash';
import { classifyPage, collectPageSignals, PageVerdict, VERDICT_LABELS } from '../../../shared/verdict/classifyPage';
import { PaginationResume, storage } from '../../../shared/storage';
import type { PaginationRequest } from '../../../shared/messages';

/** The request as sent (and saved across page loads), with the list's fields once known. */
export interface PaginationConfig extends Omit<PaginationRequest, 'columns'> {
    scrollDelay?: number;
    /**
     * The list's fields (columns with readers). Taken from the preview when it has them, otherwise
     * inferred once on the first page. Kept on the config, so the saved resume state carries them
     * across page loads and every page is read with the same fields.
     */
    columns?: ReaderColumn[];
}

/**
 * PaginationAction handles multi-page navigation and data collection.
 * Roles: Navigation across pages.
 */
/** Rows per progress message to the side panel. */
const PROGRESS_BATCH = 10;

export class PaginationAction extends BaseAction {
    private visitedUrls: Set<string>;
    private lastPageHash: string | null = null;
    /** Whether this page's container or items were found through a fallback entry (or a healed selector). */
    private usedFallback = false;
    /** An item selector re-derived on this run because the stored chain no longer matched: sent once, saved to the recipe. */
    private healedItems: string | undefined;
    /** This page's field check: fields found again by meaning, and fields that read nothing like before. */
    private fieldHealth: { healed: string[]; broken: string[] } | undefined;

    constructor(private config: PaginationConfig) {
        super();
        this.visitedUrls = new Set();
    }

    /**
     * Executes the pagination loop: Extract -> Click Next -> Wait -> Repeat
     */
    public async execute(context: ActionContext): Promise<any> {
        this.context = context;
        const config = this.config;
        const internalConfig = this.getInternalConfig();
        const { maxPages = -1, resumeState } = config;

        // State initialization
        let { pageCount, totalItems, consecutiveNoContentChanges } = this.initializeState();


        const containerSelectors = this.getContainerSelectors();

        console.log('⏱️ [PaginationAction] Active Internal Config:', internalConfig);
        console.log(`🚀 [PaginationAction] Started (${config.mode || 'pagination'}). Max pages:`, maxPages);
        console.log(`📋 [PaginationAction] Resume State present?`, !!resumeState, resumeState);

        this.context.onProgress?.({ type: 'initialize', message: 'Initializing pagination extraction...' });

        try {
            // Initial Phase or Resume logic
            let container: HTMLElement | null = null;

            if (!resumeState) {
                // Initial Page Extraction
                this.context.onProgress?.({ type: 'navigate', page: pageCount, message: `Processing page ${pageCount}` });

                container = this.findContainerRobust(containerSelectors);
                if (!container) throw new Error(`Container not found. Tried: ${containerSelectors.join(', ')}`);

                this.visitedUrls.clear();
                this.visitedUrls.add(window.location.href);

                const { newTotal } = await this.processPageContent(container, pageCount, totalItems);
                totalItems = newTotal;
            } else {
                // Formatting for resume
                pageCount++; // Resume starts on the NEXT page
                console.log(`🔄 [PaginationAction] Resuming session. Now processing: Page ${pageCount}`);

                this.context.onProgress?.({ type: 'navigate', page: pageCount, message: `Processing page ${pageCount} (Resumed)` });
                await this.wait(internalConfig.contentLoadDelay);

                if (!(await this.ensurePageUsable())) {
                    await this.clearState();
                    return { success: true, totalItems, pageCount, reason: 'page_blocked' };
                }

                container = await this.findContainerWithRetry(containerSelectors);

                if (container) {

                    const { newTotal } = await this.processPageContent(container, pageCount, totalItems);
                    totalItems = newTotal;

                    if (config.mode === 'loadMore') {
                        console.log(`[PaginationAction] LoadMore resume: Reset totalItems to ${totalItems}`);
                    }
                } else {
                    console.warn('⚠️ [PaginationAction] Container not found during resume.');
                }
            }

            // Pagination Loop
            while (this.shouldContinue(pageCount, maxPages)) {
                this.throwIfAborted();

                const navigationResult = await this.navigateToNextPage(pageCount, totalItems, internalConfig);

                if (navigationResult.status === 'complete' || navigationResult.status === 'error') {
                    // Stop or Error handled within navigateToNextPage logs
                    break;
                }

                pageCount++;

                // URL Loop Detection — only meaningful for URL-based navigation.
                // For JS-driven (content_change) pagination the URL is always the same;
                // duplicate-page detection is handled by the calculatePageHash check below.
                if (navigationResult.navigationMode === 'url_change') {
                    const currentUrl = window.location.href;
                    if (this.visitedUrls.has(currentUrl)) {
                        console.log('🛑 [Pagination] URL already visited, stopping before re-extraction:', currentUrl);
                        this.context.onProgress?.({ type: 'complete', reason: 'url_loop_detected', message: "Pagination complete - returned to a previously visited page" });
                        break;
                    }
                    this.visitedUrls.add(currentUrl);
                }

                // Content Processing Phase
                this.context?.onProgress?.({ type: 'navigate', page: pageCount, message: `Processing page ${pageCount}` });

                if (!(await this.ensurePageUsable())) break;

                let newContainer = await this.findContainerWithRetry(containerSelectors);

                if (!newContainer) {
                    console.log('🛑 [Pagination] Container lost after navigation confirmation');
                    this.context?.onProgress?.({ type: 'error', message: 'Container lost after navigation' });
                    break;
                }

                // Page Integrity Check BEFORE extracting — prevents emitting duplicate items
                const currentPageHash = this.calculatePageHash(newContainer);
                if (this.lastPageHash !== null && this.lastPageHash === currentPageHash) {
                    console.log('🛑 [Pagination] Page content identical to previous page, stopping before re-extraction');
                    this.context.onProgress?.({ type: 'complete', reason: 'content_unchanged', message: "Pagination complete - page content unchanged after navigation" });
                    break;
                }

                const { extractedCount, newTotal } = await this.processPageContent(newContainer!, pageCount, totalItems);
                totalItems = newTotal;
                this.lastPageHash = currentPageHash;

                if (extractedCount <= 0) {
                    consecutiveNoContentChanges++;
                    if (consecutiveNoContentChanges >= internalConfig.maxContentNoChange) {
                        this.context.onProgress?.({ type: 'complete', reason: 'no_new_content', message: "Pagination complete - no more new content found" });
                        break;
                    }
                } else {
                    consecutiveNoContentChanges = 0;
                }

                this.context.onProgress?.({ type: 'wait', message: `Waiting for page stability (${internalConfig.pageLoadDelay}ms)...` });
                await this.wait(internalConfig.pageLoadDelay);
            }

            // Cleanup & Finish
            if (maxPages !== -1 && pageCount >= maxPages) {
                this.context.onProgress?.({ type: 'complete', reason: 'max_pages_reached', message: `Pagination complete - reached limit of ${maxPages}` });
            }

            await this.clearState();
            return { success: true, totalItems, pageCount };

        } catch (error: any) {
            return this.handleError(error, pageCount, totalItems);
        }
    }

    // --- Helper Methods ---

    /** Verdicts that end a listing run: the next page is a wall, not more items. */
    private static readonly STOPPING_VERDICTS: PageVerdict[] = ['blocked', 'rate_limited', 'waiting_room', 'login_wall', 'http_error', 'challenge'];

    /**
     * Checks the page that pagination just landed on. A bot check waits (up to 3 minutes) for the
     * user to solve it in this tab; any other wall ends the run with reason 'page_blocked'.
     */
    private async ensurePageUsable(): Promise<boolean> {
        let check = classifyPage(collectPageSignals(), window.location.href);
        if (check.verdict === 'challenge') {
            this.context?.onProgress?.({ type: 'status', message: 'This page is asking to verify you are human. Solve it to continue.' });
            const deadline = Date.now() + 3 * 60_000;
            while (check.verdict === 'challenge' && Date.now() < deadline) {
                await this.wait(3000);
                this.throwIfAborted();
                check = classifyPage(collectPageSignals(), window.location.href);
            }
        }
        if (!PaginationAction.STOPPING_VERDICTS.includes(check.verdict)) return true;
        const label = VERDICT_LABELS[check.verdict];
        this.context?.onProgress?.({ type: 'complete', reason: 'page_blocked', message: `Pagination stopped - ${label}${check.reason ? ` (${check.reason})` : ''}` });
        return false;
    }

    private getInternalConfig() {
        return {
            contentLoadDelay: this.config.contentLoadDelay || 1000,
            pageLoadDelay: this.config.pageLoadDelay || 500,
            urlChangeTimeout: this.config.urlChangeTimeout || 10000,
            maxContentNoChange: 2,
            scrollDelay: this.config.scrollDelay || 300
        };
    }

    /** The frozen fields: the preview's, or inferred once from the first page's rows. */
    private fieldsFor(row: Element, container: Element, itemSelector?: string): ReaderColumn[] {
        if (hasReaders(this.config.columns)) return this.config.columns;
        let sample: Element[] = [];
        try { sample = itemSelector ? Array.from(container.querySelectorAll(itemSelector)) : Array.from(container.children); } catch { /* bad selector */ }
        if (sample.length < 2) sample = similarSiblings(row);
        this.config.columns = inferFields(sample).columns;
        return this.config.columns;
    }

    private initializeState() {
        const { resumeState } = this.config;
        return {
            pageCount: resumeState ? resumeState.pageCount : 1,
            consecutiveNoContentChanges: 0,
            totalItems: resumeState ? resumeState.totalItems : 0
        };
    }

    private getContainerSelectors(): string[] {
        return this.config.container;
    }

    private shouldContinue(pageCount: number, maxPages: number): boolean {
        return (maxPages === -1 || pageCount < maxPages);
    }

    private async processPageContent(
        container: HTMLElement,
        pageCount: number,
        currentTotal: number
    ): Promise<{ extractedCount: number, newTotal: number }> {

        let extractedCount = 0;
        let newTotal = currentTotal;
        let processedInPage = new Set<number>();
        let pageItems: any[] = [];
        const mode = this.config.mode || 'pagination';

        // Rows go to the side panel in batches, not one message per row.
        let pending: Record<string, string>[] = [];
        let pendingUnmapped = 0;
        let pendingLoading = 0;
        let lastColumns: ReaderColumn[] | undefined;
        const flush = () => {
            if (pending.length === 0) return;
            this.context?.onProgress?.({
                type: 'data',
                items: pending,
                columns: lastColumns,
                unmapped: pendingUnmapped,
                loading: pendingLoading || undefined,
                fallback: this.usedFallback || undefined,
                healedItems: this.healedItems,
                healedFields: this.fieldHealth?.healed.length ? this.fieldHealth.healed : undefined,
                brokenFields: this.fieldHealth?.broken.length ? this.fieldHealth.broken : undefined,
                page: pageCount,
                cumulativeTotal: mode !== 'loadMore' ? newTotal : pageItems.length
            });
            pending = [];
            pendingUnmapped = 0;
            pendingLoading = 0;
            this.healedItems = undefined;
            this.fieldHealth = undefined;
        };

        this.context?.onProgress?.({ type: 'extract', page: pageCount, message: 'Scrolling and extracting data...' });

        // [NEW] Resolve the item selector chain against this page's container, with
        // fallback across the chain entries. Only CSS entries can scope IndexedScrollStrategy's
        // items mode (XPath entries fall back to walking container.children below).
        let itemSelectionMode: 'container' | 'items' = 'container';
        let resolvedItemSelector: string | undefined;
        const itemChain = this.itemChain();
        if (itemChain.length > 0) {
            const { result, used } = resolveItems(itemChain, container);
            const selector = used >= 0 ? itemChain[used] : undefined;
            if (used > 0) this.usedFallback = true;
            if (result.length > 0 && selector && !looksLikeXPath(selector)) {
                itemSelectionMode = 'items';
                resolvedItemSelector = selector;
            } else {
                // [NEW] Verify-and-heal: the whole stored chain is stale (e.g. the site
                // redeployed with new hash classes). Re-derive a fresh item selector from
                // this page's actual children rather than silently reverting to
                // container.children, which can pull in ads/spacers the original pick excluded.
                const healed = this.healItemSelector(container);
                if (healed) {
                    this.usedFallback = true;
                    itemSelectionMode = 'items';
                    resolvedItemSelector = healed;
                    console.log('[PaginationAction] Item selector chain stale — healed to:', healed);
                    this.healedItems = healed;
                }
            }
        }

        // Every page is checked against the fields' expectations; what broke is found again by meaning.
        if (hasReaders(this.config.columns)) {
            let rows: Element[] = [];
            try { rows = resolvedItemSelector ? Array.from(container.querySelectorAll(resolvedItemSelector)) : Array.from(container.children); } catch { /* bad selector */ }
            const health = checkPage(rows, this.config.columns);
            if (health.columns !== this.config.columns) this.config.columns = health.columns;
            if (health.healed.length || health.broken.length) {
                this.fieldHealth = { healed: health.healed, broken: health.broken };
                console.log('[PaginationAction] Field check on page', pageCount, this.fieldHealth);
            }
        }

                // Use 'indexed' strategy: the container is a static DOM element during pagination,
        // not an infinite feed. MutationAware would wait unnecessarily for new nodes.
        const autoScroll = new AutoScrollAction({
            rootElement: container,
            scrollDelay: this.config.scrollDelay || 400,
            selectionMode: itemSelectionMode,
            selector: resolvedItemSelector,
            scrollCallback: async (info: any) => {
                const { element, scrolledToIndex } = info;
                if (!element || processedInPage.has(scrolledToIndex)) return;

                const columns = this.fieldsFor(element, container, resolvedItemSelector);
                lastColumns = columns;
                await refreshNetSourcesFor(columns);
                // A row still loading is read again after the page settles.
                const { item: normalizedItem, pending: stillLoading } = await readWhenReady(element, columns, () => settle(element, 300, 1000));
                if (stillLoading && Object.keys(normalizedItem).length > 0) pendingLoading++;
                const unmapped = withAtomCache(() => unmappedCount(element, columns));
                if (Object.keys(normalizedItem).length > 0) {
                    processedInPage.add(scrolledToIndex);

                    pageItems.push(normalizedItem);
                    this.highlightProcessedElement(element);

                    extractedCount++;
                    if (mode !== 'loadMore') {
                        newTotal++;
                    }
                    pending.push(normalizedItem);
                    if (unmapped > 0) pendingUnmapped++;
                    if (pending.length >= PROGRESS_BATCH) flush();
                }
            }
        }, 'indexed');

        await autoScroll.execute(this.context!);
        flush();

        if (mode === 'loadMore') {
            newTotal = pageItems.length;
        }

        this.usedFallback = false;
        return { extractedCount, newTotal };
    }

    /**
     * Re-derives the item selector from this page's container children when the stored chain no
     * longer matches anything, the way the picker does (`listLocators`: the children `keepItems`
     * keeps, matched exactly). Only fires when the chain is fully broken.
     */
    private healItemSelector(container: HTMLElement): string | null {
        try {
            const children = Array.from(container.children) as HTMLElement[];
            if (children.length < 2) return null;
            return listLocators(container, children).items.find(c => !looksLikeXPath(c.selector))?.selector ?? null;
        } catch {
            return null;
        }
    }

    private async findContainerWithRetry(selectors: string[], timeoutMs: number = 5000): Promise<HTMLElement | null> {
        let container: HTMLElement | null = null;
        const startTime = Date.now();
        while (Date.now() - startTime < timeoutMs) {
            this.throwIfAborted();
            container = this.findContainerRobust(selectors);
            if (container) return container;
            await this.wait(500);
        }
        return null;
    }

    private async navigateToNextPage(pageCount: number, totalItems: number, internalConfig: any): Promise<{ status: 'success' | 'complete' | 'error', message?: string, navigationMode?: 'url_change' | 'content_change' }> {
        const findSelectors = this.config.next.map(value => ({ value, type: looksLikeXPath(value) ? 'xpath' as const : 'selector' as const }));

        const findResult = NextButtonSelector.find(document, findSelectors, "next button", {
            requireVisible: true,
            requireEnabled: true
        });

        if (!findResult.success || !findResult.element) {
            this.context?.onProgress?.({ type: 'complete', reason: 'no_more_pagination_buttons', message: "Pagination complete - no more 'Next' buttons found" });
            return { status: 'complete' };
        }

        const nextBtn = findResult.element;
        const urlBefore = window.location.href;

        const containerSelectors = this.getContainerSelectors();
        const preClickEl = this.findContainerRobust(containerSelectors);
        const preClickHash = preClickEl ? this.calculatePageHash(preClickEl) : null;

        this.context?.onProgress?.({
            type: 'click',
            page: pageCount,
            nextPage: pageCount + 1,
            message: "Clicking 'Next Page' button..."
        });

        await this.saveState({ config: this.config, pageCount, totalItems });

        const clicked = await this.clickElementRobust(nextBtn);
        if (!clicked) {
            this.context?.onProgress?.({ type: 'complete', reason: 'unable_to_click', message: "Pagination complete - unable to click 'Next' button" });
            return { status: 'error', message: 'Unable to click next button' };
        }

        this.context?.onProgress?.({ type: 'wait', message: 'Waiting for navigation...' });
        const navigationResult = await this.waitForNavigationOrLoad(
            urlBefore,
            internalConfig.urlChangeTimeout,
            containerSelectors,
            preClickHash ?? undefined
        );
        this.throwIfAborted();

        if (navigationResult === 'timeout') {
            // Neither URL nor content changed after click — no more pages
            this.context?.onProgress?.({ type: 'complete', reason: 'no_navigation', message: "Pagination complete - no navigation detected after clicking Next" });
            return { status: 'complete' };
        }

        const navMode = navigationResult === 'content_change' ? 'content_change' : 'url_change';

        this.context?.onProgress?.({ type: 'wait', message: `Waiting for page content (${internalConfig.contentLoadDelay}ms)...` });
        await this.wait(internalConfig.contentLoadDelay);
        this.throwIfAborted();
        return { status: 'success', navigationMode: navMode };
    }

    private async handleError(error: any, pageCount: number, totalItems: number) {
        if (error.message === 'Action aborted') {
            // Clear persisted state so the next page load does NOT auto-resume.
            // Previously this was missing, causing pagination to restart after user stopped.
            await this.clearState();
            this.context?.onProgress?.({ type: 'complete', reason: 'cancelled', message: `Stopped by user after ${pageCount} pages` });
            return { success: true, reason: 'stopped_by_user', pageCount, totalItems };
        }
        this.context?.onProgress?.({ type: 'error', message: error.message });
        return { success: false, error: error.message };
    }

    /** The list's container on this page: the first entry of its chain that holds the list's items. */
    private findContainerRobust(selectors: string[]): HTMLElement | null {
        const { result, used } = resolveContainer(selectors, this.itemChain());
        if (used > 0) this.usedFallback = true;
        return result;
    }

    private itemChain(): string[] {
        return this.config.items;
    }

    private highlightProcessedElement(element: HTMLElement) {
        // Add a temporary overlay highlight to indicate successful processing
        const rect = element.getBoundingClientRect();
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        const scrollLeft = window.scrollX || document.documentElement.scrollLeft;

        // Ensure rect is valid (visible)
        if (rect.width === 0 || rect.height === 0) return;

        const highlight = document.createElement('div');
        highlight.style.cssText = `
            position: absolute !important;
            top: ${rect.top + scrollTop}px !important;
            left: ${rect.left + scrollLeft}px !important;
            width: ${rect.width}px !important;
            height: ${rect.height}px !important;
            border: 2px solid ${HL_COLOR} !important;
            background-color: ${HL_BG} !important;
            box-shadow: 0 0 12px ${HL_GLOW_STRONG} !important;
            z-index: 2147483647 !important;
            pointer-events: none !important;
            border-radius: 4px !important;
            transition: opacity 0.2s ease-out !important;
        `;
        document.body.appendChild(highlight);

        // Remove after a short delay
        setTimeout(() => {
            highlight.style.opacity = '0';
            setTimeout(() => highlight.remove(), 200);
        }, 600);
    }

    private async clickElementRobust(element: HTMLElement): Promise<boolean> {
        try {
            if (!this.isElementInViewport(element)) {
                element.scrollIntoView({ block: 'center' });
                await this.waitUntilInViewport(element, 1500);
            }
            await this.wait(150); // allow scroll-event listeners to settle
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

    private isElementInViewport(element: HTMLElement): boolean {
        const rect = element.getBoundingClientRect();
        const vw = window.innerWidth || document.documentElement.clientWidth;
        const vh = window.innerHeight || document.documentElement.clientHeight;
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        return cx >= 0 && cx <= vw && cy >= 0 && cy <= vh;
    }

    private waitUntilInViewport(element: HTMLElement, timeoutMs: number): Promise<void> {
        return new Promise(resolve => {
            const startTime = Date.now();
            const poll = () => {
                if (this.isElementInViewport(element) || Date.now() - startTime >= timeoutMs) {
                    resolve();
                    return;
                }
                setTimeout(poll, 50);
            };
            poll();
        });
    }

    private async waitForNavigationOrLoad(
        oldUrl: string,
        timeout: number = 10000,
        containerSelectors?: string[],
        preClickHash?: string
    ): Promise<string> {
        return new Promise((resolve) => {
            const startTime = Date.now();
            const POLL_MS = 100;
            const STABILITY_MS = 500;
            const CONTENT_POLL_MS = 250;
            let stableStart: number | null = null;
            let resolved = false;
            let contentPollTimer: ReturnType<typeof setInterval> | null = null;

            const done = (result: string) => {
                if (resolved) return;
                resolved = true;
                if (contentPollTimer !== null) { clearInterval(contentPollTimer); contentPollTimer = null; }
                resolve(result);
            };

            // Content-hash polling — re-queries by selector each tick so it works even when
            // React/Vue/Angular replaces the container element entirely (detached-node problem).
            if (containerSelectors?.length && preClickHash !== undefined) {
                contentPollTimer = setInterval(() => {
                    if (resolved) return;
                    const currentContainer = this.findContainerRobust(containerSelectors);
                    if (!currentContainer) return;
                    const newHash = this.calculatePageHash(currentContainer);
                    if (newHash !== preClickHash) done('content_change');
                }, CONTENT_POLL_MS);
            }

            // URL-polling path — handles traditional navigation
            const check = () => {
                if (resolved) return;
                if (this.isAborted()) { done('cancelled'); return; }

                if (window.location.href !== oldUrl) {
                    if (stableStart === null) stableStart = Date.now();
                    if (Date.now() - stableStart >= STABILITY_MS) { done('url_change'); return; }
                } else {
                    stableStart = null;
                }

                if (Date.now() - startTime > timeout) {
                    // Final content check before declaring timeout
                    if (containerSelectors?.length && preClickHash !== undefined) {
                        const finalContainer = this.findContainerRobust(containerSelectors);
                        if (finalContainer) {
                            const finalHash = this.calculatePageHash(finalContainer);
                            if (finalHash !== preClickHash) { done('content_change'); return; }
                        }
                    }
                    done('timeout');
                    return;
                }
                setTimeout(check, POLL_MS);
            };
            check();
        });
    }

    /**
     * Calculates a robust hash of the current page content for loop detection.
     * Uses sampling (top, middle, bottom elements) to be performant.
     */
    private calculatePageHash(container: HTMLElement): string {
        try {
            const children = Array.from(container.children);
            const count = children.length;
            if (count === 0) return "empty-" + container.tagName;

            const sampleIndices = new Set<number>();

            // Sample first 5
            for (let i = 0; i < Math.min(count, 5); i++) sampleIndices.add(i);
            // Sample last 5
            for (let i = Math.max(0, count - 5); i < count; i++) sampleIndices.add(i);
            // Sample middle 5
            if (count > 10) {
                const mid = Math.floor(count / 2);
                for (let i = Math.max(0, mid - 2); i < Math.min(count, mid + 2); i++) sampleIndices.add(i);
            }

            let combinedData = "";
            sampleIndices.forEach(idx => {
                const child = children[idx] as HTMLElement;
                if (!child) return;

                // Composite key for an item's identity
                combinedData += `[idx:${idx}]`;
                combinedData += `txt:${child.textContent?.trim().substring(0, 50)}|`;

                const childCount = child.children.length;
                if (childCount > 0) combinedData += `ch:${childCount}|`;
            });

            // Add container state
            combinedData += `|st:${container.scrollTop},${container.scrollHeight}|`;

            return "v1-" + hashString(combinedData).toString();
        } catch (e) {
            console.error('[Pagination] Error calculating page hash:', e);
            return "error-" + Date.now();
        }
    }

    /** Saved before clicking "Next": the next page's content script continues the run from here. */
    private async saveState(state: { config: PaginationResume['config']; pageCount: number; totalItems: number }) {
        await storage.set('pagination_state', { ...state, visitedUrls: Array.from(this.visitedUrls), isRunning: true, timestamp: Date.now() });
    }

    private async clearState() {
        await storage.remove('pagination_state');
    }
}
