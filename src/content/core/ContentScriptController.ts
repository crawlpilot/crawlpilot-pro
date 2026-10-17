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
import { ProgressiveImageScanner } from '../features/universal-images/ProgressiveImageScanner';
import { RightClickUnlocker } from '../features/utility/RightClickUnlocker';
import { SelectionHighlightManager } from '../services/page/SelectionHighlightManager';
import { extractMetadata } from '../services/metadata/MetadataExtractionService';
import { HL_COLOR, HL_BG, HL_GLOW, HL_GLOW_STRONG, DUR_VALIDATE, DUR_FADE } from '../utils/highlight-tokens';
import { resolveFirst, resolveAll } from '../../shared/selectors/resolve';
import { hashString } from '../../shared/utils/hash';
import { runRecon } from '../services/recon/ReconService';
import { LabPicker, evaluateSelector, highlightSelector, clearLabHighlights } from '../features/lab/SelectorLab';

export class ContentScriptController {
    private picker: VisualElementPicker | null = null;
    private autoScroll: AutoScrollAction | null = null;
    private pagination: PaginationAction | null = null;
    private autoScrollAbortController: AbortController | null = null;
    private paginationAbortController: AbortController | null = null;
    private progressiveScanner: ProgressiveImageScanner | null = null;

    private labPicker = new LabPicker();

    private messageClient: MessageClient;
    private schemaGenerator = new SchemaGenerator();
    private extractor = new DataExtractor();
    private pageExtractor = new PageExtractor();
    private selectionHighlightManager = new SelectionHighlightManager();

    // Throttle state for scroll updates (Step 2.2)
    private scrollUpdateBuffer: any[] = [];
    private scrollUpdateTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly SCROLL_UPDATE_INTERVAL = 500;
    private readonly SCROLL_UPDATE_BATCH_SIZE = 10;

    constructor() {
        this.messageClient = MessageClient.getInstance();
        this.initializeListeners();
        this.checkAutoResume();
        this.initializeBridge();
        ContentScriptController.injectHighlightStyle();
    }

