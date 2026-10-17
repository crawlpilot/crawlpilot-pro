import { useCallback } from 'react';
import { sendToTab } from '../../shared/messages';
import { useExtractionProcess } from './useExtractionProcess';
import { useBulkExtraction } from './useBulkExtraction';
import contentScriptPath from '../../content/element-selector?script';
import { isBulkJob, JobWithRecipe } from '../components/history/jobFilters';
import type { RerunOptions } from '../components/history/RerunDialog';

/**
 * Re-runs a saved job: opens (or navigates to) its page, makes sure the content script answers,
 * then starts a bulk run or a list extraction with the job's recipe.
 */
export function useJobRerun({ onStarted, onFinished }: { onStarted: (jobId: number) => void; onFinished: () => void }) {
    const { startExtraction, stopExtraction, status } = useExtractionProcess(() => onFinished(), jobId => onStarted(jobId));
    const { startBulkExtraction, stopBulkExtraction, hasCompleted, hasStopped } = useBulkExtraction();

    /** Wait for the active tab to finish loading & inject content script */
    const waitForTabReady = async (timeout = 15000): Promise<void> => {
        const start = Date.now();
        // Wait for tab to finish loading
        while (Date.now() - start < timeout) {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab?.status === 'complete' && tab?.url && !tab.url.startsWith('chrome://')) {
                break;
            }
            await new Promise(r => setTimeout(r, 300));
        }
        // Inject content script and verify connection
        await ensureContentScriptInjected();
    };

    /** Inject content script into active tab and verify it responds */
    const ensureContentScriptInjected = async (maxRetries = 5): Promise<void> => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) throw new Error('No active tab found');

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                // Try pinging first — if it responds, script is already there
                await sendToTab(tab.id, 'PING');
                return; // Connected!
            } catch {
                // Not injected yet — inject it
                try {
                    await chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        files: [contentScriptPath]
                    });
                } catch (injectErr) {
                    console.warn(`[Rerun] Injection attempt ${attempt + 1} failed:`, injectErr);
                }
                await new Promise(r => setTimeout(r, 600));
            }
        }
        // Final check
        try {
            const [finalTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (finalTab?.id) await sendToTab(finalTab.id, 'PING');
        } catch {
            throw new Error('Failed to establish connection with content script after navigation.');
        }
    };

    const rerun = useCallback(async (job: JobWithRecipe, options: RerunOptions) => {
        const config = job.configSnapshot || job.recipe?.config;
        if (!config) {
            alert("This job doesn't have enough configuration to re-run.");
            return;
        }
        try {
            if (job.id) onStarted(job.id);
            const isFullPageExtension = window.location.protocol === 'chrome-extension:';
            const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            const targetUrl = job.sourceUrl || (config.type === 'bulk-extraction' ? config.urls?.[0] : config.options?.url);

            if (isFullPageExtension && targetUrl) {
                    await chrome.tabs.create({ url: targetUrl, active: true });
                await waitForTabReady();
            } else if (activeTab && targetUrl && activeTab.url !== targetUrl) {
                    await chrome.tabs.update(activeTab.id!, { url: targetUrl });
                await waitForTabReady();
            } else {
                // Same URL — just ensure content script is injected
                await ensureContentScriptInjected();
            }

            // The tab after any navigation or new tab.
            const [finalActiveTab] = await chrome.tabs.query({ active: true, currentWindow: true });

            if (config.type === 'bulk-extraction') {
                const actions = config.options?.actions;
                const elements = actions?.[0]?.elements;
                const urls = config.urls;

                if (!elements || !urls || urls.length === 0) {
                    alert("This bulk extraction job doesn't have enough configuration to re-run.");
                    return;
                }

                await startBulkExtraction(urls, elements, {
                    recipeId: job.recipeId,
                    customName: options.name,
                    maxConcurrent: options.concurrent,
                    onStart: onStarted
                }).catch(err => {
                    console.error("Bulk re-run failed:", err);
                    alert("Bulk re-run failed: " + err.message);
                });
            } else {
                if (!config?.options?.fullSelectors || !config?.options?.pagination) {
                    alert("This job doesn't have enough configuration to re-run.");
                    return;
                }

                const sanitizedSelectors = config.options.fullSelectors.map((s: any) => ({
                    ...s,
                    sourceTabId: finalActiveTab?.id
                }));

                await startExtraction(
                    sanitizedSelectors,
                    config.options.pagination,
                    {
                        tableDataId: undefined, // Create NEW dataset
                        recipeId: job.recipeId, // REUSE existing recipe
                        customName: options.name,
                        maxPages: options.maxPages
                    }
                );
            }
        } catch (err) {
            console.error('Re-run failed:', err);
            alert('Re-run failed: ' + (err instanceof Error ? err.message : String(err)));
        } finally {
            onFinished();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [startBulkExtraction, startExtraction]);

    const stop = useCallback((job: JobWithRecipe) => (isBulkJob(job) ? stopBulkExtraction() : stopExtraction()), [stopBulkExtraction, stopExtraction]);

    return { rerun, stop, busy: status.isExtracting, bulkDone: hasCompleted || hasStopped };
}
