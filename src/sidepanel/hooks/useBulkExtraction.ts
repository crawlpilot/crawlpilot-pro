import { useState, useRef } from 'react';
import { db } from '../../shared/db/db-manager';

interface BulkExtractionOptions {
    useParallel?: boolean;
    maxConcurrent?: number;
    onProgress?: (completed: number) => void;
    onComplete?: (tableId: number) => void;
    onStart?: (jobId: number) => void;
    jobId?: number;
    recipeId?: number;
}

export function useBulkExtraction() {
    const [isExtracting, setIsExtracting] = useState(false);
    const [completedPages, setCompletedPages] = useState(0);
    const shouldStopRef = useRef(false);

    const stopBulkExtraction = () => {
        shouldStopRef.current = true;
    };

    const startBulkExtraction = async (
        urls: string[],
        elements: any[],
        options: BulkExtractionOptions = {}
    ) => {
        const {
            useParallel = false,
            maxConcurrent = 3,
            onProgress,
            onComplete,
            onStart,
            jobId: existingJobId,
            recipeId: passedRecipeId
        } = options;

        if (urls.length === 0 || elements.length === 0) return;

        setIsExtracting(true);
        setCompletedPages(0);
        shouldStopRef.current = false;

        const uniqueUrls = Array.from(new Set(urls));
        const allItems: any[] = [];
        const finalColumns: any[] = [];

        try {
            // Get settings
            const { extraction_settings: settings } = await chrome.storage.local.get(['extraction_settings']) as { extraction_settings?: any };
            const config = settings || { loadTimeout: 3000, requestDelay: 1000 };

            // Get active tab
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab?.id) throw new Error("No active tab");

            let jobId = existingJobId;
            let recipeId = passedRecipeId;
            let pageTitle = tab.title || (tab.url ? new URL(tab.url).hostname : 'Page Extractor');
            if (pageTitle.length > 50) pageTitle = pageTitle.substring(0, 47) + '...';

            const extractionAction = {
                type: 'EXTRACT_PAGES',
                elements: elements,
                config: config
            };

            if (!jobId) {
                if (!recipeId) {
                    recipeId = await db.createRecipe({
                        name: `Page Extraction - ${pageTitle}`,
                        description: "Auto-generated page extraction",
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
                    name: `Extraction - ${pageTitle}`,
                    status: 'running',
                    sourceUrl: tab.url || '',
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
                // Update existing job status
                await db.updateJob(jobId, {
                    status: 'running',
                    stats: {
                        startTime: Date.now(),
                        itemsExtracted: 0,
                        pagesVisited: 0,
                        errors: 0
                    }
                });
            }

            // [NEW] Trigger onStart immediately after job record is ready
            if (onStart && jobId) onStart(jobId);

            // Tab Load Helper
            const waitForTabLoaded = (tabId: number): Promise<void> => {
                return new Promise((resolve) => {
                    const cap = setTimeout(resolve, (config.loadTimeout || 10000) + 5000);
                    const onUpdated = (id: number, info: { status?: string }) => {
                        if (id === tabId && info.status === 'complete') {
                            clearTimeout(cap);
                            chrome.tabs.onUpdated.removeListener(onUpdated);
                            resolve();
                        }
                    };
                    chrome.tabs.onUpdated.addListener(onUpdated);
                    chrome.tabs.get(tabId, (t) => {
                        if (chrome.runtime.lastError) return;
                        if (t?.status === 'complete') {
                            clearTimeout(cap);
                            chrome.tabs.onUpdated.removeListener(onUpdated);
                            resolve();
                        }
                    });
                });
            };

            // Click Dispatcher
            const dispatchClickInTab = async (tabId: number, selector: string) => {
                try {
                    await chrome.scripting.executeScript({
                        target: { tabId },
                        func: (sel: string) => {
                            const el = document.querySelector(sel) as HTMLElement | null;
                            if (!el) return;
                            (['mouseover', 'mouseenter', 'mousemove', 'mousedown', 'mouseup', 'click'] as const)
                                .forEach(type => el.dispatchEvent(new MouseEvent(type, {
                                    bubbles: true, cancelable: true, view: window, button: 0
                                })));
                            if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) {
                                el.focus();
                                el.dispatchEvent(new Event('change', { bubbles: true }));
                            }
                        },
                        args: [selector]
                    });
                } catch (e) {
                    console.warn('[dispatchClickInTab] executeScript failed:', e);
                }
            };

            // Page Processor
            const processUrlOnTab = async (targetTabId: number, url: string) => {
                const batchRecordId = `rec_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
                let itemData: any = { source_url: url, recordId: batchRecordId };

                const sendMessageWithRetry = async (tabId: number, message: any, maxRetries = 10, interval = 500) => {
                    for (let attempt = 0; attempt < maxRetries; attempt++) {
                        if (shouldStopRef.current) break;
                        const response = await new Promise<any>((resolve) => {
                            chrome.tabs.sendMessage(tabId, message, (res) => {
                                if (chrome.runtime.lastError) {
                                    resolve({ success: false, error: chrome.runtime.lastError.message, isConnectionError: true });
                                } else {
                                    resolve(res);
                                }
                            });
                        });

                        if (response?.isConnectionError) {
                            await new Promise(r => setTimeout(r, interval));
                        } else {
                            return response;
                        }
                    }
                    return { success: false, error: 'Max retries reached.' };
                };

                for (const element of elements) {
                    if (shouldStopRef.current) break;

                    if (element.action === 'click') {
                        const clickSelector = element.selector || element.containerSelector;
                        if (clickSelector) {
                            await dispatchClickInTab(targetTabId, clickSelector);
                        }
                        await new Promise(resolve => setTimeout(resolve, config.requestDelay > 0 ? config.requestDelay * 2 : 2000));
                    } else {
                        const response = await sendMessageWithRetry(targetTabId, {
                            type: 'CMD_EXTRACT_PAGE',
                            payload: {
                                actionType: 'EXTRACT_PAGES',
                                url,
                                elements: [element],
                                config
                            }
                        });

                        if (response && response.success && response.result) {
                            const { item, items, columns: resultColumns } = response.result;
                            if (resultColumns && Array.isArray(resultColumns)) {
                                resultColumns.forEach((newCol: any) => {
                                    if (!finalColumns.find((c: any) => c.id === newCol.id)) {
                                        finalColumns.push(newCol);
                                    }
                                });
                            }
                            if (items && Array.isArray(items)) {
                                if (Array.isArray(itemData)) {
                                    itemData = items.map((newItem, idx) => ({
                                        ...(itemData[idx] || { recordId: batchRecordId }),
                                        ...newItem,
                                        recordId: batchRecordId
                                    }));
                                } else {
                                    const baseData = { ...itemData };
                                    itemData = items.map((newItem, idx) => ({
                                        ...(idx === 0 ? baseData : { recordId: batchRecordId }),
                                        ...newItem,
                                        recordId: batchRecordId
                                    }));
                                }
                            } else if (item) {
                                if (Array.isArray(itemData)) {
                                    itemData = itemData.map((row: any, idx: number) => ({
                                        ...row,
                                        ...(idx === 0 ? item : {})
                                    }));
                                } else {
                                    itemData = { ...itemData, ...item };
                                }
                            }
                        }
                        await new Promise(resolve => setTimeout(resolve, 300));
                    }
                }
                return itemData;
            };

            // Execution
            if (!useParallel) {
                for (let i = 0; i < uniqueUrls.length; i++) {
                    if (shouldStopRef.current) break;
                    const url = uniqueUrls[i];
                    await chrome.tabs.update(tab.id, { url });
                    await waitForTabLoaded(tab.id);
                    await new Promise(resolve => setTimeout(resolve, 500));
                    const extractedData = await processUrlOnTab(tab.id, url);
                    if (Array.isArray(extractedData)) allItems.push(...extractedData);
                    else allItems.push(extractedData);
                    const completed = i + 1;
                    setCompletedPages(completed);
                    if (onProgress) onProgress(completed);
                    if (i < uniqueUrls.length - 1 && config.requestDelay > 0) {
                        await new Promise(resolve => setTimeout(resolve, config.requestDelay));
                    }
                }
            } else {
                const queue = [...uniqueUrls];
                const worker = async () => {
                    while (queue.length > 0 && !shouldStopRef.current) {
                        const url = queue.shift();
                        if (!url) break;
                        let bgTabId: number | undefined;
                        try {
                            const bgTab = await chrome.tabs.create({ url, active: false });
                            bgTabId = bgTab.id;
                            if (!bgTabId) continue;
                            await waitForTabLoaded(bgTabId);
                            await chrome.tabs.update(bgTabId, { active: true });
                            await new Promise(r => setTimeout(r, 300));
                            await chrome.tabs.update(tab.id, { active: true });
                            await new Promise(r => setTimeout(r, 200));
                            const extractedData = await processUrlOnTab(bgTabId, url);
                            if (Array.isArray(extractedData)) allItems.push(...extractedData);
                            else allItems.push(extractedData);
                        } finally {
                            if (bgTabId) chrome.tabs.remove(bgTabId).catch(console.warn);
                            setCompletedPages(prev => {
                                const next = prev + 1;
                                if (onProgress) onProgress(next);
                                return next;
                            });
                        }
                    }
                };
                const workerCount = Math.min(maxConcurrent, uniqueUrls.length);
                await Promise.all(Array(workerCount).fill(null).map(() => worker()));
            }

            if (allItems.length > 0) {
                const finalData = {
                    type: 'bulk-page',
                    items: allItems,
                    columns: finalColumns,
                    source_url: uniqueUrls[0] + (uniqueUrls.length > 1 ? ` (+${uniqueUrls.length - 1} more)` : ''),
                    count: allItems.length,
                    timestamp: new Date().toISOString()
                };

                const tableId = await db.saveExtraction(finalData, {
                    name: `Bulk Extraction (${uniqueUrls.length} pages)`,
                    jobId: jobId
                });

                if (jobId) {
                    await db.updateJob(jobId, {
                        status: shouldStopRef.current ? 'paused' : 'completed',
                        result: { tableDataId: tableId },
                        stats: {
                            startTime: Date.now(),
                            endTime: Date.now(),
                            itemsExtracted: allItems.length,
                            pagesVisited: uniqueUrls.length,
                            stoppedByUser: shouldStopRef.current
                        }
                    });
                }
                if (onComplete) onComplete(tableId);
            } else if (jobId) {
                await db.updateJob(jobId, {
                    status: 'paused',
                    stats: {
                        startTime: Date.now(),
                        endTime: Date.now(),
                        itemsExtracted: 0,
                        pagesVisited: 0,
                        stoppedByUser: true
                    }
                });
            }

        } finally {
            setIsExtracting(false);
            setCompletedPages(0);
        }
    };

    return {
        isExtracting,
        completedPages,
        startBulkExtraction,
        stopBulkExtraction
    };
}
