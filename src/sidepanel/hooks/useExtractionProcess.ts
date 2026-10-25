import { useCallback, useSyncExternalStore } from 'react';
import { on, sendToActiveTab, sendToTab } from '../../shared/messages';
import { db } from '../../shared/db';
import { storage } from '../../shared/storage';
import { hasAllUrlsPermission, injectContentScript, requestAllUrlsPermission } from '../../shared/utils/hostPermissions';
import type { ExtractionStatus, ListPick, PaginationConfig } from '../../shared/types/extraction';
import { PACE_SPEED, PAGINATION_PROFILES } from '../../shared/constants/paginationConfig';
import { siteOf, siteRun, siteSettings } from '../../shared/sites/siteSettings';
import { consolidateSelectors } from '../../shared/utils/extractionLogic';
import { listSpec } from '../../shared/recipes/spec';
import { columnCoverage, ListingRunTracker } from '../../shared/listing/runStats';

/** Puts a re-derived item selector first in a list recipe's item chain. */
async function healRecipe(recipeId: number, listId: string, itemSelector: string) {
    const recipe = await db.jobs.getRecipe(recipeId);
    if (recipe?.spec.kind !== 'list') return;
    const lists = recipe.spec.lists.map(l => l.id === listId
        ? { ...l, items: [itemSelector, ...l.items.filter(s => s !== itemSelector)].slice(0, 3) }
        : l);
    await db.jobs.reviseRecipe(recipeId, { ...recipe.spec, lists });
}

/** How long a Stop waits for the page to confirm before the run is saved as it is. */
const STOP_GRACE_MS = 5000;
/** After a next-button run loads a page: how long before checking CrawlPilot is running in it. */
const PAGE_CHECK_MS = 3000;

/** True when the tab's content script answers within `ms`. */
async function answers(tabId: number, ms = 2000): Promise<boolean> {
    const reply = sendToTab(tabId, 'PING').then(r => !!r?.success, () => false);
    return Promise.race([reply, new Promise<boolean>(r => setTimeout(() => r(false), ms))]);
}

/*
 * The run lives here, outside any screen: the side panel can show another screen (or the History
 * page re-run it) while the page is still scrolling or paging, and the run must keep receiving its
 * rows and save them. A screen that mounts later sees the same run (status, picks, Stop).
 */
const IDLE: ExtractionStatus = { isExtracting: false, status: 'idle', progress: null, totalProcessed: 0, error: null };

/** The current (or last) list run: its status, and the picks and pages it runs with. */
interface ListRun { status: ExtractionStatus; picks: ListPick[]; pagination: PaginationConfig | null }
let run: ListRun = { status: IDLE, picks: [], pagination: null };
const watchers = new Set<() => void>();

function setStatus(update: ExtractionStatus | ((prev: ExtractionStatus) => ExtractionStatus)) {
    run = { ...run, status: typeof update === 'function' ? update(run.status) : update };
    watchers.forEach(w => w());
}
const subscribe = (w: () => void) => { watchers.add(w); return () => { watchers.delete(w); }; };

/** The list run as it is now, for a screen that mounts while one runs (or after it ended). */
export const currentListRun = () => run;
/** The list run's status, live, wherever the side panel is. */
export const useListRunStatus = () => useSyncExternalStore(subscribe, () => run.status);

const stopExtractionRef = { current: false };
const activeModeRef: { current: PaginationConfig['mode'] | null } = { current: null };
const pagesVisitedRef = { current: 1 };
/** The tab the run reads: Stop goes there, and only its messages are the run's. */
const extractionTabIdRef: { current: number | null } = { current: null };
/** Ends the wait for the page's "complete" message (the page never answered a Stop). */
const giveUpRef: { current: (() => void) | null } = { current: null };

/** Removes a run's message handlers together (when the run's step ends, not when a screen unmounts). */
const track = (...offs: Array<() => void>) => () => offs.forEach(off => off());

