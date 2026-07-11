/**
 * BulkExtractionOrchestrator — runs in the background service worker.
 * 
 * Manages the full lifecycle of multi-URL page extraction:
 * - Creates/manages a TabPool (max 5 tabs)
 * - Processes URLs concurrently with configurable parallelism
 * - Persists progress to chrome.storage.local for resilience
 * - Broadcasts progress/completion to the sidepanel
 * - Handles stop requests, tab closures, and errors gracefully
 */

import { TabPool } from './TabPool';
import { db } from '../../shared/db/db-manager';
import { buildInitialName, buildFinalName, buildPreviewName } from '../../shared/utils/run-naming';

/**
 * Ported from docs/legacy-reference/background-readable.js — clickElement (line 355–445).
 * Runs in the isolated world (no world:'MAIN'). Must be fully self-contained.
 *
 * Logic mirrors the reference exactly:
 *   1. Find element via CSS selector or XPath (tries each alternative in order)
 *   2. Zero dimensions → return error (element is inside a hidden/collapsed section)
 *   3. Out of viewport → scrollIntoView, return { success:'scroll' } so the
 *      caller waits 1 s and retries (reference scroll-then-retry pattern)
 *   4. In viewport → el.click(), fallback to MouseEvent dispatch
 */
function _refClickElement(selectors: Array<{ type: string; value: string }>) {
    function findEl(): HTMLElement | null {
        for (const s of selectors) {
            try {
                if (s.type === 'xpath') {
                    const r = document.evaluate(s.value, document, null, 9, null);
                    const node = r.singleNodeValue as HTMLElement | null;
                    if (node) return node;
                } else {
                    const el = document.querySelector<HTMLElement>(s.value);
                    if (el) return el;
                }
            } catch (_) { /* try next selector */ }
        }
        return null;
    }

    const el = findEl();
    if (!el) return { success: false, error: 'Element not found' };

    const rect = el.getBoundingClientRect();

    if (rect.width === 0 || rect.height === 0) {
        return { success: false, error: 'Element has zero dimensions' };
    }

    if (!(rect.top >= 0 && rect.left >= 0 && rect.bottom <= window.innerHeight && rect.right <= window.innerWidth)) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return { success: 'scroll', message: 'Element scrolled into view' };
    }

    try {
        el.click();
        return { success: true, method: 'direct' };
    } catch (_) {
        try {
            el.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));
            return { success: true, method: 'event' };
        } catch (e: any) {
            return { success: false, error: 'Failed to click element: ' + (e as Error).message };
        }
    }
}

/**
 * Runs in the page's MAIN world after a click-wait.
 *
 * Background tabs throttle requestAnimationFrame to ~1fps, so React accordion
 * state updates that depend on rAF may not have settled by the time we extract.
 * This function forces collapsible sections open via direct inline-style overrides,
 * bypassing the animation entirely. No native function touched — no bot-detection risk.
 * Must be fully self-contained — no imports, no closures.
 */
function _mainWorldForceExpand() {
    // SUI React accordion (Home Depot etc.): height/overflow/visibility toggled on .sui-collapse-root
    document.querySelectorAll<HTMLElement>('.sui-collapse-root').forEach(el => {
        el.style.setProperty('height', 'auto', 'important');
        el.style.setProperty('min-height', '0', 'important');
        el.style.setProperty('overflow', 'visible', 'important');
        el.style.setProperty('visibility', 'visible', 'important');
    });
    // CSS-checkbox accordion pattern: checking the input expands via the :checked CSS rule
    document.querySelectorAll<HTMLInputElement>('input.accordion__input[type="checkbox"]').forEach(input => {
        if (!input.checked) input.checked = true;
    });
    // Generic collapsed regions (aria-hidden="true" inside an accordion role="region")
    document.querySelectorAll<HTMLElement>('[role="region"][aria-hidden="true"]').forEach(el => {
        el.removeAttribute('aria-hidden');
        el.style.setProperty('display', 'block', 'important');
        el.style.setProperty('visibility', 'visible', 'important');
    });
}

const STORAGE_KEY = 'bulk_extraction_state';
const KEEPALIVE_ALARM = 'bulk_extraction_keepalive';

