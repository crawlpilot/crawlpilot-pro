import { TabPool } from './TabPool';
import { db } from '../../shared/db/db-manager';
import type { MetadataExtractOptions, MetadataExtractResult, HtmlMetadata } from '../../shared/types/metadata';
import { buildInitialName, buildFinalName, buildPreviewName } from '../../shared/utils/run-naming';
import { classifyPage, collectPageSignals, PageVerdict, VERDICT_LABELS } from '../../shared/verdict/classifyPage';

const STORAGE_KEY = 'metadata_extraction_state';
const KEEPALIVE_ALARM = 'metadata_extraction_keepalive';

export interface MetadataExtractionConfig {
    urls: string[];
    options: MetadataExtractOptions;
    maxConcurrent?: number;
    requestDelay?: number;
    loadTimeout?: number;
    customName?: string;
}

interface UrlStatus {
    url: string;
    status: 'queued' | 'extracting' | 'done' | 'error';
    error?: string;
    tabId?: number;
    verdict?: PageVerdict;
}

interface ExtractionState {
    jobId: number;
    urlStatuses: UrlStatus[];
    results: any[];
    isRunning: boolean;
    startTime: number;
}

const BASE_RESULT_COLUMNS = [
    { id: 'source_url', name: 'Source URL', type: 'url' as const, order: 0 },
    { id: 'title', name: 'Title', type: 'text' as const, order: 1 },
    { id: 'author', name: 'Author', type: 'text' as const, order: 2 },
    { id: 'description', name: 'Description', type: 'text' as const, order: 3 },
    { id: 'publishedDate', name: 'Published Date', type: 'text' as const, order: 4 },
    { id: 'pageType', name: 'Page Type', type: 'text' as const, order: 5 },
    { id: 'extractionQuality', name: 'Quality', type: 'text' as const, order: 6 },
    { id: 'keywords', name: 'Keywords', type: 'text' as const, order: 7 },
    { id: 'canonicalUrl', name: 'Canonical URL', type: 'url' as const, order: 8 },
    { id: 'siteName', name: 'Site Name', type: 'text' as const, order: 9 },
    { id: 'imageUrl', name: 'Image URL', type: 'url' as const, order: 10 },
    { id: 'markdown',     name: 'Content (Markdown)', type: 'markdown' as const, order: 11 },
    { id: 'language',     name: 'Language',           type: 'text' as const,     order: 12 },
    { id: 'wordCount',    name: 'Word Count',          type: 'text' as const,     order: 13 },
    { id: 'readingTime',  name: 'Reading Time',        type: 'text' as const,     order: 14 },
];

function getResultColumns(options: MetadataExtractOptions) {
    if (!options.outputText) return BASE_RESULT_COLUMNS;
    return [
        ...BASE_RESULT_COLUMNS,
        { id: 'text', name: 'Raw Text', type: 'text' as const, order: 12 },
    ];
}

