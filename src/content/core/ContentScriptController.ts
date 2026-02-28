import { VisualElementPicker } from '../features/picker/VisualElementPicker';
import { AutoScrollAction } from '../features/autoscroll/AutoScrollAction';
import { PaginationAction } from '../features/pagination/PaginationAction';
import { MessageClient } from './bus/MessageClient';
import { ListSelectionStrategy } from '../features/picker/strategies/ListSelectionStrategy';
import { SingleSelectionStrategy } from '../features/picker/strategies/SingleSelectionStrategy';
import { SchemaGenerator } from '../services/extraction/SchemaGenerator';
import { DataExtractor } from '../services/extraction/DataExtractor';
import { PageExtractor } from '../services/page/PageExtractor';
import { DetailSelectionStrategy } from '../features/picker/strategies/DetailSelectionStrategy';
import { ImageScanner } from '../features/universal-images/ImageScanner';
import { RightClickUnlocker } from '../features/utility/RightClickUnlocker';

export class ContentScriptController {
    private picker: VisualElementPicker | null = null;
    private autoScroll: AutoScrollAction | null = null;
    private pagination: PaginationAction | null = null;
    private autoScrollAbortController: AbortController | null = null;
    private paginationAbortController: AbortController | null = null;

    private messageClient: MessageClient;
    private schemaGenerator = new SchemaGenerator();
    private extractor = new DataExtractor();
    private pageExtractor = new PageExtractor();

    constructor() {
        this.messageClient = MessageClient.getInstance();
        this.initializeListeners();
        this.checkAutoResume();
    }

    private initializeListeners() {
        this.messageClient.on('START_PICKER', (_msg, sendResponse) => {
            const { mode, action } = _msg.payload || { mode: 'list', action: 'extract' };
            this.startPicker(mode, action);
            sendResponse({ success: true });
        });

        this.messageClient.on('STOP_PICKER', (_, sendResponse) => {
            this.stopPicker();
            sendResponse({ success: true });
        });

        this.messageClient.on('EXECUTE_AUTO_SCROLL', async (msg, sendResponse) => {
            console.log('🚀 [Content Script] EXECUTE_AUTO_SCROLL Received');
            this.startAutoScroll(msg.payload);
            sendResponse({ success: true, status: 'started' });
        });

        this.messageClient.on('STOP_AUTO_SCROLL', (_, sendResponse) => {
            this.stopAutoScroll();
            this.stopPagination();
            sendResponse({ success: true });
        });

        this.messageClient.on('EXECUTE_PAGINATION', async (msg, sendResponse) => {
            console.log('📨 [ContentScript] Received EXECUTE_PAGINATION');
            this.startPagination(msg.payload);
            sendResponse({ success: true, status: 'started' });
        });

        this.messageClient.on('STOP_PAGINATION', (_, sendResponse) => {
            this.stopPagination();
            sendResponse({ success: true, status: 'stopped' });
        });




        this.messageClient.on('SCAN_IMAGES', (_, sendResponse) => {
            const images = ImageScanner.scan();
            sendResponse({ success: true, data: images });
        });

        this.messageClient.on('toggle_right_click', (msg, sendResponse) => {
            const { enable } = msg.payload;
            if (enable) RightClickUnlocker.enable();
            else RightClickUnlocker.disable();
            sendResponse({ success: true, enabled: RightClickUnlocker.isEnabled() });
        });

        this.messageClient.on('CMD_EXTRACT_PAGE', async (msg, sendResponse) => {
            console.log('📄 [Content Script] CMD_EXTRACT_PAGE Received', msg.payload);
            const { actionType, url, elements, config, tableDataId } = msg.payload;

            const result = await this.pageExtractor.execute(
                actionType,
                url,
                elements,
                config,
                tableDataId
            );

            sendResponse({ success: true, result });
        });

        this.messageClient.on('TEST_SELECTOR', (msg, sendResponse) => {
            const { selector } = msg.payload || {};
            if (selector) {
                this.testSelector(selector);
            }
            sendResponse({ success: true });
        });

        this.messageClient.on('PING', (_, sendResponse) => {
            sendResponse({ success: true, status: 'alive' });
        });
    }

    public startPicker(mode: 'list' | 'single' | 'detail' = 'list', action: 'extract' | 'click' = 'extract') {
        if (this.picker) this.picker.deactivate();

        this.picker = new VisualElementPicker();
        let strategy;

        switch (mode) {
            case 'single':
                strategy = new SingleSelectionStrategy();
                // [NEW] Assist user by scrolling to where a "Next" button usually lives
                try {
                    this.scrollToPotentialNextButton();
                } catch (e) {
                    console.warn('⚠️ Failed to auto-scroll to next button:', e);
                }
                break;
            case 'detail':
                strategy = new DetailSelectionStrategy();
                break;
            default:
                strategy = new ListSelectionStrategy();
                break;
        }

        if (strategy) {
            strategy.preferredAction = action;
        }

        this.picker.activate(strategy, () => {
            console.log('🚫 Picker cancelled');
            this.messageClient.send({ type: 'PICKER_CANCELLED' });
        });
    }

