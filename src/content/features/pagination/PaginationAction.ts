import { SchemaGenerator } from '../../services/extraction/SchemaGenerator';
import { DataExtractor } from '../../services/extraction/DataExtractor';
import { NextButtonSelector } from '../../services/dom/selectors/NextButtonSelector';
import { SelectorMetadata } from '../../../shared/types/extraction';
import { BaseAction, ActionContext } from '../../core/BaseAction';
import { AutoScrollAction } from '../autoscroll/AutoScrollAction';

export interface PaginationConfig {
    startSelector: string;
    startSelectors?: string[];
    nextButtonSelector: string;
    nextButtonSelectors?: SelectorMetadata[];
    maxPages?: number;
    resumeState?: any;
    mode?: 'pagination' | 'loadMore' | 'auto';
    navigationDelay?: number;
    contentLoadDelay?: number;
    pageLoadDelay?: number;
    urlChangeTimeout?: number;
    scrollDelay?: number;
}

/**
 * PaginationAction handles multi-page navigation and data collection.
 * Roles: Navigation across pages.
 */
export class PaginationAction extends BaseAction {
    private extractor: DataExtractor;
    private schemaGenerator: SchemaGenerator;
    private visitedUrls: Set<string>;
    private lastPageHash: string | null = null;

    constructor(private config: PaginationConfig) {
        super();
        this.extractor = new DataExtractor();
        this.schemaGenerator = new SchemaGenerator();
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

                // [NEW] URL Loop Detection
                const currentUrl = window.location.href;
                if (this.visitedUrls.has(currentUrl)) {
                    console.log('🛑 [Pagination] URL already visited, breaking loop:', currentUrl);
                    this.context.onProgress?.({ type: 'complete', reason: 'url_loop_detected', message: "Pagination complete - returning to previously visited page detected" });
                    break;
                }
                this.visitedUrls.add(currentUrl);

                // Content Processing Phase
                this.context?.onProgress?.({ type: 'navigate', page: pageCount, message: `Processing page ${pageCount}` });

                let newContainer = await this.findContainerWithRetry(containerSelectors);

                if (!newContainer) {
                    console.log('🛑 [Pagination] Container lost after navigation confirmation');
                    this.context?.onProgress?.({ type: 'error', message: 'Container lost after navigation' });
                    break;
                }

                const { extractedCount, newTotal } = await this.processPageContent(newContainer!, pageCount, totalItems);
                totalItems = newTotal;

                if (extractedCount <= 0) {
                    consecutiveNoContentChanges++;
                    if (consecutiveNoContentChanges >= internalConfig.maxContentNoChange) {
                        this.context.onProgress?.({ type: 'complete', reason: 'no_new_content', message: "Pagination complete - no more new content found" });
                        break;
                    }
                } else {
                    consecutiveNoContentChanges = 0;
                }

                // [NEW] Page Integrity Check (Fingerprinting)
                const currentPageHash = this.calculatePageHash(newContainer);
                if (this.lastPageHash !== null && this.lastPageHash === currentPageHash) {
                    console.log('🛑 [Pagination] Page content identical to previous page, breaking loop');
                    this.context.onProgress?.({ type: 'complete', reason: 'content_unchanged', message: "Pagination complete - no content changes detected after navigation" });
                    break;
                }
                this.lastPageHash = currentPageHash;

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

    private getInternalConfig() {
        return {
            navigationDelay: this.config.navigationDelay || 1500,
            contentLoadDelay: this.config.contentLoadDelay || 2000,
            pageLoadDelay: this.config.pageLoadDelay || 1000,
            urlChangeTimeout: this.config.urlChangeTimeout || 10000,
            maxContentNoChange: 2,
            scrollDelay: this.config.scrollDelay || 400
        };
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
        const { startSelector, startSelectors } = this.config;
        return (startSelectors && startSelectors.length > 0) ? startSelectors : [startSelector];
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

        this.context?.onProgress?.({ type: 'extract', page: pageCount, message: 'Scrolling and extracting data...' });

        // Use 'indexed' strategy: the container is a static DOM element during pagination,
        // not an infinite feed. MutationAware would wait unnecessarily for new nodes.
        const autoScroll = new AutoScrollAction({
            rootElement: container,
            scrollDelay: this.config.scrollDelay || 400,
            selectionMode: 'container',
            scrollCallback: async (info: any) => {
                const { element, scrolledToIndex } = info;
                if (!element || processedInPage.has(scrolledToIndex)) return;

                const rowData = this.extractor.extractRow(element);
                if (rowData && Object.keys(rowData).length > 0) {
                    processedInPage.add(scrolledToIndex);

                    // Normalize Data using unified method
                    const schemaRes = this.schemaGenerator.generateSchema([rowData]);
                    const normalizedItem = this.extractor.normalizeRow(rowData, schemaRes.columns);

                    pageItems.push(normalizedItem);
                    this.highlightProcessedElement(element);

                    extractedCount++;
                    if (mode !== 'loadMore') {
                        newTotal++;
                    }

                    this.context?.onProgress?.({
                        type: 'data',
                        items: [normalizedItem],
                        page: pageCount,
                        cumulativeTotal: mode !== 'loadMore' ? newTotal : pageItems.length
                    });
                }
            }
        }, 'indexed');

        await autoScroll.execute(this.context!);

        if (mode === 'loadMore') {
            newTotal = pageItems.length;
        }

        return { extractedCount, newTotal };
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

    private async navigateToNextPage(pageCount: number, totalItems: number, internalConfig: any): Promise<{ status: 'success' | 'complete' | 'error' | 'timeout', message?: string }> {
        const { nextButtonSelector, nextButtonSelectors } = this.config;

        // Construct selectors list from metadata (preferred) or single selector
        let findSelectors: Array<{ value: string, type: 'selector' | 'xpath' }> = [];

        if (nextButtonSelectors && nextButtonSelectors.length > 0) {
            findSelectors = nextButtonSelectors.map(m => ({
                value: m.selector,
                type: (m.selector.startsWith('//') || m.selector.startsWith('(')) ? 'xpath' : 'selector'
            }));
        } else if (nextButtonSelector) {
            findSelectors = [{
                value: nextButtonSelector,
                type: (nextButtonSelector.startsWith('//') || nextButtonSelector.startsWith('(')) ? 'xpath' : 'selector'
            }];
        }

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

        this.context?.onProgress?.({ type: 'wait', message: `Waiting for navigation (${internalConfig.navigationDelay}ms)...` });
        await this.wait(internalConfig.navigationDelay);
        this.throwIfAborted();

        const navigationResult = await this.waitForNavigationOrLoad(urlBefore, internalConfig.urlChangeTimeout);

        if (navigationResult === 'timeout') {
            this.context?.onProgress?.({ type: 'wait', message: `Waiting for content load (${internalConfig.contentLoadDelay}ms)...` });
            await this.wait(internalConfig.contentLoadDelay);
            this.throwIfAborted();
            return { status: 'timeout' };
        } else {
            this.context?.onProgress?.({ type: 'wait', message: `Waiting for new page content (${internalConfig.contentLoadDelay}ms)...` });
            await this.wait(internalConfig.contentLoadDelay);
            this.throwIfAborted();
            return { status: 'success' };
        }
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

    private findContainerRobust(selectors: string[]): HTMLElement | null {
        for (const sel of selectors) {
            try {
                if (!sel) continue;

                // Detect XPath
                if (sel.startsWith('/') || sel.startsWith('(') || sel.startsWith('id(')) {
                    const result = document.evaluate(sel, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                    if (result.singleNodeValue) return result.singleNodeValue as HTMLElement;
                } else {
                    const container = document.querySelector(sel) as HTMLElement;
                    if (container) return container;
                }
            } catch (e) {
                console.warn(`[PaginationAction] Failed to query container with "${sel}":`, e);
            }
        }
        return null;
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
            border: 3px solid #0ea5e9 !important; /* Sky Blue */
            background-color: rgba(14, 165, 233, 0.15) !important;
            box-shadow: 0 0 12px rgba(14, 165, 233, 0.6) !important;
            z-index: 2147483647 !important;
            pointer-events: none !important;
            border-radius: 4px !important;
            transition: opacity 0.2s ease-out !important;
            box-shadow: 0 0 8px rgba(34, 197, 94, 0.4) !important;
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

    private async waitForNavigationOrLoad(oldUrl: string, timeout: number = 10000): Promise<string> {
        return new Promise((resolve) => {
            const startTime = Date.now();

            const check = () => {
                if (this.isAborted()) {
                    resolve('cancelled');
                    return;
                }

                if (window.location.href !== oldUrl) {
                    // [Refinement] Wait for URL stability
                    setTimeout(() => resolve('url_change'), 2000);
                    return;
                }

                if (Date.now() - startTime > timeout) {
                    resolve('timeout');
                    return;
                }

                setTimeout(check, 200);
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

                const rect = child.getBoundingClientRect();
                combinedData += `dim:${Math.round(rect.width)}x${Math.round(rect.height)}|`;

                // Check for links and images which are strong unique identifiers
                const links = child.querySelectorAll('a').length;
                const imgs = child.querySelectorAll('img').length;
                if (links > 0) combinedData += `lnk:${links}|`;
                if (imgs > 0) combinedData += `img:${imgs}|`;
            });

            // Add container state
            combinedData += `|st:${container.scrollTop},${container.scrollHeight}|`;

            let hash = 0;
            for (let i = 0; i < combinedData.length; i++) {
                hash = (hash << 5) - hash + combinedData.charCodeAt(i);
                hash |= 0;
            }
            return "v1-" + hash.toString();
        } catch (e) {
            console.error('[Pagination] Error calculating page hash:', e);
            return "error-" + Date.now();
        }
    }

    private async saveState(state: any) {
        console.log('💾 [PaginationAction] Saving state...', { page: state.pageCount, total: state.totalItems });
        const persistState = { ...state, visitedUrls: Array.from(this.visitedUrls), isRunning: true, timestamp: Date.now() };
        await chrome.storage.local.set({ 'pagination_state': persistState });
        console.log('✅ [PaginationAction] State saved.');
    }

    private async clearState() {
        await chrome.storage.local.remove('pagination_state');
    }
}