function resultToRow(url: string, result: MetadataExtractResult, options: MetadataExtractOptions): Record<string, any> {
    const meta: HtmlMetadata = result.metadata ?? { keywords: [] };

    const textForCount = result.text
        ?? result.markdown.replace(/[#*`_~\[\]!|>\\]/g, ' ').replace(/https?:\/\/\S+/g, '');
    const wordCount = textForCount.trim().split(/\s+/).filter(w => w.length > 0).length;

    return {
        source_url: url,
        title: meta.title ?? '',
        author: meta.author ?? '',
        description: meta.description ?? '',
        publishedDate: meta.publishedDate ?? '',
        pageType: result.pageType,
        extractionQuality: result.extractionQuality.toFixed(2),
        keywords: (meta.keywords ?? []).join(', '),
        canonicalUrl: meta.canonicalUrl ?? '',
        siteName: meta.siteName ?? '',
        imageUrl: meta.imageUrl ?? '',
        markdown: result.markdown,
        language: result.language ?? meta.language ?? '',
        wordCount: wordCount > 0 ? String(wordCount) : '',
        readingTime: wordCount > 0 ? `${Math.max(1, Math.ceil(wordCount / 200))} min` : '',
        ...(options.outputText ? { text: result.text ?? '' } : {}),
    };
}

export class MetadataExtractionOrchestrator {
    private tabPool: TabPool | null = null;
    private state: ExtractionState | null = null;
    private shouldStop = false;
    private options: MetadataExtractOptions = {};
    private requestDelay = 1000;
    private isActive = false;
    private previewTableId: number | null = null;
    private previewSavedCount = 0;
    // Single-flight chain — see BulkExtractionOrchestrator for why this is needed:
    // concurrent workers calling savePreview() unserialized can create duplicate preview
    // tables and race on previewSavedCount.
    private previewChain: Promise<void> = Promise.resolve();

    async start(config: MetadataExtractionConfig): Promise<{ jobId: number; uniqueCount: number }> {
        if (this.isActive) throw new Error('A metadata extraction is already in progress');

        const { urls, options, maxConcurrent, requestDelay = 1000, loadTimeout = 30000, customName } = config;

        const deviceMemoryGB = (navigator as any).deviceMemory ?? 4;
        const cpuCores = navigator.hardwareConcurrency ?? 4;
        const safeConcurrent = Math.max(1, Math.min(Math.floor(deviceMemoryGB), Math.floor(cpuCores / 2), 5));
        const concurrency = maxConcurrent ?? safeConcurrent;

        if (urls.length === 0) throw new Error('No URLs provided');

        this.isActive = true;
        this.shouldStop = false;
        this.options = options;
        this.requestDelay = requestDelay;

        const uniqueUrls = Array.from(new Set(urls));

        const jobName = customName || buildInitialName(uniqueUrls);

        const recipeId = await db.createRecipe({
            name: jobName,
            description: 'Automatic metadata and content extraction',
            type: 'metadata-extraction',
            version: 1,
            config: { type: 'metadata-extraction', urls: uniqueUrls, options },
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });

        const jobId = await db.createJob({
            recipeId,
            name: jobName,
            status: 'running',
            sourceUrl: uniqueUrls[0],
            configSnapshot: { type: 'metadata-extraction', urls: uniqueUrls, options },
            stats: { startTime: Date.now(), itemsExtracted: 0, pagesVisited: 0, errors: 0 },
            createdAt: Date.now(),
            updatedAt: Date.now(),
        } as any);

        this.previewTableId = null;
        this.previewSavedCount = 0;
        this.previewChain = Promise.resolve();
        this.state = {
            jobId,
            urlStatuses: uniqueUrls.map(url => ({ url, status: 'queued' as const })),
            results: [],
            isRunning: true,
            startTime: Date.now(),
        };

        await this.persistState();
        this.startKeepAlive();

        this.tabPool = new TabPool(concurrency, 800, 600, loadTimeout, true);
        this.tabPool.setOnTabRemoved((tabId) => this.handleTabClosed(tabId));

        this.executeExtraction().catch(err => {
            console.error('[MetadataOrchestrator] Fatal error:', err);
            this.finishExtraction(true, err.message);
        });

        return { jobId, uniqueCount: uniqueUrls.length };
    }

    async stop() {
        this.shouldStop = true;
        if (this.tabPool) this.tabPool.shouldStop = true;
    }

    get running() { return this.isActive; }

    private async executeExtraction() {
        if (!this.state || !this.tabPool) return;

        const queue = this.state.urlStatuses.filter(u => u.status === 'queued').map(u => u.url);
        const maxWorkers = Math.min(this.tabPool.availableSlots + this.tabPool.activeCount, queue.length);

        const workers: Promise<void>[] = [];
        for (let i = 0; i < maxWorkers; i++) {
            // See BulkExtractionOrchestrator for why 400ms (was 1500ms).
            if (i > 0) await new Promise(r => setTimeout(r, 400));
            workers.push(this.worker(queue, i));
        }
        await Promise.all(workers);
        await this.finishExtraction(this.shouldStop);
    }

    private async worker(queue: string[], _workerId: number) {
        while (!this.shouldStop) {
            const url = queue.shift();
            if (!url) break;
            await this.processUrl(url);
        }
    }

    private async processUrl(url: string) {
        if (!this.state || !this.tabPool) return;

        const urlStatus = this.state.urlStatuses.find(u => u.url === url);
        if (!urlStatus) return;

        urlStatus.status = 'extracting';
        this.broadcastProgress();

        let tabId: number | null = null;

        try {
            tabId = await this.tabPool.acquireTab(url);
            if (tabId === null && !this.shouldStop) {
                await new Promise(r => setTimeout(r, 2000));
                tabId = await this.tabPool.acquireTab(url);
            }
            if (tabId === null) {
                throw new Error(this.shouldStop ? 'Extraction stopped' : 'Could not acquire tab');
            }

            urlStatus.tabId = tabId;
            this.tabPool.markExtracting(tabId);

            // Skip walls and dead pages: their titles and descriptions would be saved as junk rows.
            try {
                const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: collectPageSignals });
                if (res?.result) {
                    const check = classifyPage(res.result as any, url);
                    urlStatus.verdict = check.verdict;
                    if (check.verdict !== 'ok') {
                        const label = VERDICT_LABELS[check.verdict];
                        throw new Error(check.reason ? `${label}: ${check.reason}` : label);
                    }
                }
            } catch (e: any) {
                if (urlStatus.verdict && urlStatus.verdict !== 'ok') throw e;
                /* page could not be checked: extract anyway */
            }

            const response = await this.tabPool.sendMessage(tabId, {
                type: 'CMD_EXTRACT_METADATA',
                payload: { url, options: { ...this.options, url } }
            });

            if (!response?.success || !response.result) {
                throw new Error(response?.error || 'No result from content script');
            }

            const row = resultToRow(url, response.result as MetadataExtractResult, this.options);
            this.state.results.push(row);
            urlStatus.status = 'done';
        } catch (err: any) {
            console.error(`[MetadataOrchestrator] Error processing ${url}:`, err.message);
            urlStatus.status = 'error';
            urlStatus.error = err.message;
        } finally {
            if (tabId !== null) await this.tabPool.releaseTab(tabId);
            this.broadcastProgress();
            await this.persistState();
            this.previewChain = this.previewChain
                .then(() => this.savePreview())
                .catch(() => {});

            if (this.requestDelay > 0 && !this.shouldStop) {
                await new Promise(r => setTimeout(r, this.requestDelay));
            }
        }
    }

    private async savePreview() {
        if (!this.state || this.state.results.length === 0) return;

        const newItems = this.state.results.slice(this.previewSavedCount);
        if (newItems.length === 0) return;

        const totalUrls = this.state.urlStatuses.length;
        const completedSoFar = this.state.urlStatuses.filter(u => u.status === 'done' || u.status === 'error').length;
        const isLastBatch = completedSoFar >= totalUrls;
        if (newItems.length < 3 && !isLastBatch) return;

        const completedCount = this.state.urlStatuses.filter(u => u.status === 'done').length;
        const name = buildPreviewName(this.state.urlStatuses.map(u => u.url), completedCount, totalUrls);

        const previewData = {
            type: 'metadata-extraction',
            items: newItems,
            columns: getResultColumns(this.options),
            source_url: this.state.urlStatuses[0]?.url || '',
            count: this.state.results.length,
            timestamp: new Date().toISOString(),
        };

        if (this.previewTableId === null) {
            this.previewTableId = await db.saveExtraction(previewData, {
                name,
                jobId: this.state.jobId,
                isPreview: true,
            });
        } else {
            await db.saveExtraction(previewData, {
                tableDataId: this.previewTableId,
                name,
                jobId: this.state.jobId,
                isPreview: true,
            });
        }

        this.previewSavedCount = this.state.results.length;
        this.broadcastProgress();
    }

    private handleTabClosed(tabId: number) {
        if (!this.state) return;
        const urlStatus = this.state.urlStatuses.find(u => u.tabId === tabId && u.status === 'extracting');
        if (urlStatus) {
            urlStatus.status = 'error';
            urlStatus.error = 'Tab was closed during extraction';
            urlStatus.tabId = undefined;
            this.broadcastProgress();
        }
    }

    private async finishExtraction(stoppedByUser: boolean, error?: string) {
        if (!this.state) return;

        // Wait for any in-flight savePreview() to settle before flushing below.
        await this.previewChain.catch(() => {});

        this.state.isRunning = false;
        const { jobId, urlStatuses, results, startTime } = this.state;
        const completedCount = urlStatuses.filter(u => u.status === 'done').length;

        let tableDataId: number | undefined;

        try {
            if (results.length > 0) {
                const finalName = buildFinalName(urlStatuses.map(u => u.url), completedCount);

                if (this.previewTableId !== null) {
                    const unsaved = results.slice(this.previewSavedCount);
                    if (unsaved.length > 0) {
                        await db.storeTableRowsBatch(this.previewTableId, unsaved);
                    }
                    await db.updateTableColumns(this.previewTableId, getResultColumns(this.options) as any);
                    await db.updateTableData(this.previewTableId, {
                        name: finalName,
                        metadata: { extractionType: 'metadata-extraction', totalRows: results.length, isPreview: false },
                    });
                    tableDataId = this.previewTableId;
                } else {
                    tableDataId = await db.saveExtraction(
                        {
                            type: 'metadata-extraction',
                            items: results,
                            columns: getResultColumns(this.options),
                            source_url: urlStatuses[0]?.url || '',
                            count: results.length,
                            timestamp: new Date().toISOString(),
                        },
                        { name: finalName, jobId }
                    );
                }
            }

            await db.updateJob(jobId, {
                status: stoppedByUser ? 'paused' : 'completed',
                result: tableDataId ? { tableDataId } : undefined,
                stats: { startTime, endTime: Date.now(), itemsExtracted: results.length, pagesVisited: completedCount, stoppedByUser },
            });

            chrome.runtime.sendMessage({
                type: 'METADATA_EXTRACTION_COMPLETE',
                payload: { jobId, tableDataId, totalItems: results.length, success: !error && !stoppedByUser, error, stoppedByUser },
                timestamp: Date.now(),
            }).catch(() => {});
        } catch (e) {
            console.error('[MetadataOrchestrator] finishExtraction error:', e);
            chrome.runtime.sendMessage({
                type: 'METADATA_EXTRACTION_COMPLETE',
                payload: { jobId, totalItems: results.length, success: false, error: String(e), stoppedByUser },
            }).catch(() => {});
        } finally {
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
        const { urlStatuses, jobId } = this.state;
        chrome.runtime.sendMessage({
            type: 'METADATA_EXTRACTION_PROGRESS',
            payload: {
                jobId,
                completedUrls: urlStatuses.filter(u => u.status === 'done').length,
                totalUrls: urlStatuses.length,
                activeTabs: this.tabPool?.activeCount || 0,
                urlStatuses: urlStatuses.map(u => ({ url: u.url, status: u.status, error: u.error, verdict: u.verdict })),
                previewTableId: this.previewTableId,
            },
            timestamp: Date.now(),
        }).catch(() => {});
    }

    private async persistState() {
        if (!this.state) return;
        await chrome.storage.local.set({
            [STORAGE_KEY]: {
                jobId: this.state.jobId,
                // tabId included so a post-SW-restart recovery pass can close any tabs
                // that were still open mid-extraction (otherwise they leak permanently).
                urlStatuses: this.state.urlStatuses.map(u => ({ url: u.url, status: u.status, tabId: u.tabId })),
                isRunning: this.state.isRunning,
                startTime: this.state.startTime,
            },
        });
    }

    private async clearPersistedState() {
        await chrome.storage.local.remove([STORAGE_KEY]);
    }

    private startKeepAlive() {
        chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.4 });
    }

    private stopKeepAlive() {
        chrome.alarms.clear(KEEPALIVE_ALARM);
    }

    handleKeepAliveAlarm() {
        if (this.isActive) console.log('[MetadataOrchestrator] Keep-alive ping — extraction active');
    }

    /**
     * Called once at service-worker startup — see BulkExtractionOrchestrator.checkForRecovery
     * for the full rationale. Closes any tabs left open by an interrupted metadata run,
     * marks the job failed, and clears the stale persisted state.
     */
    async checkForRecovery(): Promise<{ jobId: number; isRunning: boolean } | null> {
        const data = await chrome.storage.local.get([STORAGE_KEY]);
        const state = data[STORAGE_KEY] as {
            jobId?: number;
            isRunning?: boolean;
            urlStatuses?: { url: string; status: string; tabId?: number }[];
        } | undefined;

        if (!state || !state.isRunning || !state.jobId) return null;

        console.warn(`[MetadataOrchestrator] Recovering from interrupted metadata extraction (job ${state.jobId}) — service worker was likely restarted mid-run.`);

        const leakedTabIds = (state.urlStatuses || [])
            .filter(u => u.status === 'extracting' && typeof u.tabId === 'number')
            .map(u => u.tabId as number);

        for (const tabId of leakedTabIds) {
            try {
                await chrome.tabs.remove(tabId);
            } catch {
                // Tab already closed by the browser — nothing to do.
            }
        }

        try {
            await db.updateJob(state.jobId, {
                status: 'failed',
                error: 'Extraction interrupted — the browser or extension was restarted mid-run.',
                stats: { startTime: Date.now(), endTime: Date.now(), itemsExtracted: 0, stoppedByUser: false }
            });
        } catch (e) {
            console.error('[MetadataOrchestrator] Failed to mark interrupted job as failed:', e);
        }

        await this.clearPersistedState();
        return { jobId: state.jobId, isRunning: true };
    }
}