    public stopPicker() {
        if (this.picker) {
            this.picker.deactivate();
            this.picker = null;
        }
    }

    private async startAutoScroll(payload: any) {
        const { selector, selectorType, selectionMode, enableInfiniteScroll, loadMoreSelector, loadMoreSelectorType } = payload;
        this.stopAutoScroll();

        this.autoScrollAbortController = new AbortController();
        const signal = this.autoScrollAbortController.signal;

        const results: any[] = [];
        const processedHashes = new Set<string>();

        const scrollOptions = {
            selector,
            selectorType: selectorType || 'selector',
            selectionMode: selectionMode || 'container',
            enableInfiniteScroll,
            loadMoreSelector,
            loadMoreSelectorType,
            scrollDelay: 800, // Slower scrolling for better visualization
            contentLoadDelay: 2500,
            maxNoChanges: 5,
            scrollCallback: async (info: any) => {
                await this.processScrollItem(info, selector, selectorType, selectionMode, processedHashes, results);
            }
        };

        this.autoScroll = new AutoScrollAction(scrollOptions);

        try {
            await this.autoScroll.execute({
                signal,
                logger: console,
                state: new Map(),
                onProgress: (progress) => {
                    this.messageClient.send({ type: 'AUTO_SCROLL_STATUS', payload: progress });
                }
            });
            this.finishAutoScroll(results);
        } catch (e: any) {
            if (e.message === 'Action aborted') {
                console.log('AutoScroll aborted');
                return;
            }
            console.error('AutoScroll Failed', e);
            this.messageClient.send({ type: 'AUTO_SCROLL_COMPLETE', payload: { success: false, error: e.message } });
        }
    }

    private async processScrollItem(info: any, _selector: string, _selectorType: string, _selectionMode: string, processedHashes: Set<string>, results: any[]) {
        try {
            let element = info.element;

            if (element) {
                const rowData = this.extractor.extractRow(element);
                const contentHash = this.generateRowHash(rowData);

                if (processedHashes.has(contentHash)) return;

                if (rowData && Object.keys(rowData).length > 0) {
                    processedHashes.add(contentHash);
                    results.push(rowData);

                    const schemaRes = this.schemaGenerator.generateSchema([rowData]);
                    const normalizedItem = this.extractor.normalizeRow(rowData, schemaRes.columns);

                    this.messageClient.send({
                        type: 'AUTO_SCROLL_UPDATE',
                        payload: { count: results.length, latestItem: normalizedItem, columns: schemaRes.columns }
                    });

                    this.highlightProcessedElement(element);
                } else {
                    if (element.innerText && element.innerText.trim().length > 5) {
                        console.warn('[ContentScript] Failed to extract data from row/element', element);
                    }
                }
            }
        } catch (e) {
            console.error('[ContentScript] Error in processScrollItem:', e);
        }
    }

    private generateRowHash(data: any): string {
        const str = JSON.stringify(data);
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return hash.toString();
    }

    private highlightProcessedElement(element: HTMLElement) {
        // Use outline/box-shadow for robustness against scrolling (moves with element)
        const originalOutline = element.style.outline;
        const originalOffset = element.style.outlineOffset;
        const originalBoxShadow = element.style.boxShadow;
        const originalTransition = element.style.transition;

        // Apply Blue Highlight (Primary)
        element.style.outline = '2px solid #2563EB';
        element.style.outlineOffset = '-2px'; // Inset slightly to ensure visibility if container clipped
        element.style.boxShadow = '0 0 8px rgba(37, 99, 235, 0.4), inset 0 0 20px rgba(37, 99, 235, 0.1)';
        element.style.transition = 'all 0.2s ease-out';

        // Revert after delay
        setTimeout(() => {
            element.style.outline = originalOutline;
            element.style.outlineOffset = originalOffset;
            element.style.boxShadow = originalBoxShadow;
            element.style.transition = originalTransition;
        }, 600);
    }

    private finishAutoScroll(results: any[]) {
        const schemaResult = this.schemaGenerator.generateSchema(results);
        const normalizedResults = results.map(row => {
            return this.extractor.normalizeRow(row, schemaResult.columns);
        });

        this.messageClient.send({
            type: 'AUTO_SCROLL_COMPLETE',
            payload: { success: true, items: normalizedResults, columns: schemaResult.columns }
        });
    }