export function useExtractionProcess(onComplete?: (tableId: number) => void, onStart?: (jobId: number) => void) {
    const status = useListRunStatus();

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

        // Kept where every page of the run sees it: a next-button run may be between two pages,
        // and the Stop message then reaches the page that is going away (or none).
        void storage.set('pagination_stopped_at', Date.now());
        // What was read so far is saved even if the page never confirms the stop.
        setTimeout(() => giveUpRef.current?.(), STOP_GRACE_MS);

        const targetTabId = extractionTabIdRef.current;

        const stopType = activeModeRef.current === 'pagination' ? 'STOP_PAGINATION' : 'STOP_AUTO_SCROLL';
        const tabId = targetTabId ?? null;
        const stop = tabId
            ? sendToTab(tabId, stopType)
            : sendToActiveTab(stopType);
        stop.catch(e => {
            console.warn('[Stop] Target tab unreachable:', e);
            giveUpRef.current?.();
        });
    }, []);

    const startExtraction = useCallback(async (selectors: ListPick[], pagination: PaginationConfig, options?: { tableId?: number; customName?: string; maxPages?: number }) => {
        if (selectors.length === 0 || run.status.isExtracting) return;

        // Each "Next" loads a new page, and Chrome starts CrawlPilot in it only with access to the
        // site (the click's temporary access ends when the page changes): asked now, while the
        // Start click still counts as the user's.
        if (pagination.mode === 'pagination' && !(await hasAllUrlsPermission())) await requestAllUrlsPermission();

        const { tableId: previewTableId, customName, maxPages } = options || {};
        if (maxPages !== undefined) {
            pagination.maxPages = maxPages;
        }

        run = { ...run, picks: selectors, pagination };
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
            if (options?.tableId) {
                try {
                    const previewRecord = await db.tables.get(options.tableId);
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

            // The recipe is the pick (the same pick run again is the same recipe); the job is this run.
            const recipe = await db.jobs.saveRecipe(automationTitle, listSpec(selectors, pagination));
            const jobId = await db.jobs.create({
                recipeId: recipe.id,
                recipeRev: recipe.rev,
                name: customName || undefined,
                status: 'running',
                input: {
                    urls: [sourceTab?.url || currentTab?.url || ''],
                    ...(pagination.maxPages ? { maxPages: pagination.maxPages } : {}),
                },
                stats: { startTime: Date.now(), itemsExtracted: 0, pagesVisited: 0, errors: 0 },
                createdAt: Date.now(),
                updatedAt: Date.now()
            });

            // Notify that job has started
            if (onStart) {
                onStart(jobId);
            }

            // Deep copy and clear previous results to avoid duplication on re-run
            let processedSelectors: ListPick[] = JSON.parse(JSON.stringify(selectors)).map((s: ListPick) => ({
                ...s,
                data: s.data ? { ...s.data, items: [] } : { items: [], columns: [] }
            }));

            // How fast: the site's pace (its settings card), the same for every run of the site.
            const pace = siteRun(await siteSettings(siteOf(sourceTab?.url || currentTab?.url))).pace;
            const profile = PAGINATION_PROFILES[PACE_SPEED[pace]];

            // 1. Handle Auto-Scroll or Load More
            if (pagination.mode === 'auto' || pagination.mode === 'loadMore') {
                for (let i = 0; i < processedSelectors.length; i++) {
                    const sel = processedSelectors[i];
                    // A list scrolls; a single element picked in list mode is read once (unless load-more).
                    const shouldAutoScroll = sel.patternFound !== false || pagination.mode === 'loadMore';

                    if (shouldAutoScroll) {
                        try {
                            const extractionResult = await new Promise<{ items: any[], columns: any[] }>((resolve) => {
                                let previousCount = 0;
                                // Rows as they arrive: a run cut short (stopped, page gone) still has them.
                                const streamed: any[] = [];
                                let streamedColumns: any[] = sel.data?.columns ?? [];
                                giveUpRef.current = () => { untrack(); resolve({ items: streamed, columns: streamedColumns }); };
                                const untrack = track(
                                    on('AUTO_SCROLL_COMPLETE', (payload, sender) => {
                                        if (sender.tab?.id !== activeTabId) return;
                                        untrack();
                                        const items = payload.success && payload.items?.length ? payload.items : streamed;
                                        resolve({ items, columns: payload.success && payload.columns?.length ? payload.columns : streamedColumns });
                                    }),
                                    on('AUTO_SCROLL_UPDATE', (payload, sender) => {
                                        if (sender.tab?.id !== activeTabId) return;
                                        if (payload.items?.length) streamed.push(...payload.items);
                                        if (payload.columns?.length) streamedColumns = payload.columns;
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
                                        container: sel.container,
                                        items: sel.items,
                                        enableInfiniteScroll: true,
                                        ...(pagination.mode === 'loadMore' ? { loadMore: pagination.next } : {}),
                                        scrollDelay: profile.scrollDelay,
                                        contentLoadDelay: profile.contentLoadDelay,
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
            } else if (pagination.mode === 'pagination' && pagination.next.length > 0) {
                // 1b. Handle Next Button Pagination
                const sel = processedSelectors[0];

                if (sel) {
                    await new Promise<void>((resolve) => {
                        giveUpRef.current = () => { untrack(); resolve(); };
                        // Each page the run loads must have CrawlPilot running to continue the run:
                        // started here when Chrome didn't, else the run ends instead of waiting forever.
                        let checkTimer: ReturnType<typeof setTimeout> | null = null;
                        const onLoaded = (id: number, info: { status?: string }) => {
                            if (id !== activeTabId || info.status !== 'complete') return;
                            if (checkTimer) clearTimeout(checkTimer);
                            checkTimer = setTimeout(async () => {
                                if (await answers(activeTabId!)) return;
                                await injectContentScript(activeTabId!);
                                await new Promise(r => setTimeout(r, 1500));
                                if (await answers(activeTabId!)) return;
                                stopReason = 'no_access';
                                setStatus(prev => ({ ...prev, stopReason, error: 'CrawlPilot could not read the next page: allow it on this site (Site access → On all sites), then run again. The pages read so far are saved.' }));
                                giveUpRef.current?.();
                            }, PAGE_CHECK_MS);
                        };
                        chrome.tabs.onUpdated.addListener(onLoaded);
                        const offLoaded = () => { chrome.tabs.onUpdated.removeListener(onLoaded); if (checkTimer) clearTimeout(checkTimer); };
                        const untrack = track(offLoaded,
                            on('PAGINATION_COMPLETE', (p, sender) => {
                                if (sender.tab?.id !== activeTabId) return;
                                untrack();
                                stopReason = p.reason || (p.success === false ? 'error' : undefined);
                                setStatus(prev => ({ ...prev, stopReason }));
                                resolve();
                            }),
                            on('PAGINATION_UPDATE', ({ items, page, columns, unmapped, fallback, healedItems, healedFields, brokenFields, loading }, sender) => {
                                if (sender.tab?.id !== activeTabId) return;
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
                                tracker.markFields(page || pagesVisitedRef.current, healedFields, brokenFields);
                                tracker.addLoading(page || pagesVisitedRef.current, loading);
                                // The stored item chain stopped matching and the page re-derived one: the recipe
                                // starts with it from now on (a new revision; this job keeps the one it ran).
                                if (healedItems) void healRecipe(recipe.id, sel.id, healedItems);
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
                                container: sel.container,
                                items: sel.items,
                                next: pagination.next,
                                maxPages: pagination.maxPages || -1,
                                navigationDelay: profile.navigationDelay,
                                contentLoadDelay: profile.contentLoadDelay,
                                pageLoadDelay: profile.pageLoadDelay,
                                urlChangeTimeout: profile.urlChangeTimeout,
                                columns: sel.data?.columns
                        });
                    });
                }
            }

            giveUpRef.current = null;
            // 2. Merge and Save (FRESH DATASET)
            const finalExtraction = consolidateSelectors(processedSelectors, currentTab.url || 'unknown');
            finalExtraction.timestamp = new Date().toISOString();

            // Save as a SINGLE dataset linked to the automation. A stopped run that read nothing
            // keeps the preview's rows instead of replacing them with none.
            const keepPreview = stopExtractionRef.current && finalExtraction.items.length === 0 && previewTableId !== undefined;
            const tableId = keepPreview ? previewTableId! : await db.tables.save(finalExtraction, {
                name: pageTitle,
                jobId: jobId,
                tableId: previewTableId,
                preview: false,
                replace: true
            });
            // The column setup of this recipe's last table (renames, cleaning, merges) carries over.
            if (!keepPreview) await db.jobs.carryColumnSetup(jobId, tableId).catch(e => console.warn('[List run] Column setup not carried:', e));

            // Update Job status
            const currentJob = await db.jobs.get(jobId);

            // Determine final status
            const finalStatus = stopExtractionRef.current ? 'stopped' : 'completed';

            await db.jobs.update(jobId, {
                status: stopExtractionRef.current ? 'stopped' : 'completed',
                tableId,
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
                    status: finalStatus,
                    tableId,
                    itemsSaved: finalExtraction.items.length,
                    pagesVisited: pagesVisitedRef.current,
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
    }, [onComplete, onStart]);

    const reset = useCallback(() => {
        if (run.status.isExtracting) return;
        run = { ...run, picks: [], pagination: null };
        setStatus(IDLE);
    }, []);

    return {
        status,
        startExtraction,
        stopExtraction,
        reset
    };
}
