import { useState, useRef, useCallback, useEffect } from 'react';
import { on, sendToActiveTab, sendToTab } from '../../shared/messages';
import { db } from '../../shared/db';
import { SelectorState, PaginationConfig, ExtractionStatus, SelectorMetadata } from '../../shared/types/extraction';
import { PAGINATION_PROFILES, PaginationSpeed } from '../../shared/constants/paginationConfig';
import { consolidateSelectors } from '../../shared/utils/extractionLogic';
import { filterPersistableChain } from '../../shared/selectors/stability';
import { columnCoverage, ListingRunTracker } from '../../shared/listing/runStats';
import { looksLikeXPath } from '../../shared/selectors/resolve';

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

    // Message handlers registered by startExtraction's auto-scroll / pagination promises, removed
    // on unmount too: navigating away mid-extraction would otherwise leak them.
    const activeOffsRef = useRef<Array<() => void>>([]);

    const track = useCallback((...offs: Array<() => void>) => {
        activeOffsRef.current.push(...offs);
        return () => {
            offs.forEach(off => off());
            activeOffsRef.current = activeOffsRef.current.filter(o => !offs.includes(o));
        };
    }, []);

    useEffect(() => {
        return () => {
            activeOffsRef.current.forEach(off => off());
            activeOffsRef.current = [];
        };
    }, []);

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

        const stopType = activeModeRef.current === 'pagination' ? 'STOP_PAGINATION' : 'STOP_AUTO_SCROLL';
        const tabId = targetTabId ?? null;
        const stop = tabId
            ? sendToTab(tabId, stopType)
            : sendToActiveTab(stopType);
        stop.catch(e => {
            console.warn('[Stop] Target tab unreachable:', e);
            setStatus(prev => ({
                ...prev,
                isExtracting: false,
                status: 'stopped',
                error: 'Extraction stopped (connection lost to page).'
            }));
        });
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
        const tracker = new ListingRunTracker();
        let stopReason: string | undefined;

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
                    const previewRecord = await db.tables.get(options.tableDataId);
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
                recipeId = await db.jobs.createRecipe({
                    name: automationTitle,
                    description: "Auto-generated extraction",
                    type: 'list-extraction',
                    version: 1,
                    config: {
                        type: 'list-extraction',
                        selectors: selectors.map(s => s.containerSelector),
                        options: {
                            pagination,
                            // Volatile entries (CSS-in-JS hash classes, :nth-child) are dropped
                            // from persisted fallback chains so saved recipes survive redeploys —
                            // they're still tried live during picking/preview, just not stored.
                            fullSelectors: selectors.map(({ data, containerSelectors, itemSelectors, ...rest }) => ({
                                ...rest,
                                containerSelectors: filterPersistableChain(containerSelectors),
                                itemSelectors: filterPersistableChain(itemSelectors),
                                data: { columns: data?.columns || [] }
                            }))
                        }
                    },
                    createdAt: Date.now(),
                    updatedAt: Date.now()
                });
            }

            // Use 'jobId' variable (renamed from automationId) to hold Job ID
            const jobId = await db.jobs.create({
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
            });

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
                                const untrack = track(
                                    on('AUTO_SCROLL_COMPLETE', payload => {
                                        untrack();
                                        resolve(payload.success
                                            ? { items: payload.items || [], columns: payload.columns || [] }
                                            : { items: [], columns: [] }
                                        );
                                    }),
                                    on('AUTO_SCROLL_UPDATE', payload => {
                                        const currentCount = payload.count;
                                        const delta = currentCount - previousCount;
                                        previousCount = currentCount;

                                        setStatus(prev => ({
                                            ...prev,
                                            progress: { id: sel.id, count: currentCount },
                                            currentPage: 1, // [NEW] Always 1 for auto-scroll
                                            totalProcessed: prev.totalProcessed + delta
                                        }));
                                    })
                                );

                                void sendToTab(activeTabId!, 'EXECUTE_AUTO_SCROLL', {
                                        selector: sel.itemSelector,
                                        selectors: sel.itemSelectors,
                                        containerSelector: sel.containerSelector,
                                        containerSelectors: sel.containerSelectors,
                                        selectorType: 'selector',
                                        selectionMode: 'items',
                                        enableInfiniteScroll: true,
                                        loadMoreSelector: pagination.mode === 'loadMore' ? pagination.nextButtonSelector : undefined,
                                        loadMoreSelectorType: pagination.nextButtonSelector && looksLikeXPath(pagination.nextButtonSelector) ? 'xpath' : 'selector',
                                        scrollDelay: profile.scrollDelay,
                                        contentLoadDelay: profile.contentLoadDelay,
                                        itemSelector: sel.itemSelector,
                                        // The preview's fields: every scrolled row is read with them.
                                        columns: sel.data?.columns
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
                        const untrack = track(
                            on('PAGINATION_COMPLETE', p => {
                                untrack();
                                stopReason = p.reason || (p.success === false ? 'error' : undefined);
                                setStatus(prev => ({ ...prev, stopReason }));
                                resolve();
                            }),
                            on('PAGINATION_UPDATE', ({ items, page, columns, unmapped, fallback }) => {
                                if (page) pagesVisitedRef.current = page;
                                // The fields the run reads every page with (frozen): save them as the columns.
                                if (Array.isArray(columns) && columns.length > 0) sel.data.columns = columns;
                                if (items && Array.isArray(items)) {
                                    // Drop rows an earlier page already had (sponsored slots, overlapping pages)
                                    const fresh = tracker.add(page || pagesVisitedRef.current, items);
                                    sel.data.items = [...(sel.data.items || []), ...fresh];
                                }
                                if (unmapped) tracker.addUnmapped(page || pagesVisitedRef.current, unmapped);
                                if (fallback) tracker.markFallback(page || pagesVisitedRef.current);
                                setStatus(prev => ({
                                    ...prev,
                                    progress: { id: sel.id, count: (sel.data.items?.length || 0) },
                                    currentPage: pagesVisitedRef.current,
                                    totalProcessed: sel.data.items?.length || 0,
                                    duplicates: tracker.duplicates
                                }));
                            })
                        );

                        void sendToTab(activeTabId!, 'EXECUTE_PAGINATION', {
                                startSelector: sel.containerSelector,
                                startSelectors: sel.containerSelectors?.map((m: SelectorMetadata) => m.selector) || [],
                                nextButtonSelector: pagination.nextButtonSelector,
                                nextButtonSelectors: pagination.nextButtonSelectors,
                                maxPages: pagination.maxPages || -1,
                                navigationDelay: profile.navigationDelay,
                                contentLoadDelay: profile.contentLoadDelay,
                                pageLoadDelay: profile.pageLoadDelay,
                                urlChangeTimeout: profile.urlChangeTimeout,
                                itemSelector: sel.itemSelector,
                                itemSelectors: sel.itemSelectors,
                                columns: sel.data?.columns
                        });
                    });
                }
            }

            // 2. Merge and Save (FRESH DATASET)
            const finalExtraction = consolidateSelectors(processedSelectors, currentTab.url || 'unknown');
            finalExtraction.timestamp = new Date().toISOString();

            // Save as a SINGLE dataset linked to the automation
            const tableId = await db.tables.save(finalExtraction, {
                name: pageTitle,
                jobId: jobId,
                tableDataId: tableDataId,
                isPreview: false,
                clearExisting: true
            });

            // Update Job status
            const currentJob = await db.jobs.get(jobId);

            // Determine final status
            const finalStatus = stopExtractionRef.current ? 'stopped' : 'completed';

            await db.jobs.update(jobId, {
                status: stopExtractionRef.current ? 'paused' : 'completed',
                result: {
                    tableDataId: tableId
                },
                stats: {
                    ...(currentJob?.stats || { startTime: Date.now(), itemsExtracted: 0 }),
                    endTime: Date.now(),
                    itemsExtracted: finalExtraction.items.length,
                    pagesVisited: pagesVisitedRef.current,
                    stoppedByUser: stopExtractionRef.current,
                    stopReason: stopExtractionRef.current ? 'cancelled' : stopReason,
                    pageStats: tracker.pageStats.length > 0 ? tracker.pageStats : undefined,
                    duplicatesRemoved: tracker.duplicates || undefined,
                    coverage: columnCoverage(finalExtraction.columns as any[], finalExtraction.items)
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
    }, [onComplete, track]);

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