    private async startPagination(payload: any) {
        const { startSelector, startSelectors, nextButtonSelector, nextButtonSelectors, maxPages, resumeState, mode } = payload;
        this.stopPagination();

        this.paginationAbortController = new AbortController();
        const signal = this.paginationAbortController.signal;

        // Compatibility: nextButtonSelectors is now the metadata array. 
        // If it's a string array (legacy), we handle it.
        let effectiveMetadata = nextButtonSelectors;
        if (effectiveMetadata && effectiveMetadata.length > 0 && typeof effectiveMetadata[0] === 'string') {
            effectiveMetadata = (effectiveMetadata as unknown as string[]).map((s: string) => ({ selector: s, strategy: 'Legacy' }));
        }

        const config: any = { // Cast to any to avoid strict type checks against the class interface during migration if needed, but optimally matches
            startSelector,
            startSelectors,
            nextButtonSelector: nextButtonSelector || (effectiveMetadata && effectiveMetadata.length > 0 ? effectiveMetadata[0].selector : null),
            nextButtonSelectors: effectiveMetadata,
            maxPages,
            resumeState,
            mode
        };

        this.pagination = new PaginationAction(config);

        await this.pagination.execute({
            signal,
            logger: console,
            state: new Map(),
            onProgress: (progress) => this.handlePaginationProgress(progress)
        });
    }

    private handlePaginationProgress(progress: any) {
        if (progress.type === 'data') {
            this.messageClient.send({ type: 'PAGINATION_UPDATE', payload: { items: progress.items, page: progress.page, total: progress.cumulativeTotal } });
        } else if (progress.type === 'complete') {
            this.messageClient.send({ type: 'PAGINATION_COMPLETE', payload: { success: true, reason: progress.reason } });
            this.pagination = null;
        } else if (progress.type === 'error') {
            this.messageClient.send({ type: 'PAGINATION_COMPLETE', payload: { success: false, error: progress.message } });
            this.pagination = null;
        } else {
            this.messageClient.send({ type: 'PAGINATION_STATUS', payload: progress });
        }
    }


    public stopAutoScroll() {
        if (this.autoScrollAbortController) {
            this.autoScrollAbortController.abort();
            this.autoScrollAbortController = null;
        }
        this.autoScroll = null;
    }

    public stopPagination() {
        if (this.paginationAbortController) {
            this.paginationAbortController.abort();
            this.paginationAbortController = null;
        }
        this.pagination = null;
    }


    private scrollToPotentialNextButton() {
        console.log('🎯 [Content Script] Attempting to auto-locate potential next button...');

        // Heuristics for common "Next" button text/attributes
        const indicators = [
            'next', 'load more', 'show more', 'older', '>', '→', '»', 'page 2',
            'continue', 'further', 'more results'
        ];

        // 1. Search for buttons/links containing these indicators
        const candidates = Array.from(document.querySelectorAll('a, button, [role="button"], span, div'))
            .filter(el => {
                const text = el.textContent?.toLowerCase().trim();
                const title = el.getAttribute('title')?.toLowerCase() || '';
                const ariaLabel = el.getAttribute('aria-label')?.toLowerCase() || '';

                // Must be visible and small enough to be a button (avoids container matches)
                const rect = el.getBoundingClientRect();
                const isVisible = rect.width > 0 && rect.height > 0 &&
                    window.getComputedStyle(el).display !== 'none' &&
                    window.getComputedStyle(el).visibility !== 'hidden';

                if (!isVisible || rect.width > 500 || rect.height > 200) return false;

                return indicators.some(ind =>
                    text === ind ||
                    (text?.includes(ind) && text.length < 20) ||
                    title.includes(ind) ||
                    ariaLabel.includes(ind)
                );
            });

        // 2. Prioritize candidates that are lower on the page (common for pagination)
        candidates.sort((a, b) => {
            const rectA = a.getBoundingClientRect();
            const rectB = b.getBoundingClientRect();
            // Higher Y coordinate = lower on page
            return (rectB.top + window.scrollY) - (rectA.top + window.scrollY);
        });

        if (candidates.length > 0) {
            const bestMatch = candidates[0];
            console.log('✨ [Content Script] Found potential next button, scrolling...', bestMatch);
            bestMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });

            // Add a subtle temporary "hint" animation
            const originalColor = (bestMatch as HTMLElement).style.outline;
            (bestMatch as HTMLElement).style.outline = '3px solid rgba(37, 99, 235, 0.5)';
            (bestMatch as HTMLElement).style.outlineOffset = '2px';
            setTimeout(() => {
                (bestMatch as HTMLElement).style.outline = originalColor;
            }, 2000);
        } else {
            // 3. Fallback: Scroll to bottom of the page if no match found
            console.log('🤷 [Content Script] No next button detected, scrolling to bottom fallback.');
            window.scrollTo({
                top: document.body.scrollHeight,
                behavior: 'smooth'
            });
        }
    }

    private testSelector(selector: string) {
        console.log(`🔍 [Content Script] Testing selector: ${selector}`);

        // Remove existing highlights
        const existing = document.querySelectorAll('.crawlpilot-test-highlight');
        existing.forEach(el => el.remove());

        try {
            let elements: Element[] = [];
            const trimmedSelector = selector.trim();
            // Detect if XPath
            const isXPath = trimmedSelector.startsWith('/') ||
                trimmedSelector.startsWith('(') ||
                trimmedSelector.startsWith('./') ||
                trimmedSelector.startsWith('id(');

            if (isXPath) {
                const result = document.evaluate(trimmedSelector, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                for (let i = 0; i < result.snapshotLength; i++) {
                    const node = result.snapshotItem(i);
                    if (node instanceof Element) {
                        elements.push(node);
                    }
                }
            } else {
                elements = Array.from(document.querySelectorAll(trimmedSelector));
            }

            console.log(`✨ [Content Script] Found ${elements.length} matches for ${trimmedSelector} (${isXPath ? 'XPath' : 'CSS'})`);

            if (elements.length === 0) return;

            // Scroll first element into view
            elements[0].scrollIntoView({ behavior: 'smooth', block: 'center' });

            elements.forEach((el, index) => {
                const rect = el.getBoundingClientRect();

                const highlight = document.createElement('div');
                highlight.className = 'crawlpilot-test-highlight';
                highlight.style.cssText = `
                    position: fixed !important;
                    top: ${rect.top}px !important;
                    left: ${rect.left}px !important;
                    width: ${rect.width}px !important;
                    height: ${rect.height}px !important;
                    border: 3px solid #2563EB !important; /* Primary Blue */
                    background-color: rgba(37, 99, 235, 0.15) !important;
                    z-index: 2147483647 !important;
                    pointer-events: none !important;
                    box-shadow: 0 0 15px rgba(37, 99, 235, 0.6) !important;
                    border-radius: 4px !important;
                    transition: opacity 0.3s ease !important;
                `;

                // Add label for matches
                if (index < 20) { // Show up to 20 labels for clarity
                    const label = document.createElement('div');
                    label.textContent = `Match ${index + 1}`;
                    label.style.cssText = `
                        position: absolute !important;
                        top: -24px !important;
                        left: 0 !important;
                        background: #2563EB !important;
                        color: white !important;
                        font-size: 11px !important;
                        font-family: sans-serif !important;
                        font-weight: bold !important;
                        padding: 3px 8px !important;
                        border-radius: 4px !important;
                        white-space: nowrap !important;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.2) !important;
                    `;
                    highlight.appendChild(label);
                }

                document.body.appendChild(highlight);

                // Extended duration for better verification
                setTimeout(() => {
                    highlight.style.opacity = '0';
                    setTimeout(() => highlight.remove(), 300);
                }, 8000);
            });
        } catch (e) {
            console.error('Test selector failed', e);
        }
    }

    private checkAutoResume() {
        if ((window as any).__ELEMENT_PICKER_LOADED__) {
            console.log('⚠️ Content script already loaded');
            return;
        }
        (window as any).__ELEMENT_PICKER_LOADED__ = true;

        // Auto-resume logic
        chrome.storage.local.get(['pagination_state'], (result: any) => {
            console.log('📦 [ContentScript] Checking for resume state:', result);
            const state = result.pagination_state;
            if (state && state.isRunning) {
                console.log('🔄 [ContentScript] Valid resume state found. Config:', state.config);

                // Construct payload from saved state
                // Saved state structure from PaginationAction: { config, pageCount, totalItems, ... }
                const config = state.config;

                const payload = {
                    ...config,
                    resumeState: {
                        pageCount: state.pageCount,
                        totalItems: state.totalItems,
                        visitedUrls: state.visitedUrls
                    }
                };

                console.log('🚀 [ContentScript] Triggering startPagination with resume payload:', payload);
                this.startPagination(payload);
            } else {
                console.log('❌ [ContentScript] No valid running state found (isRunning: ' + (state?.isRunning) + ')');
            }
        });

        // Legacy/Other resume logic
        chrome.storage.local.get(['active_extraction'], (result: any) => {
            if (result.active_extraction && result.active_extraction.status === 'active') {
                console.log('🔄 Resuming extraction (legacy)...');
                this.messageClient.send({ type: 'RESUME_EXTRACTION_REQUEST' });
            }
        });
    }
}