    private initializeBridge() {
        if ((window as any).__CRAWLPILOT_BRIDGE_INITIALIZED__) return;
        (window as any).__CRAWLPILOT_BRIDGE_INITIALIZED__ = true;

        console.log('🌉 [CrawlPilot] Auth Bridge initialized');

        window.addEventListener('message', (event) => {
            // Log all incoming postMessages for debugging (filtered for our source)
            const data = event.data;
            if (data && data.source === 'crawlpilot-auth') {
                console.log('📨 [CrawlPilot] Bridge received auth signal:', data.type);

                if (data.type === 'AUTH_SUCCESS' && data.token) {
                    console.log('🛡️ [CrawlPilot] Forwarding token to background script...');
                    // Forward to background script
                    chrome.runtime.sendMessage({
                        type: 'AUTH_SUCCESS',
                        token: data.token,
                        profile: data.profile
                    }, (response) => {
                        console.log('✅ [CrawlPilot] Auth bridge sync complete. Response:', response);
                    });
                }
            }
        });
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

        this.messageClient.on('PICKER_ACTION', (msg, sendResponse) => {
            if (this.picker) {
                this.picker.handleExternalAction(msg.payload.action);
            }
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

        this.messageClient.on('SCAN_IMAGES_DEEP', async (msg, sendResponse) => {
            const options = msg.payload || {};
            this.progressiveScanner = new ProgressiveImageScanner();

            try {
                const images = await this.progressiveScanner.scan(
                    (progress) => {
                        // Stream progress back to side panel
                        chrome.runtime.sendMessage({
                            type: 'SCAN_IMAGES_PROGRESS',
                            payload: progress
                        }).catch(() => { /* side panel may not be listening yet */ });
                    },
                    {
                        scrollStep: options.scrollStep || 800,
                        scrollDelay: options.scrollDelay || 100,
                        maxScrollHeight: options.maxScrollHeight || 50000,
                        watchDuration: options.watchDuration ?? 3000
                    },
                    (newImages) => {
                        // Stream image batches as they're discovered
                        chrome.runtime.sendMessage({
                            type: 'SCAN_IMAGES_BATCH',
                            payload: newImages
                        }).catch(() => {});
                    }
                );
                sendResponse({ success: true, data: images });
            } catch (error: any) {
                console.error('Deep scan failed:', error);
                sendResponse({ success: false, error: error.message });
            } finally {
                this.progressiveScanner = null;
            }
        });

        this.messageClient.on('SCAN_IMAGES_DEEP_CANCEL', (_, sendResponse) => {
            if (this.progressiveScanner) {
                this.progressiveScanner.cancel();
                this.progressiveScanner = null;
            }
            sendResponse({ success: true });
        });

        this.messageClient.on('SCAN_IMAGES_LIVE_START', (_, sendResponse) => {
            this.progressiveScanner = new ProgressiveImageScanner();
            this.progressiveScanner.startLiveWatch((newImages) => {
                chrome.runtime.sendMessage({
                    type: 'SCAN_IMAGES_BATCH',
                    payload: newImages
                }).catch(() => {});
            });
            sendResponse({ success: true });
        });

        this.messageClient.on('SCAN_IMAGES_LIVE_STOP', (_, sendResponse) => {
            if (this.progressiveScanner) {
                this.progressiveScanner.stopLiveWatch();
                this.progressiveScanner = null;
            }
            sendResponse({ success: true });
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

        this.messageClient.on('CMD_EXTRACT_PAGE_BACKGROUND', async (msg, sendResponse) => {
            console.log('📄 [Content Script] CMD_EXTRACT_PAGE_BACKGROUND Received (no-scroll mode)');
            const { url, elements, config } = msg.payload;

            // Use BackgroundElementProcessor (no scroll, no highlights)
            const { BackgroundElementProcessor } = await import('../services/page/processors/BackgroundElementProcessor');
            const processor = new BackgroundElementProcessor(config || {});

            // Aggregator mirrors PageExtractionStrategy logic:
            // - table type → row explosion (multiple rows)
            // - list type → numbered column flattening (single row)
            // - simple → scalar merge (single row)
            const allColumns: any[] = [];
            const elementData: Record<string, any> = {};

            for (const element of (elements || [])) {
                const result = await processor.processElement(element);

                if (result.columns) {
                    result.columns.forEach((col: any) => {
                        if (!allColumns.find((c: any) => c.id === col.id)) {
                            allColumns.push(col);
                        }
                    });
                }

                if (result.success && result.data) {
                    if (result.data.items && Array.isArray(result.data.items)) {
                        // List or Table with multiple items
                        const dataType = result.data.type || element.type || 'list';
                        elementData[element.id] = {
                            __type: dataType === 'table' ? 'table' : 'list',
                            items: result.data.items,
                            columns: result.columns || result.data.columns || []
                        };
                    } else {
                        // Simple scalar or JSON-consolidated table
                        elementData[element.id] = result.data[element.id] ?? result.data.value ?? null;
                        const rawKey = element.id + '__tabledata';
                        if (result.data[rawKey] !== undefined) elementData[rawKey] = result.data[rawKey];
                    }
                } else {
                    elementData[element.id] = null;
                }
            }

            // Always produce a single row: scalars, JSON-consolidated tables, flattened lists
            const recordId = `rec_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
            const recordIdCol = { id: 'recordId', originalId: 'recordId', name: 'RECORD ID', type: 'text' };

            const singleRow: any = { recordId };
            const singleColumns: any[] = [];

            Object.entries(elementData).forEach(([key, value]) => {
                if (value && typeof value === 'object' && (value as any).__type === 'list') {
                    const listCols = (value as any).columns || [];
                    ((value as any).items || []).forEach((item: any, idx: number) => {
                        listCols.forEach((col: any) => {
                            const numberedId = `${col.id}_${idx + 1}`;
                            const numberedName = `${col.name} ${idx + 1}`;
                            singleRow[numberedId] = item[col.id] ?? null;
                            singleColumns.push({ id: numberedId, originalId: col.id, name: numberedName, type: col.type || 'text' });
                        });
                    });
                } else {
                    singleRow[key] = value;
                    const col = allColumns.find((c: any) => c.id === key);
                    if (col) singleColumns.push(col);
                }
            });

            const finalColumns = [recordIdCol, ...singleColumns];

            sendResponse({
                success: true,
                result: { item: singleRow, columns: finalColumns, url }
            });
        });

        // --- Scraper toolkit: Page Recon and Selector Lab ---
        this.messageClient.on('CMD_RECON', async (_msg, sendResponse) => {
            const report = await runRecon();
            sendResponse({ success: true, report });
        });

        this.messageClient.on('LAB_EVAL', (msg, sendResponse) => {
            const { selector, expected, highlight } = msg.payload || {};
            if (!selector) { sendResponse({ success: false, error: 'No selector' }); return; }
            const result = evaluateSelector(selector, expected);
            if (highlight !== false && !result.error) highlightSelector(selector);
            sendResponse({ success: true, result });
        });

        this.messageClient.on('LAB_CLEAR', (_msg, sendResponse) => {
            clearLabHighlights();
            this.labPicker.stop();
            sendResponse({ success: true });
        });

        this.messageClient.on('LAB_PICK_START', (_msg, sendResponse) => {
            clearLabHighlights();
            this.labPicker.start((pick) => {
                this.messageClient.send({ type: 'LAB_PICKED', payload: pick });
            });
            sendResponse({ success: true });
        });

        this.messageClient.on('TEST_SELECTOR', (msg, sendResponse) => {
            const { selector } = msg.payload || {};
            if (selector) {
                this.testSelector(selector);
            }
            sendResponse({ success: true });
        });

        this.messageClient.on('SHOW_SELECTION_HIGHLIGHTS', (msg, sendResponse) => {
            const { elements } = msg.payload || {};
            if (elements && Array.isArray(elements)) {
                this.selectionHighlightManager.showHighlights(elements);
            }
            sendResponse({ success: true });
        });

        this.messageClient.on('CLEAR_SELECTION_HIGHLIGHTS', (_, sendResponse) => {
            this.selectionHighlightManager.clearHighlights();
            sendResponse({ success: true });
        });

        this.messageClient.on('ADD_SELECTION_HIGHLIGHT', (msg, sendResponse) => {
            const { element } = msg.payload || {};
            if (element) {
                this.selectionHighlightManager.addHighlight(element);
            }
            sendResponse({ success: true });
        });

        this.messageClient.on('CMD_EXTRACT_METADATA', async (msg, sendResponse) => {
            console.log('🔍 [Content Script] CMD_EXTRACT_METADATA Received');
            const options = msg.payload?.options || {};
            try {
                await this.waitForDomStability();       // wait for React/SPA hydration + API data
                await this.scrollToRevealLazyContent(); // trigger IntersectionObserver lazy loaders
                const result = extractMetadata(options);
                sendResponse({ success: true, result });
            } catch (err: any) {
                sendResponse({ success: false, error: err?.message || 'Metadata extraction failed' });
            }
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
        const { selector, selectors, selectorType, selectionMode, containerSelector, containerSelectors, enableInfiniteScroll, loadMoreSelector, loadMoreSelectorType, scrollDelay, contentLoadDelay } = payload;
        this.stopAutoScroll();

        this.autoScrollAbortController = new AbortController();
        const signal = this.autoScrollAbortController.signal;

        const results: any[] = [];
        const processedHashes = new Set<string>();

        // [NEW] Resolve the container via its fallback chain (falls back to the single
        // containerSelector string when no chain is provided — old callers keep working).
        const containerChain = (containerSelectors && containerSelectors.length > 0)
            ? containerSelectors
            : (containerSelector ? [containerSelector] : []);
        const rootElement = containerChain.length > 0
            ? (resolveFirst(containerChain, document).element as HTMLElement | null) ?? undefined
            : undefined;

        // [NEW] When in 'items' mode, resolve the best matching entry from the item
        // selector chain (scoped to the resolved container) instead of committing
        // blindly to the first-picked selector string.
        let effectiveSelector = selector;
        if (selectionMode === 'items') {
            const itemChain = (selectors && selectors.length > 0) ? selectors : (selector ? [selector] : []);
            if (itemChain.length > 0) {
                const { used } = resolveAll(itemChain, rootElement || document);
                if (used && used.kind === 'css') {
                    effectiveSelector = used.value;
                }
            }
        }

        const scrollOptions = {
            selector: effectiveSelector,
            selectorType: selectorType || 'selector',
            selectionMode: selectionMode || 'container',
            rootElement,
            enableInfiniteScroll,
            loadMoreSelector,
            loadMoreSelectorType,
            scrollDelay: scrollDelay || 800,
            contentLoadDelay: contentLoadDelay || 2500,
            maxNoChanges: 5,
            scrollCallback: async (info: any) => {
                await this.processScrollItem(info, effectiveSelector, selectorType, selectionMode, processedHashes, results);
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
            const element = info.element;

            if (element) {
                const rowData = this.extractor.extractRow(element);
                const contentHash = this.generateRowHash(rowData);

                if (processedHashes.has(contentHash)) return;

                if (rowData && Object.keys(rowData).length > 0) {
                    processedHashes.add(contentHash);
                    results.push(rowData);

                    // Buffer updates instead of sending per-item (Step 1.1 + 2.2)
                    this.scrollUpdateBuffer.push(rowData);
                    this.flushScrollUpdatesIfNeeded(results.length);

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

    private flushScrollUpdatesIfNeeded(totalCount: number) {
        // Flush when batch size reached
        if (this.scrollUpdateBuffer.length >= this.SCROLL_UPDATE_BATCH_SIZE) {
            this.flushScrollUpdates(totalCount);
            return;
        }
        // Otherwise set a timer to flush after interval
        if (!this.scrollUpdateTimer) {
            this.scrollUpdateTimer = setTimeout(() => {
                this.flushScrollUpdates(totalCount);
            }, this.SCROLL_UPDATE_INTERVAL);
        }
    }

    private flushScrollUpdates(totalCount: number) {
        if (this.scrollUpdateTimer) {
            clearTimeout(this.scrollUpdateTimer);
            this.scrollUpdateTimer = null;
        }
        if (this.scrollUpdateBuffer.length === 0) return;

        // Send lightweight count update — no per-item schema generation
        this.messageClient.send({
            type: 'AUTO_SCROLL_UPDATE',
            payload: { count: totalCount }
        });
        this.scrollUpdateBuffer = [];
    }

    private generateRowHash(data: any): string {
        return hashString(JSON.stringify(data)).toString();
    }

    private highlightProcessedElement(element: HTMLElement) {
        // Use a CSS class + single removal timer instead of per-element style manipulation
        element.classList.add('crawlpilot-highlight');
        // Batch removal: debounce class add/remove via a shared timeout
        setTimeout(() => element.classList.remove('crawlpilot-highlight'), 600);
    }

    // Inject highlight styles once (CSS-based, no per-element style writes)
    private static highlightStyleInjected = false;
    private static injectHighlightStyle() {
        if (ContentScriptController.highlightStyleInjected) return;
        ContentScriptController.highlightStyleInjected = true;
        const style = document.createElement('style');
        style.textContent = `
            .crawlpilot-highlight {
                outline: 2px solid ${HL_COLOR} !important;
                outline-offset: -2px !important;
                box-shadow: 0 0 8px ${HL_GLOW}, inset 0 0 16px rgba(34, 211, 238, 0.08) !important;
                transition: all 0.2s ease-out !important;
            }
        `;
        document.head.appendChild(style);
    }

    private finishAutoScroll(results: any[]) {
        // Flush any remaining buffered updates
        this.flushScrollUpdates(results.length);

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
        const { startSelector, startSelectors, nextButtonSelector, nextButtonSelectors, itemSelector, itemSelectors, maxPages, resumeState, mode } = payload;
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
            // [NEW] Plumb the picker's derived item-selector chain through to PaginationAction
            // so each page's rows are found via the chain instead of always walking
            // container.children (previously silently dropped here).
            itemSelector,
            itemSelectors,
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
        if (this.scrollUpdateTimer) {
            clearTimeout(this.scrollUpdateTimer);
            this.scrollUpdateTimer = null;
        }
        this.scrollUpdateBuffer = [];
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


    private waitForDomStability(stableMs = 1500, timeoutMs = 12000): Promise<void> {
        return new Promise(resolve => {
            let stableTimer: ReturnType<typeof setTimeout>;

            const finish = () => {
                observer.disconnect();
                clearTimeout(deadline);
                resolve();
            };

            const deadline = setTimeout(finish, timeoutMs);

            const reset = () => {
                clearTimeout(stableTimer);
                stableTimer = setTimeout(finish, stableMs);
            };

            const observer = new MutationObserver(reset);
            observer.observe(document.body, { childList: true, subtree: true });
            reset(); // start the idle timer immediately
        });
    }

    private async scrollToRevealLazyContent(): Promise<void> {
        const viewportHeight = window.innerHeight || 800;
        const STEP_DELAY_MS = 600;  // clamped to ~1000ms in inactive background tabs
        const SETTLE_DELAY_MS = 800;
        const MAX_STEPS = 12;       // caps at ~12 viewport heights to avoid infinite-scroll pages

        for (let step = 1; step <= MAX_STEPS; step++) {
            const y = step * viewportHeight;
            const totalHeight = Math.max(
                document.body.scrollHeight,
                document.documentElement.scrollHeight
            );
            if (y >= totalHeight) break;

            window.scrollTo({ top: y, behavior: 'instant' });
            window.dispatchEvent(new Event('scroll'));
            await new Promise(r => setTimeout(r, STEP_DELAY_MS));
        }

        // Return to top so the content scoring algorithm operates on the full page
        window.scrollTo({ top: 0, behavior: 'instant' });
        await new Promise(r => setTimeout(r, SETTLE_DELAY_MS));
    }

    private scrollToPotentialNextButton() {
        console.log('🎯 [Content Script] Attempting to auto-locate potential next button...');

        const indicators = [
            'next', 'load more', 'show more', 'older', '>', '→', '»',
            'continue', 'further', 'more results', 'next page', 'forward'
        ];

        // Score a candidate by semantic signals — higher = more likely to be the Next button
        const scoreCandidate = (el: Element): number => {
            const e = el as HTMLElement;
            const tag = e.tagName.toLowerCase();
            const text = e.textContent?.trim().toLowerCase() || '';
            const cls = e.className?.toLowerCase() || '';
            const ariaLabel = e.getAttribute('aria-label')?.toLowerCase() || '';
            let s = 0;

            if (tag === 'button') s += 5;
            else if (tag === 'a') s += 4;
            else if (e.getAttribute('role') === 'button') s += 3;

            if (text === 'next' || text === 'next >' || text === 'next page') s += 6;
            else if (text.startsWith('next')) s += 4;
            else if (text.includes('next')) s += 3;
            else if (text.includes('load more') || text.includes('show more')) s += 3;

            if (cls.includes('next') || cls.includes('pagination')) s += 2;
            if (ariaLabel.includes('next')) s += 2;
            if (e.onclick !== null || e.getAttribute('onclick')) s += 1;

            // Mild preference for elements in the lower half of the page
            const absY = e.getBoundingClientRect().top + window.scrollY;
            if (absY > document.body.scrollHeight * 0.5) s += 1;

            return s;
        };

        const candidates = Array.from(document.querySelectorAll('a, button, [role="button"], span, div'))
            .filter(el => {
                const text = el.textContent?.toLowerCase().trim() || '';
                const title = el.getAttribute('title')?.toLowerCase() || '';
                const ariaLabel = el.getAttribute('aria-label')?.toLowerCase() || '';
                const rect = (el as HTMLElement).getBoundingClientRect();
                const style = window.getComputedStyle(el as HTMLElement);

                const isVisible = rect.width > 0 && rect.height > 0 &&
                    style.display !== 'none' && style.visibility !== 'hidden';
                if (!isVisible || rect.width > 500 || rect.height > 200) return false;

                return indicators.some(ind =>
                    text === ind ||
                    (text.includes(ind) && text.length < 30) ||
                    title.includes(ind) ||
                    ariaLabel.includes(ind)
                );
            })
            .sort((a, b) => scoreCandidate(b) - scoreCandidate(a));

        if (candidates.length > 0) {
            const bestMatch = candidates[0] as HTMLElement;
            console.log('✨ [Content Script] Found potential next button, scrolling to center...', bestMatch);
            bestMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });

            const originalOutline = bestMatch.style.outline;
            const originalOffset = bestMatch.style.outlineOffset;
            bestMatch.style.outline = `2px solid ${HL_GLOW}`;
            bestMatch.style.outlineOffset = '2px';
            setTimeout(() => {
                bestMatch.style.outline = originalOutline;
                bestMatch.style.outlineOffset = originalOffset;
            }, 2000);
        } else {
            // Fallback: scroll to ~70% of page height where pagination typically lives
            console.log('🤷 [Content Script] No next button detected, scrolling to pagination zone.');
            window.scrollTo({
                top: document.body.scrollHeight * 0.7,
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

            // Scroll first element into view instantly
            elements[0].scrollIntoView({ behavior: 'auto', block: 'center' });

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
                    border: 2px solid ${HL_COLOR} !important;
                    background-color: ${HL_BG} !important;
                    z-index: 2147483647 !important;
                    pointer-events: none !important;
                    box-shadow: 0 0 12px ${HL_GLOW_STRONG} !important;
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
                        background: ${HL_COLOR} !important;
                        color: #000 !important;
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

                setTimeout(() => {
                    highlight.style.opacity = '0';
                    setTimeout(() => highlight.remove(), DUR_FADE);
                }, DUR_VALIDATE);
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
                // Stale or malformed state — purge it so it doesn't litter storage
                if (state) chrome.storage.local.remove('pagination_state');
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
