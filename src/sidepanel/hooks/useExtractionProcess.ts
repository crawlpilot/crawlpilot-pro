import { useState, useRef, useCallback } from 'react';
import { db } from '../../shared/db/db-manager';
import { SelectorState, PaginationConfig, ExtractionStatus, SelectorMetadata } from '../../shared/types/extraction';
import { PAGINATION_PROFILES, PaginationSpeed } from '../../shared/constants/paginationConfig';
import { consolidateSelectors } from '../../shared/utils/extractionLogic';

export function useExtractionProcess(onComplete?: (tableId: number) => void, onStart?: (jobId: number) => void) {
    const [status, setStatus] = useState<ExtractionStatus>({
        isExtracting: false,
        status: 'idle', // [NEW] Set default status
        progress: null,
        totalProcessed: 0,
        error: null
    });

    const stopExtractionRef = useRef(false);
    const activeModeRef = useRef<'auto' | 'pagination' | 'loadMore' | null>(null);
    const pagesVisitedRef = useRef(1);
    const extractionTabIdRef = useRef<number | null>(null); // [NEW] Track the extraction tab ID

    const stopExtraction = useCallback((force: boolean = false) => {
        stopExtractionRef.current = true;

        // If forced or if previous attempt failed, immediately unlock UI
        if (force) {
            setStatus(prev => ({
                ...prev,
                isExtracting: false,
                status: 'stopped',
                error: 'Extraction stopped by user.'
            }));
            return;
        }

        const targetTabId = extractionTabIdRef.current;

        if (targetTabId) {
            const message = activeModeRef.current === 'pagination'
                ? { type: 'STOP_PAGINATION' }
                : { type: 'STOP_AUTO_SCROLL' };

            chrome.tabs.sendMessage(targetTabId, message, () => {
                const lastError = chrome.runtime.lastError;
                if (lastError) {
                    console.warn("[Stop] Target tab unreachable:", lastError);
                    // Force stop anyway
                    setStatus(prev => ({
                        ...prev,
                        isExtracting: false,
                        status: 'stopped',
                        error: 'Extraction stopped (connection lost to page).'
                    }));
                }
            });
        } else {
            // Fallback for safety (should not ideally happen)
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0]?.id) {
                    const message = activeModeRef.current === 'pagination'
                        ? { type: 'STOP_PAGINATION' }
                        : { type: 'STOP_AUTO_SCROLL' };
                    chrome.tabs.sendMessage(tabs[0].id, message);
                }
                setStatus(prev => ({
                    ...prev,
                    isExtracting: false,
                    status: 'stopped'
                }));
            });
        }
    }, []);

    const startExtraction = useCallback(async (selectors: SelectorState[], pagination: PaginationConfig, options?: { tableDataId?: number; recipeId?: number; customName?: string; maxPages?: number }) => {
        if (selectors.length === 0) return;

        const { tableDataId, customName, maxPages } = options || {};
        if (maxPages !== undefined) {
            pagination.maxPages = maxPages;
        }

        setStatus({
            isExtracting: true,
            status: 'running',
            progress: null,
            totalProcessed: 0,
            error: null
        });
        stopExtractionRef.current = false;
        activeModeRef.current = pagination.mode;
        pagesVisitedRef.current = 1;

        try {
            // [NEW] 0. Validate Source Context
            const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });

            // Check if we need to switch tabs
            // Use the first selector's sourceTabId as reference
            const referenceTabId = selectors[0]?.sourceTabId;
            let activeTabId = currentTab?.id;

            // Resolve the actual source tab — this is the page the user set up in preview.
            // We need its title, not the title of whatever tab happens to be active right now.
            let sourceTab = currentTab;
            if (referenceTabId) {
                try {
                    sourceTab = await chrome.tabs.get(referenceTabId) || currentTab;
                } catch {
                    // Source tab closed — sourceTab stays as currentTab
                }
            }

            if (referenceTabId && activeTabId && referenceTabId !== activeTabId) {
                console.log(`[Context] Tab mismatch. Current: ${activeTabId}, Source: ${referenceTabId}. Switch requested.`);

                try {
                    if (sourceTab) {
                        await chrome.tabs.update(referenceTabId, { active: true });
                        // Wait for switch
                        await new Promise(resolve => setTimeout(resolve, 500));
                        activeTabId = referenceTabId;
                    }
                } catch (e) {
                    console.warn(`[Context] Failed to switch to source tab ${referenceTabId}. It might be closed.`);
                    // If source tab is gone, we can't extract.
                    throw new Error("The source tab for this extraction is no longer open. Please start a new extraction.");
                }
            }

            extractionTabIdRef.current = activeTabId || null; // [NEW] Persist the tab ID for stop requests

            // Build a meaningful job name: "LISTING - Page Title - Feb 18, 6:05 PM"
            // Use sourceTab (the page the user picked elements from) not currentTab.
            // Final fallback: look up the preview table's name from DB — it was saved with
            // the correct title during element selection, so it's the most reliable source.
            let previewTableName: string | null = null;
            if (options?.tableDataId) {
                try {
                    const previewRecord = await db.getTableData(options.tableDataId);
                    // Strip the "Preview: " prefix that saveExtraction prepends
                    previewTableName = previewRecord?.name?.replace(/^Preview:\s*/i, '') || null;
                } catch { /* ignore */ }
            }

            const rawTitle = customName
                || sourceTab?.title
                || (sourceTab?.url ? new URL(sourceTab.url).hostname : null)
                || previewTableName
                || (currentTab?.url ? new URL(currentTab.url).hostname : null)
                || 'Page';

            // Clean the title: strip anything that looks like a Chrome extension ID
            // (32-char lowercase alphanumeric strings) and trim to 40 chars
            const cleanTitle = rawTitle
                .replace(/\b[a-z]{32}\b/g, '')   // remove extension IDs
                .replace(/\s+/g, ' ')
                .trim()
                .substring(0, 40)
                || (currentTab.url ? new URL(currentTab.url).hostname : 'Page');

            const modeLabel = pagination.mode === 'pagination' ? 'paginated'
                : pagination.mode === 'loadMore' ? 'load-more'
                    : 'list';

            const pageTitle = customName || `${cleanTitle} · ${modeLabel}`;
            const automationTitle = pageTitle;

            // 0. Use existing or create new Recipe
            let recipeId = options?.recipeId;
            if (!recipeId) {
                recipeId = await db.createRecipe({
                    name: automationTitle,
                    description: "Auto-generated extraction",
                    type: 'list-extraction',
                    version: 1,
                    config: {
                        type: 'list-extraction',
                        selectors: selectors.map(s => s.containerSelector),
                        options: {
                            pagination,
                            fullSelectors: selectors.map(({ data, ...rest }) => ({
                                ...rest,
                                data: { columns: data?.columns || [] }
                            }))
                        }
                    },
                    createdAt: Date.now(),
                    updatedAt: Date.now()
                });
            }

            // Use 'jobId' variable (renamed from automationId) to hold Job ID
            const jobId = await db.createJob({
                recipeId: recipeId,
                name: customName || undefined,
                status: 'running',
                sourceUrl: sourceTab?.url || currentTab?.url || '',
                configSnapshot: {
                    type: 'list-extraction',
                    selectors: selectors.map(s => s.containerSelector),
                    options: {
                        pagination,
                        fullSelectors: selectors.map(({ data, ...rest }) => ({
                            ...rest,
                            data: { columns: data?.columns || [] }
                        }))
                    }
                },
                stats: {
                    startTime: Date.now(),
                    itemsExtracted: 0,
                    pagesVisited: 0,
                    errors: 0
                },
                createdAt: Date.now(),
                updatedAt: Date.now()
            } as any);

            // Notify that job has started
            if (onStart) {
                onStart(jobId);
            }

            // Deep copy and clear previous results to avoid duplication on re-run
            let processedSelectors = JSON.parse(JSON.stringify(selectors)).map((s: any) => ({
                ...s,
                data: s.data ? { ...s.data, items: [] } : { items: [], columns: [] }
            }));

            // Get speed profile
            const speed: PaginationSpeed = pagination.speed || 'normal';
            const profile = PAGINATION_PROFILES[speed];

            // 1. Handle Auto-Scroll or Load More
            if (pagination.mode === 'auto' || pagination.mode === 'loadMore') {
                for (let i = 0; i < processedSelectors.length; i++) {
                    const sel = processedSelectors[i];
                    // Fallback: If patternFound is missing (older jobs), assume true if it's a list extraction
                    const shouldAutoScroll = sel.selectionMode === 'list' && (sel.patternFound !== false || pagination.mode === 'loadMore');

                    if (shouldAutoScroll) {
                        try {
                            const extractionResult = await new Promise<{ items: any[], columns: any[] }>((resolve) => {
                                let previousCount = 0;
                                const listener = async (message: any) => {
                                    if (message.type === 'AUTO_SCROLL_COMPLETE') {
                                        chrome.runtime.onMessage.removeListener(listener);
                                        const payload = message.payload;
                                        resolve(payload.success
                                            ? { items: payload.items || [], columns: payload.columns || [] }
                                            : { items: [], columns: [] }
                                        );
                                    } else if (message.type === 'AUTO_SCROLL_UPDATE') {
                                        const currentCount = message.payload.count;
                                        const delta = currentCount - previousCount;
                                        previousCount = currentCount;

                                        setStatus(prev => ({
                                            ...prev,
                                            progress: { id: sel.id, count: currentCount },
                                            currentPage: 1, // [NEW] Always 1 for auto-scroll
                                            totalProcessed: prev.totalProcessed + delta
                                        }));
                                    }
                                };
                                chrome.runtime.onMessage.addListener(listener);

                                chrome.tabs.sendMessage(activeTabId!, {
                                    type: 'EXECUTE_AUTO_SCROLL',
                                    payload: {
                                        selector: sel.itemSelector,
                                        containerSelector: sel.containerSelector,
                                        selectorType: 'selector',
                                        selectionMode: 'items',
                                        enableInfiniteScroll: true,
                                        loadMoreSelector: pagination.mode === 'loadMore' ? pagination.nextButtonSelector : undefined,
                                        loadMoreSelectorType: (pagination.nextButtonSelector?.startsWith('//') || pagination.nextButtonSelector?.startsWith('(')) ? 'xpath' : 'selector',
                                        scrollDelay: profile.scrollDelay,
                                        contentLoadDelay: profile.contentLoadDelay,
                                        itemSelector: sel.itemSelector
                                    }
                                });
                            });

                            if (extractionResult.items && extractionResult.items.length > 0) {
                                sel.data.items = extractionResult.items;
                                sel.data.columns = extractionResult.columns;
                            }

                            if (stopExtractionRef.current) break;
                        } catch (e) {
                            console.error('Auto scroll error', e);
                        }
                        if (stopExtractionRef.current) break;
                    }
                }
            } else if (pagination.mode === 'pagination' && pagination.nextButtonSelector) {
                // 1b. Handle Next Button Pagination
                const sel = processedSelectors[0];

                if (sel) {
                    await new Promise<void>((resolve) => {
                        const listener = (message: any) => {
                            if (message.type === 'PAGINATION_COMPLETE') {
                                chrome.runtime.onMessage.removeListener(listener);
                                resolve();
                            } else if (message.type === 'PAGINATION_UPDATE') {
                                const { items, total, page } = message.payload;
                                if (page) pagesVisitedRef.current = page;
                                if (items && Array.isArray(items)) {
                                    sel.data.items = [...(sel.data.items || []), ...items];
                                }
                                setStatus(prev => ({
                                    ...prev,
                                    progress: { id: sel.id, count: (sel.data.items?.length || 0) },
                                    currentPage: pagesVisitedRef.current, // [NEW] Track pages
                                    totalProcessed: total
                                }));
                            }
                        };
                        chrome.runtime.onMessage.addListener(listener);

                        chrome.tabs.sendMessage(activeTabId!, {
                            type: 'EXECUTE_PAGINATION',
                            payload: {
                                startSelector: sel.containerSelector,
                                startSelectors: sel.containerSelectors?.map((m: SelectorMetadata) => m.selector) || [],
                                nextButtonSelector: pagination.nextButtonSelector,
                                nextButtonSelectors: pagination.nextButtonSelectors,
                                maxPages: pagination.maxPages || -1,
                                navigationDelay: profile.navigationDelay,
                                contentLoadDelay: profile.contentLoadDelay,
                                pageLoadDelay: profile.pageLoadDelay,
                                urlChangeTimeout: profile.urlChangeTimeout,
                                itemSelector: sel.itemSelector
                            }
                        });
                    });
                }
            }

            // 2. Merge and Save (FRESH DATASET)
            const finalExtraction = consolidateSelectors(processedSelectors, currentTab.url || 'unknown');
            finalExtraction.timestamp = new Date().toISOString();

            // Save as a SINGLE dataset linked to the automation
            const tableId = await db.saveExtraction(finalExtraction, {
                name: pageTitle,
                jobId: jobId,
                tableDataId: tableDataId,
                isPreview: false,
                clearExisting: true
            });

            // Update Job status
            const jobs = await db.getAllJobs();
            const currentJob = jobs.find(j => j.id === jobId);

            // Determine final status
            const finalStatus = stopExtractionRef.current ? 'stopped' : 'completed';

            await db.updateJob(jobId, {
                status: stopExtractionRef.current ? 'paused' : 'completed',
                result: {
                    tableDataId: tableId
                },
                stats: {
                    ...(currentJob?.stats || { startTime: Date.now(), itemsExtracted: 0 }),
                    endTime: Date.now(),
                    itemsExtracted: finalExtraction.items.length,
                    pagesVisited: pagesVisitedRef.current,
                    stoppedByUser: stopExtractionRef.current
                }
            });

            setTimeout(() => {
                if (onComplete) {
                    onComplete(tableId);
                }
                setStatus(prev => ({
                    ...prev,
                    isExtracting: false,
                    status: finalStatus
                }));
            }, 1000);

        } catch (err) {
            console.error('Extraction failed:', err);
            setStatus(prev => ({
                ...prev,
                isExtracting: false,
                status: 'failed',
                error: (err as Error).message || 'Failed to save extracted data.'
            }));
        }
    }, [onComplete]);

    const reset = useCallback(() => {
        setStatus({
            isExtracting: false,
            status: 'idle',
            progress: null,
            totalProcessed: 0,
            error: null
        });
    }, []);

    return {
        status,
        startExtraction,
        stopExtraction,
        reset
    };
}