export interface BulkExtractionConfig {
    urls: string[];
    elements: any[];
    config: any;
    jobId?: number;
    recipeId?: number;
    customName?: string;
    maxConcurrent?: number;
}

interface UrlStatus {
    url: string;
    status: 'queued' | 'extracting' | 'done' | 'error';
    error?: string;
    tabId?: number;
}

interface ExtractionState {
    jobId: number;
    urlStatuses: UrlStatus[];
    results: any[];
    finalColumns: any[];
    isRunning: boolean;
    startTime: number;
}

export class BulkExtractionOrchestrator {
    private tabPool: TabPool | null = null;
    private state: ExtractionState | null = null;
    private shouldStop = false;
    private elements: any[] = [];
    private config: any = {};
    private isActive = false;
    private previewTableId: number | null = null;
    private previewSavedCount = 0;
    private keepAliveInterval: ReturnType<typeof setInterval> | null = null;

    async start(extractionConfig: BulkExtractionConfig): Promise<{ jobId: number; originalCount: number; uniqueCount: number }> {
        if (this.isActive) {
            throw new Error('An extraction is already in progress');
        }

        const { urls, elements, config, jobId: existingJobId, recipeId: passedRecipeId, customName, maxConcurrent } = extractionConfig;

        // When the caller doesn't specify concurrency, derive a safe default from device
        // capabilities so low-RAM machines don't open more background tabs than they can handle.
        // navigator.deviceMemory (GB) and hardwareConcurrency are available in MV3 service workers.
        const deviceMemoryGB = (navigator as any).deviceMemory ?? 4;
        const cpuCores = navigator.hardwareConcurrency ?? 4;
        const safeConcurrent = Math.max(1, Math.min(
            Math.floor(deviceMemoryGB),   // 1 tab per GB of RAM
            Math.floor(cpuCores / 2),     // at most half the logical cores
            5                             // hard cap
        ));
        const concurrency = maxConcurrent ?? safeConcurrent;

        if (urls.length === 0 || elements.length === 0) {
            throw new Error('URLs and elements are required');
        }

        this.isActive = true;
        this.shouldStop = false;
        this.elements = elements;
        this.config = config;

        const uniqueUrls = Array.from(new Set(urls));
        const duplicatesRemoved = urls.length - uniqueUrls.length;
        if (duplicatesRemoved > 0) {
            console.log(`[Orchestrator] Deduplicated URLs: ${urls.length} provided → ${uniqueUrls.length} unique (${duplicatesRemoved} duplicates removed)`);
        }

        // Create job/recipe if not provided
        let jobId = existingJobId;
        let recipeId = passedRecipeId;

        const extractionAction = {
            type: 'EXTRACT_PAGES',
            elements,
            config
        };

        if (!jobId) {
            const jobName = customName || buildInitialName(uniqueUrls);

            if (!recipeId) {
                recipeId = await db.createRecipe({
                    name: jobName,
                    description: "Background bulk page extraction",
                    type: 'bulk-extraction',
                    version: 1,
                    config: {
                        type: 'bulk-extraction',
                        urls: uniqueUrls,
                        options: { actions: [extractionAction] }
                    },
                    createdAt: Date.now(),
                    updatedAt: Date.now()
                });
            }

            jobId = await db.createJob({
                recipeId: recipeId,
                name: jobName,
                status: 'running',
                sourceUrl: uniqueUrls[0],
                configSnapshot: {
                    type: 'bulk-extraction',
                    urls: uniqueUrls,
                    options: { actions: [extractionAction] }
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
        } else {
            await db.updateJob(jobId, {
                status: 'running',
                stats: { startTime: Date.now(), itemsExtracted: 0, pagesVisited: 0, errors: 0 }
            });
        }

        // Initialize state
        this.previewTableId = null;
        this.previewSavedCount = 0;
        this.state = {
            jobId,
            urlStatuses: uniqueUrls.map(url => ({ url, status: 'queued' })),
            results: [],
            finalColumns: [],
            isRunning: true,
            startTime: Date.now()
        };

        // Persist state
        await this.persistState();

        // Start keep-alive alarm
        this.startKeepAlive();

        // Create tab pool — use the viewport captured during element selection so
        // background tabs render the same DOM the user saw when picking selectors
        const viewportWidth = config.viewportWidth || 800;
        const viewportHeight = config.viewportHeight || 600;
        const tabLoadTimeout = config.loadTimeout || 30000;
        const shouldWaitForLoad = config.waitForLoad !== false;
        this.tabPool = new TabPool(concurrency, viewportWidth, viewportHeight, tabLoadTimeout, shouldWaitForLoad);
        this.tabPool.setOnTabRemoved((tabId) => this.handleTabClosed(tabId));

        // Execute extraction
        this.executeExtraction().catch(err => {
            console.error('[Orchestrator] Fatal error:', err);
            this.finishExtraction(true, err.message);
        });

        return { jobId, originalCount: urls.length, uniqueCount: uniqueUrls.length };
    }

    async stop() {
        this.shouldStop = true;
        if (this.tabPool) this.tabPool.shouldStop = true;
        console.log('[Orchestrator] Stop requested');
    }

    get running(): boolean {
        return this.isActive;
    }

    private async executeExtraction() {
        if (!this.state || !this.tabPool) return;

        const urlQueue = this.state.urlStatuses
            .filter(u => u.status === 'queued')
            .map(u => u.url);

        // Process URLs with concurrency
        const workers: Promise<void>[] = [];
        const maxWorkers = this.tabPool.availableSlots + this.tabPool.activeCount;
        const workerCount = Math.min(maxWorkers, urlQueue.length);

        console.log(`[Orchestrator] Starting extraction: ${urlQueue.length} URLs, ${workerCount} workers`);

        for (let i = 0; i < workerCount; i++) {
            if (i > 0) await new Promise(r => setTimeout(r, 1500));
            workers.push(this.worker(urlQueue, i));
        }

        await Promise.all(workers);

        const done = this.state.urlStatuses.filter(u => u.status === 'done').length;
        const errors = this.state.urlStatuses.filter(u => u.status === 'error');
        console.log(`[Orchestrator] All workers finished. Succeeded: ${done}, Failed: ${errors.length}`);
        if (errors.length > 0) {
            console.warn(`[Orchestrator] Failed URLs:`, errors.map(u => `${u.url} → ${u.error}`));
        }

        // Finish
        await this.finishExtraction(this.shouldStop);
    }

    private async worker(queue: string[], workerId: number) {
        console.log(`[Orchestrator] Worker ${workerId} started, queue size: ${queue.length}`);
        let processed = 0;
        try {
            while (!this.shouldStop) {
                const url = queue.shift();
                if (!url) break;
                processed++;
                console.log(`[Orchestrator] Worker ${workerId} processing URL ${processed}: ${url}`);
                await this.processUrl(url);
            }
        } catch (err: any) {
            console.error(`[Orchestrator] Worker ${workerId} crashed after ${processed} URLs:`, err);
            throw err;
        }
        console.log(`[Orchestrator] Worker ${workerId} finished. Processed ${processed} URLs. Remaining queue: ${queue.length}`);
    }

    private async processUrl(url: string) {
        if (!this.state || !this.tabPool) return;

        const urlStatus = this.state.urlStatuses.find(u => u.url === url);
        if (!urlStatus) return;

        urlStatus.status = 'extracting';
        this.broadcastProgress();

        let tabId: number | null = null;

        try {
            // Acquire tab from pool — popup window for click-based extractions so rAF
            // runs at full speed; silent background tab for read-only extractions.
            const needsInteraction = this.elements.some(e => e.action === 'click');
            tabId = await this.tabPool.acquireTab(url, needsInteraction);
            if (tabId === null && !this.shouldStop) {
                console.warn(`[Orchestrator] acquireTab returned null for ${url} — waiting 2 s and retrying`);
                // Pool full or script not ready — brief wait then one retry
                await new Promise(r => setTimeout(r, 2000));
                tabId = await this.tabPool.acquireTab(url, needsInteraction);
                if (tabId === null) {
                    console.error(`[Orchestrator] acquireTab failed on retry for ${url}`);
                }
            }

            if (tabId === null) {
                throw new Error(this.shouldStop ? 'Extraction stopped' : 'Could not acquire tab from pool (content script may be blocked on this host)');
            }

            urlStatus.tabId = tabId;
            this.tabPool.markExtracting(tabId);

            // Extract data from tab using background-safe message
            console.log(`[Orchestrator] Extracting from tab ${tabId}: ${url}`);
            const extractedData = await this.extractFromTab(tabId, url);

            if (extractedData) {
                const count = Array.isArray(extractedData) ? extractedData.length : 1;
                console.log(`[Orchestrator] ✅ Extracted ${count} item(s) from ${url}`);
                if (Array.isArray(extractedData)) {
                    this.state.results.push(...extractedData);
                } else {
                    this.state.results.push(extractedData);
                }
                urlStatus.status = 'done';
            } else {
                console.warn(`[Orchestrator] ⚠️ extractFromTab returned null for ${url} — marking as error`);
                urlStatus.status = 'error';
                urlStatus.error = 'No data extracted';
            }
        } catch (err: any) {
            console.error(`[Orchestrator] ❌ Error processing ${url}:`, err.message, err);
            urlStatus.status = 'error';
            urlStatus.error = err.message;
        } finally {
            // Release tab
            if (tabId !== null) {
                await this.tabPool.releaseTab(tabId);
            }

            this.broadcastProgress();
            await this.persistState();

            // Fire-and-forget partial preview — gives users live visibility into results
            this.savePreview().catch(e => console.warn('[Orchestrator] Preview save failed:', e));

            // Delay between pages (with optional random jitter for anti-bot)
            let requestDelay = this.config.requestDelay ?? 1000;
            if (this.config.enableRandomization && requestDelay > 0) {
                requestDelay += Math.floor(Math.random() * requestDelay * 0.5);
            }
            if (requestDelay > 0 && !this.shouldStop) {
                await new Promise(r => setTimeout(r, requestDelay));
            }
        }
    }

    private async savePreview(): Promise<void> {
        if (!this.state || this.state.results.length === 0) return;

        const allItems = this.state.results;
        const newItems = allItems.slice(this.previewSavedCount);
        if (newItems.length === 0) return;

        const totalUrls = this.state.urlStatuses.length;
        const completedSoFar = this.state.urlStatuses.filter(u => u.status === 'done' || u.status === 'error').length;
        const isLastBatch = completedSoFar >= totalUrls;
        if (newItems.length < 3 && !isLastBatch) return;

        const urlStatuses = this.state.urlStatuses;
        const completedCount = urlStatuses.filter(u => u.status === 'done').length;

        // Mirror the column setup from finishExtraction
        const columns = [...this.state.finalColumns];
        const sourceUrlCol = { id: 'source_url', name: 'Source URL', type: 'link' as const, order: 0 };
        const recordIdCol = { id: 'recordId', name: 'Record ID', type: 'text' as const, order: 1 };
        if (!columns.find((c: any) => c.id === 'source_url')) columns.unshift(sourceUrlCol);
        if (!columns.find((c: any) => c.id === 'recordId')) columns.push(recordIdCol);

        const previewData = {
            type: 'bulk-page',
            items: newItems,
            columns,
            source_url: urlStatuses[0]?.url || '',
            count: allItems.length,
            timestamp: new Date().toISOString()
        };

        const name = buildPreviewName(urlStatuses.map(u => u.url), completedCount, urlStatuses.length);

        if (this.previewTableId === null) {
            this.previewTableId = await db.saveExtraction(previewData, {
                name,
                jobId: this.state.jobId,
                isPreview: true
            });
        } else {
            // Incremental append — no clearExisting, so only new rows are written
            await db.saveExtraction(previewData, {
                tableDataId: this.previewTableId,
                name,
                jobId: this.state.jobId,
                isPreview: true
            });
        }

        this.previewSavedCount = allItems.length;

        // Re-broadcast so sidepanel picks up the new previewTableId immediately
        this.broadcastProgress();
    }

    private async extractFromTab(tabId: number, url: string): Promise<any> {
        if (!this.tabPool) return null;

        const actionSpeed = this.config.actionSpeed || 500;
        const clickWaitMs = this.config.clickWaitMs ?? Math.max(actionSpeed, 2000);

        if (this.shouldStop || this.elements.length === 0) return null;

        const hasClicks = this.elements.some(e => e.action === 'click');

        if (hasClicks) {
            // Phase 1: click — ported from reference clickElement (background-readable.js:355).
            // Scroll-then-retry: if element is out of viewport the injected function scrolls it
            // into view and returns { success:'scroll' }; we wait 1 s and retry (up to 3×).
            const clickElements = this.elements.filter(e => e.action === 'click');
            for (const clickEl of clickElements) {
                if (this.shouldStop) break;
                const maxScrollRetries = 3;
                for (let attempt = 0; attempt < maxScrollRetries; attempt++) {
                    if (this.shouldStop) break;
                    try {
                        const results = await chrome.scripting.executeScript({
                            target: { tabId },
                            func: _refClickElement,
                            args: [clickEl.selectors]
                        });
                        const r = results?.[0]?.result as any;
                        console.log(`[Orchestrator] Click "${clickEl.name}" attempt ${attempt + 1}: success=${r?.success} ${r?.method ?? r?.error ?? ''}`);
                        if (r?.success === 'scroll') {
                            await new Promise(resolve => setTimeout(resolve, 1000));
                            continue;
                        }
                        break;
                    } catch (e: any) {
                        console.warn(`[Orchestrator] Click failed for "${clickEl.name}": ${e.message}`);
                        break;
                    }
                }
            }
            // Phase 2: wait in service worker — NOT subject to background-tab timer throttling.
            // Minimum 3 s to allow popup / network-loaded content to appear.
            const wait = Math.max(clickWaitMs, 3000);
            if (!this.shouldStop) await new Promise(r => setTimeout(r, wait));

            // Phase 2b: force collapsible sections open via direct CSS override.
            // Background tabs throttle rAF to ~1fps, so React accordion state updates
            // triggered by the click may not have settled. We bypass the animation by
            // directly setting inline styles — no native function touched, no bot-detection risk.
            if (!this.shouldStop) {
                try {
                    await chrome.scripting.executeScript({
                        target: { tabId },
                        world: 'MAIN',
                        func: _mainWorldForceExpand
                    });
                    console.log(`[Orchestrator] Force-expanded collapsible sections on tab ${tabId}`);
                } catch (_e) { /* non-fatal — page may have navigated */ }
            }
        }

        // Phase 3: extract non-click elements (or all elements if no clicks).
        // When clicks were involved, enable waitForElements so the content script uses
        // MutationObserver (not timers) to wait until popup elements appear in the DOM.
        const extractElements = hasClicks
            ? this.elements.filter(e => e.action !== 'click')
            : this.elements;

        if (extractElements.length === 0) return null;

        const postClickConfig = hasClicks ? {
            ...this.config,
            actionSpeed,
            waitForElements: true,
            elementTimeout: Math.max(this.config.elementTimeout || 0, 8000),
        } : { ...this.config, actionSpeed };

        const response = await this.tabPool.sendMessage(tabId, {
            type: 'CMD_EXTRACT_PAGE_BACKGROUND',
            payload: {
                actionType: 'EXTRACT_PAGES',
                url,
                elements: extractElements,
                config: postClickConfig
            }
        });

        if (!response || !response.success || !response.result) {
            console.warn(`[Orchestrator] extractFromTab bad response for ${url}:`, JSON.stringify({ hasResponse: !!response, success: response?.success, hasResult: !!response?.result, error: response?.error }));
            return null;
        }

        const { item, items, columns: resultColumns } = response.result;

        // Merge columns into state
        if (resultColumns && Array.isArray(resultColumns)) {
            resultColumns.forEach((newCol: any) => {
                if (!this.state!.finalColumns.find((c: any) => c.id === newCol.id)) {
                    this.state!.finalColumns.push(newCol);
                }
            });
        }

        // Add source_url to each row
        if (items && Array.isArray(items)) {
            return items.map((row: any) => ({ ...row, source_url: url }));
        } else if (item) {
            return { ...item, source_url: url };
        }

        return null;
    }

    private handleTabClosed(tabId: number) {
        if (!this.state) return;

        // Find the URL that was being extracted on this tab and requeue it
        const urlStatus = this.state.urlStatuses.find(u => u.tabId === tabId && u.status === 'extracting');
        if (urlStatus) {
            console.log(`[Orchestrator] Tab ${tabId} closed while extracting ${urlStatus.url} — marking as error`);
            urlStatus.status = 'error';
            urlStatus.error = 'Tab was closed during extraction';
            urlStatus.tabId = undefined;
            this.broadcastProgress();
        }
    }

    private async finishExtraction(stoppedByUser: boolean, error?: string) {
        if (!this.state) return;

        this.state.isRunning = false;
        const jobId = this.state.jobId;
        const allItems = this.state.results;
        const urlStatuses = this.state.urlStatuses;
        const completedCount = urlStatuses.filter(u => u.status === 'done').length;
        const errorStatuses = urlStatuses.filter(u => u.status === 'error');
        const queuedCount = urlStatuses.filter(u => u.status === 'queued').length;
        const startTime = this.state.startTime;

        console.log(`[Orchestrator] finishExtraction — stoppedByUser: ${stoppedByUser}, items: ${allItems.length}, succeeded: ${completedCount}, failed: ${errorStatuses.length}, still-queued: ${queuedCount}`);
        if (errorStatuses.length > 0) {
            console.warn(`[Orchestrator] Failed URL details:`);
            errorStatuses.forEach(u => console.warn(`  ❌ ${u.url}  →  ${u.error ?? 'unknown'}`));
        }
        if (queuedCount > 0) {
            const queued = urlStatuses.filter(u => u.status === 'queued').map(u => u.url);
            console.warn(`[Orchestrator] ${queuedCount} URL(s) never started (workers stopped early?):`, queued);
        }

        let tableDataId: number | undefined;

        try {
            if (allItems.length > 0) {
                // Ensure source_url and recordId columns are included
                const sourceUrlCol = { id: 'source_url', name: 'Source URL', type: 'link' as const, order: 0 };
                const recordIdCol = { id: 'recordId', name: 'Record ID', type: 'text' as const, order: 1 };
                if (!this.state.finalColumns.find((c: any) => c.id === 'source_url')) {
                    this.state.finalColumns.unshift(sourceUrlCol);
                }
                if (!this.state.finalColumns.find((c: any) => c.id === 'recordId')) {
                    this.state.finalColumns.push(recordIdCol);
                }

                const finalName = buildFinalName(urlStatuses.map(u => u.url), completedCount);

                if (this.previewTableId !== null) {
                    // Promote the live preview table to final in-place — no second record created.
                    // savePreview() is fire-and-forget, so flush any items it may not have written yet.
                    const unsaved = allItems.slice(this.previewSavedCount);
                    if (unsaved.length > 0) {
                        await db.storeTableRowsBatch(this.previewTableId, unsaved);
                    }
                    // Write the complete final column set (preview saves may have been partial).
                    await db.updateTableColumns(this.previewTableId, this.state.finalColumns);
                    // Rename and mark as no longer a preview.
                    await db.updateTableData(this.previewTableId, {
                        name: finalName,
                        metadata: {
                            extractionType: 'bulk-page',
                            totalRows: allItems.length,
                            isPreview: false
                        }
                    });
                    tableDataId = this.previewTableId;
                } else {
                    // Fallback: preview was never created (stopped before first batch threshold).
                    const finalData = {
                        type: 'bulk-page',
                        items: allItems,
                        columns: this.state.finalColumns,
                        source_url: urlStatuses[0].url + (urlStatuses.length > 1 ? ` (+${urlStatuses.length - 1} more)` : ''),
                        count: allItems.length,
                        timestamp: new Date().toISOString()
                    };
                    tableDataId = await db.saveExtraction(finalData, { name: finalName, jobId });
                }
            }

            // Update job
            await db.updateJob(jobId, {
                status: stoppedByUser ? 'paused' : 'completed',
                result: tableDataId ? { tableDataId } : undefined,
                stats: {
                    startTime,
                    endTime: Date.now(),
                    itemsExtracted: allItems.length,
                    pagesVisited: completedCount,
                    stoppedByUser
                }
            });

            // Broadcast completion
            chrome.runtime.sendMessage({
                type: 'BULK_EXTRACTION_COMPLETE',
                payload: {
                    jobId,
                    tableDataId,
                    totalItems: allItems.length,
                    success: !error && !stoppedByUser,
                    error,
                    stoppedByUser
                },
                timestamp: Date.now()
            }).catch(() => { /* sidepanel may not be open */ });
        } catch (e) {
            console.error('[Orchestrator] Error in finishExtraction (data/broadcast):', e);
            // Broadcast a best-effort completion signal so the sidepanel doesn't hang
            chrome.runtime.sendMessage({
                type: 'BULK_EXTRACTION_COMPLETE',
                payload: { jobId, tableDataId, totalItems: allItems.length, success: false, error: String(e), stoppedByUser }
            }).catch(() => {});
        } finally {
            // Always clean up tabs and state — regardless of DB/broadcast errors
            this.stopKeepAlive();
            if (this.tabPool) {
                await this.tabPool.destroyAll();
                this.tabPool = null;
            }
            await this.clearPersistedState();
            this.isActive = false;
            this.state = null;
            this.previewTableId = null;
            this.previewSavedCount = 0;
        }
    }

    private broadcastProgress() {
        if (!this.state) return;

        const urlStatuses = this.state.urlStatuses;
        const completedUrls = urlStatuses.filter(u => u.status === 'done').length;
        const currentExtracting = urlStatuses.find(u => u.status === 'extracting');

        chrome.runtime.sendMessage({
            type: 'BULK_EXTRACTION_PROGRESS',
            payload: {
                jobId: this.state.jobId,
                completedUrls,
                totalUrls: urlStatuses.length,
                currentUrl: currentExtracting?.url,
                activeTabs: this.tabPool?.activeCount || 0,
                urlStatuses: urlStatuses.map(u => ({ url: u.url, status: u.status, error: u.error })),
                previewTableId: this.previewTableId
            },
            timestamp: Date.now()
        }).catch(() => { /* sidepanel may not be open */ });
    }

    private async persistState() {
        if (!this.state) return;
        await chrome.storage.local.set({
            [STORAGE_KEY]: {
                jobId: this.state.jobId,
                urlStatuses: this.state.urlStatuses.map(u => ({ url: u.url, status: u.status, error: u.error })),
                resultCount: this.state.results.length,
                isRunning: this.state.isRunning,
                startTime: this.state.startTime,
                // Everything below exists so a killed service worker can resume the run.
                elements: this.elements,
                config: this.config,
                finalColumns: this.state.finalColumns,
                previewTableId: this.previewTableId,
                openTabs: this.tabPool?.getState().map(t => ({ tabId: t.tabId, windowId: t.windowId, isPopup: t.isPopup })) ?? []
            }
        });
    }

    private async clearPersistedState() {
        await chrome.storage.local.remove([STORAGE_KEY]);
    }

    private startKeepAlive() {
        // MV3 kills an idle SW after ~30 s and clamps alarms to ≥30 s, so an alarm
        // alone cannot keep the worker alive. Any extension-API call resets the idle
        // timer, so ping one every 20 s while a run is active. The alarm stays as a
        // resurrection backstop: if the SW dies anyway, the alarm re-spawns it and
        // module-level recovery resumes the run.
        if (this.keepAliveInterval === null) {
            this.keepAliveInterval = setInterval(() => { void chrome.runtime.getPlatformInfo(); }, 20_000);
        }
        chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
    }

    private stopKeepAlive() {
        if (this.keepAliveInterval !== null) {
            clearInterval(this.keepAliveInterval);
            this.keepAliveInterval = null;
        }
        chrome.alarms.clear(KEEPALIVE_ALARM);
    }

    /**
     * Called by the background script's alarm listener. If the SW was killed
     * mid-run, this alarm is what re-spawned it — try to recover the run.
     */
    handleKeepAliveAlarm() {
        if (this.isActive) return;
        this.recoverIfNeeded().catch(e => console.error('[Orchestrator] Recovery from alarm failed:', e));
    }

    /**
     * Resumes (or finalizes) a run whose service worker died mid-extraction.
     * Safe to call any time: no-ops when a run is active or nothing was persisted.
     */
    async recoverIfNeeded(): Promise<void> {
        if (this.isActive) return;
        const data = await chrome.storage.local.get([STORAGE_KEY]);
        const saved = data[STORAGE_KEY] as any;
        if (!saved?.isRunning || !saved.jobId) return;
        if (this.isActive) return; // re-check: a start() may have won the race during the await

        console.warn(`[Orchestrator] Found interrupted run (job ${saved.jobId}) — recovering`);

        // Close tabs/popup windows orphaned by the previous worker instance.
        for (const t of saved.openTabs ?? []) {
            try {
                if (t.isPopup) await chrome.windows.remove(t.windowId);
                else await chrome.tabs.remove(t.tabId);
            } catch { /* already gone */ }
        }

        const statuses: UrlStatus[] = (saved.urlStatuses ?? []).map((u: any) => ({
            url: u.url,
            // URLs that were mid-extraction when the SW died go back in the queue.
            status: u.status === 'extracting' ? 'queued' : u.status,
            error: u.error
        }));
        const pending = statuses.filter(u => u.status === 'queued').length;

        if (pending === 0 || !Array.isArray(saved.elements) || saved.elements.length === 0) {
            // Nothing left to do (or not enough info to resume) — finalize so the job
            // doesn't sit in 'running' forever and the sidepanel stops waiting.
            console.warn(`[Orchestrator] Cannot resume job ${saved.jobId} (pending: ${pending}) — marking as failed`);
            try {
                await db.updateJob(saved.jobId, {
                    status: 'failed',
                    stats: {
                        startTime: saved.startTime,
                        endTime: Date.now(),
                        itemsExtracted: saved.resultCount ?? 0,
                        pagesVisited: statuses.filter(u => u.status === 'done').length,
                        errors: statuses.filter(u => u.status === 'error').length
                    }
                });
            } catch (e) {
                console.error('[Orchestrator] Failed to finalize interrupted job:', e);
            }
            await this.clearPersistedState();
            chrome.alarms.clear(KEEPALIVE_ALARM);
            chrome.runtime.sendMessage({
                type: 'BULK_EXTRACTION_COMPLETE',
                payload: {
                    jobId: saved.jobId,
                    tableDataId: saved.previewTableId ?? undefined,
                    totalItems: saved.resultCount ?? 0,
                    success: false,
                    error: 'Extraction was interrupted and could not be resumed',
                    stoppedByUser: false
                },
                timestamp: Date.now()
            }).catch(() => { /* sidepanel may not be open */ });
            return;
        }

        // Rebuild in-memory state and resume the remaining queue. Rows already
        // flushed to the preview table survive; the dataHash dedup index absorbs
        // any overlap from re-extracting a URL that was mid-flight.
        this.isActive = true;
        this.shouldStop = false;
        this.elements = saved.elements;
        this.config = saved.config ?? {};
        this.previewTableId = saved.previewTableId ?? null;
        this.previewSavedCount = 0;
        this.state = {
            jobId: saved.jobId,
            urlStatuses: statuses,
            results: [],
            finalColumns: saved.finalColumns ?? [],
            isRunning: true,
            startTime: saved.startTime ?? Date.now()
        };

        this.startKeepAlive();

        const viewportWidth = this.config.viewportWidth || 800;
        const viewportHeight = this.config.viewportHeight || 600;
        const tabLoadTimeout = this.config.loadTimeout || 30000;
        const shouldWaitForLoad = this.config.waitForLoad !== false;
        const deviceMemoryGB = (navigator as any).deviceMemory ?? 4;
        const cpuCores = navigator.hardwareConcurrency ?? 4;
        const concurrency = Math.max(1, Math.min(Math.floor(deviceMemoryGB), Math.floor(cpuCores / 2), 5));
        this.tabPool = new TabPool(concurrency, viewportWidth, viewportHeight, tabLoadTimeout, shouldWaitForLoad);
        this.tabPool.setOnTabRemoved((tabId) => this.handleTabClosed(tabId));

        console.log(`[Orchestrator] Resuming job ${saved.jobId}: ${pending} URL(s) remaining`);
        this.broadcastProgress();

        this.executeExtraction().catch(err => {
            console.error('[Orchestrator] Fatal error during resumed run:', err);
            this.finishExtraction(true, err.message);
        });
    }
}
