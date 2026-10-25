import { useCallback, useRef } from 'react';
import { db } from '../../shared/db';
import { itemUrlColumn, itemUrls } from '../../shared/listing/join';
import type { ListSpec } from '../../shared/types/database';
import { send, sendToTab } from '../../shared/messages';
import { useExtractionProcess } from './useExtractionProcess';
import { useBulkExtraction } from './useBulkExtraction';
import contentScriptPath from '../../content/element-selector?script';
import { isBulkJob, JobWithRecipe } from '../components/history/jobFilters';
import { listRunInput, pageRunInput } from '../../shared/recipes/spec';
import type { RunOptions, RunTarget } from '../components/history/RunDialog';

/**
 * Runs a saved (or ready-made) recipe on the pages given: a bulk run in background tabs, or a list
 * extraction on its start page once the content script there answers.
 */
export function useJobRerun({ onStarted, onFinished }: { onStarted: (jobId: number) => void; onFinished: () => void }) {
    /** A list with details: once the list is read again, its items' pages are read and joined onto it. */
    const pendingDetails = useRef<{ details: NonNullable<ListSpec['details']>; name: string; concurrent?: number } | null>(null);
    /** Only new items: the table of the run being repeated, whose items are left out of the new one. */
    const pendingOnlyNew = useRef<number | null>(null);
    const { startExtraction, stopExtraction, status } = useExtractionProcess(tableId => {
        void afterList(tableId).finally(onFinished);
    }, jobId => onStarted(jobId));

    /** The list read again: the items it had before left out (only new), then each item's page (details). */
    const afterList = async (tableId: number) => {
        const against = pendingOnlyNew.current;
        pendingOnlyNew.current = null;
        if (against !== null) {
            const table = await db.tables.get(tableId);
            if (table) {
                const rows = (await db.tables.rowsPage(tableId, 0, Math.max(table.rowCount, 1))).map(r => r.data);
                await db.tables.keepOnlyNew(tableId, against, itemUrlColumn(table.columns, rows));
            }
        }
        await readDetails(tableId);
    };
    const { startBulkExtraction, stopBulkExtraction, hasCompleted, hasStopped } = useBulkExtraction();

    /** The list's new rows' item links, run with the list's details recipe and joined onto the new table. */
    const readDetails = async (tableId: number) => {
        const pending = pendingDetails.current;
        pendingDetails.current = null;
        if (!pending) return;
        const table = await db.tables.get(tableId);
        if (!table) return;
        const rows = (await db.tables.rowsPage(tableId, 0, Math.max(table.rowCount, 1))).map(r => r.data);
        // The list's fields may have been edited since: its link column found again if needed.
        const urlColumn = table.columns.some(c => c.id === pending.details.urlColumn) ? pending.details.urlColumn : itemUrlColumn(table.columns, rows);
        if (!urlColumn) return;
        const urls = itemUrls(rows, urlColumn);
        if (urls.length === 0) return;
        const { elements, settings } = pageRunInput(pending.details.page);
        await startBulkExtraction(urls, elements, {
            // The details run's own settings (pace, waits, list output), as it was set up.
            ...(settings as Record<string, unknown>),
            customName: `${pending.name} · details`,
            maxConcurrent: pending.concurrent,
            joinInto: { tableId, urlColumn },
            onStart: onStarted,
        }).catch(err => console.error('Details re-run failed:', err));
    };

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

    /**
     * Runs a recipe (as it is now: edits and healed selectors included) on the pages the Run dialog
     * gives: page recipes in background tabs, a list on its start page in the active tab.
     */
    const rerun = useCallback(async (target: RunTarget, options: RunOptions) => {
        const { spec, job } = target;
        const urls = options.urls;
        try {
            if (job?.id) onStarted(job.id);
            // Ready-made: saved under its own name first; the run finds it by its spec and adds a run to it.
            if (target.readyMade) await db.jobs.saveRecipe(target.name, spec, { saved: true });

            if (spec.kind === 'page') {
                if (urls.length === 0 || spec.elements.length === 0) {
                    alert("This recipe doesn't have enough configuration to run.");
                    return;
                }
                const { elements, settings } = pageRunInput(spec);
                // The bulk runner opens its own tabs: the open page stays as it is.
                await startBulkExtraction(urls, elements, {
                    // The recipe's settings (pace, waits, viewport, list output), as it was set up.
                    ...(settings as Record<string, unknown>),
                    customName: options.name,
                    maxConcurrent: options.concurrent,
                    onStart: onStarted
                }).catch(err => {
                    console.error("Bulk re-run failed:", err);
                    alert("Bulk re-run failed: " + err.message);
                });
            } else if (spec.kind === 'list') {
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
                const { picks, pagination } = listRunInput(spec, options.maxPages);
                pendingDetails.current = spec.details ? { details: spec.details, name: options.name || target.name || 'List', concurrent: options.concurrent } : null;
                pendingOnlyNew.current = options.onlyNew && job?.tableId !== undefined ? job.tableId : null;
                await startExtraction(
                    picks.map(p => ({ ...p, sourceTabId: finalActiveTab?.id })),
                    pagination,
                    { customName: options.name, maxPages: options.maxPages }
                );
            } else if (spec.kind === 'contacts') {
                const res = await send('CONTACTS_START', { urls, follow: spec.options.follow, ownOnly: spec.options.ownOnly, maxConcurrent: options.concurrent, customName: options.name });
                if (!res?.success) alert('Re-run failed: ' + (res && !res.success ? res.error : 'the background is not reachable'));
                else onStarted(res.jobId);
            } else if (spec.kind === 'api') {
                const res = await send('API_START', { spec, units: urls, maxConcurrent: options.concurrent, customName: options.name });
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
