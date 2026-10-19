import { useCallback } from 'react';
import { send, sendToTab } from '../../shared/messages';
import { useExtractionProcess } from './useExtractionProcess';
import { useBulkExtraction } from './useBulkExtraction';
import contentScriptPath from '../../content/element-selector?script';
import { isBulkJob, JobWithRecipe } from '../components/history/jobFilters';
import { listRunInput, pageRunInput } from '../../shared/recipes/spec';
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

    /** Reruns a job with its recipe as it is now (edits and healed selectors included) on the job's pages. */
    const rerun = useCallback(async (job: JobWithRecipe, options: RerunOptions) => {
        const spec = job.recipe?.spec;
        if (!spec) {
            alert("This job's recipe is gone, so it can't be re-run.");
            return;
        }
        try {
            if (job.id) onStarted(job.id);
            const urls = job.input?.urls ?? [];
            const targetUrl = urls[0];
            const isFullPageExtension = window.location.protocol === 'chrome-extension:';
            const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

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

            if (spec.kind === 'page') {
                if (urls.length === 0 || spec.elements.length === 0) {
                    alert("This bulk extraction job doesn't have enough configuration to re-run.");
                    return;
                }
                const { elements } = pageRunInput(spec);
                await startBulkExtraction(urls, elements, {
                    customName: options.name,
                    maxConcurrent: options.concurrent,
                    onStart: onStarted
                }).catch(err => {
                    console.error("Bulk re-run failed:", err);
                    alert("Bulk re-run failed: " + err.message);
                });
            } else if (spec.kind === 'list') {
                const { picks, pagination } = listRunInput(spec, options.maxPages);
                await startExtraction(
                    picks.map(p => ({ ...p, sourceTabId: finalActiveTab?.id })),
                    pagination,
                    { customName: options.name, maxPages: options.maxPages }
                );
            } else if (spec.kind === 'contacts') {
                const res = await send('CONTACTS_START', { urls, follow: spec.options.follow, ownOnly: spec.options.ownOnly, maxConcurrent: options.concurrent, customName: options.name });
                if (!res?.success) alert('Re-run failed: ' + (res && !res.success ? res.error : 'the background is not reachable'));
                else onStarted(res.jobId);
            } else {
                alert('Metadata runs are re-run from the Metadata page.');
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
