/**
 * Runs a multi-URL job in the background service worker: one tab pool, workers pulling from a queue,
 * the page-verdict policy (challenge, rate limit, dead page), a live preview table, the final table,
 * the job record, progress broadcasts, and recovery after a service-worker restart.
 *
 * What a job does on each page (and which columns it produces) is a `RunJob`: see bulkJob.ts and
 * metadataJob.ts.
 */
import { send } from '../../shared/messages';
import type { UrlStatus } from '../../shared/messages';
import { db } from '../../shared/db';
import type { Column, RecipeSpec } from '../../shared/types/database';
import { classifyPage, collectPageSignals, PageClassification, VERDICT_LABELS } from '../../shared/verdict/classifyPage';
import { TabPool } from './TabPool';
import { buildFinalName, buildInitialName, buildPreviewName } from './naming';
import { storage } from '../../shared/storage';
import { stepStats, StepResult } from '../../shared/listing/stepStats';

export type RunKind = 'bulk' | 'metadata';
type Row = Record<string, any>;

/** Pacing, tab and verdict settings shared by every job. */
export interface RunSettings {
    requestDelay?: number;
    enableRandomization?: boolean;
    /** Minimum gap between two pages of the same host. */
    domainMinGapMs?: number;
    /** Show a bot-check page to the user and wait for them to solve it (default on). */
    pauseOnChallenge?: boolean;
    challengeTimeoutMs?: number;
    viewportWidth?: number;
    viewportHeight?: number;
    loadTimeout?: number;
    waitForLoad?: boolean;
}

export interface RunContext {
    stopped(): boolean;
    /** Sends to the page's content script, retrying while it connects. */
    message: TabPool['sendMessage'];
}

export interface RunJob {
    kind: RunKind;
    urls: string[];
    maxConcurrent?: number;
    settings: RunSettings;
    /**
     * The run clicks: its hidden tabs get `visible-shim.js` (they animate and load as visible ones),
     * and a page whose clicks had no effect there is read again in a parked window.
     */
    interactive?: boolean;
    /** Continue an existing job instead of creating one. */
    jobId?: number;
    name?: string;
    /** What the run extracts: saved as its recipe (the same spec is the same recipe). */
    spec: RecipeSpec;
    /** The table's `source`. */
    tableType: string;
    /** The table's columns, from the columns the pages reported so far. */
    columns(found: Column[]): Column[];
    /** The page's rows (each gets `source_url`); null when it yielded nothing. Throw to fail the page. */
    extract(tabId: number, url: string, ctx: RunContext): Promise<{ rows: Row[]; columns?: Column[]; needsWindow?: boolean; steps?: StepResult[] } | null>;
}

interface UrlState extends UrlStatus {
    tabId?: number;
    attempts?: number;
    /** Read in a parked window: its clicks did nothing in a hidden tab. */
    window?: boolean;
    /** Page Extractor: how each recipe step went on this page. */
    steps?: StepResult[];
}

const SHIM_ID = 'crawlpilot-visible-shim';
/** Pages whose clicks needed a window before every later page of the run opens in one. */
const WINDOW_AFTER = 2;

/** Registers the visible-tab shim for the run's hosts (`public/visible-shim.js`); false without access. */
async function registerShim(urls: string[]): Promise<void> {
    await unregisterShim();
    const hosts = [...new Set(urls.map(u => { try { const x = new URL(u); return `${x.protocol}//${x.hostname}/*`; } catch { return ''; } }).filter(Boolean))];
    if (hosts.length === 0) return;
    try {
        await chrome.scripting.registerContentScripts([{
            id: SHIM_ID, js: ['visible-shim.js'], matches: hosts, runAt: 'document_start', world: 'MAIN', allFrames: false, persistAcrossSessions: false,
        } as chrome.scripting.RegisteredContentScript]);
    } catch (e) {
        console.warn('[run] Visible-tab shim not registered (no access to these hosts?):', e);
    }
}

async function unregisterShim(): Promise<void> {
    try {
        if ((await chrome.scripting.getRegisteredContentScripts({ ids: [SHIM_ID] })).length > 0) await chrome.scripting.unregisterContentScripts({ ids: [SHIM_ID] });
    } catch { /* nothing registered */ }
}

interface RunState {
    jobId: number;
    urls: UrlState[];
    rows: Row[];
    columns: Column[];
    startTime: number;
}

const MESSAGES = {
    bulk: { progress: 'BULK_EXTRACTION_PROGRESS', complete: 'BULK_EXTRACTION_COMPLETE' },
    metadata: { progress: 'METADATA_EXTRACTION_PROGRESS', complete: 'METADATA_EXTRACTION_COMPLETE' },
} as const;

/** How long to leave a host alone after it rate-limits or queues us (doubles per attempt). */
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 5 * 60_000;
/** Retries per URL for verdicts that clear up with time (rate_limited, waiting_room). */
const MAX_RETRY_ATTEMPTS = 2;
const CHALLENGE_POLL_MS = 3000;
const CHALLENGE_TIMEOUT_MS = 3 * 60_000;
/** Rows a preview save waits for (except the last). */
const PREVIEW_BATCH = 3;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function hostOf(url: string): string {
    try { return new URL(url).host; } catch { return url; }
}

/** One tab per GB of RAM, at most half the cores, at most 5. */
function defaultConcurrency(): number {
    const memoryGB = (navigator as any).deviceMemory ?? 4;
    const cores = navigator.hardwareConcurrency ?? 4;
    return Math.max(1, Math.min(Math.floor(memoryGB), Math.floor(cores / 2), 5));
}

export class JobRunner {
    private job: RunJob | null = null;
    private state: RunState | null = null;
    private tabPool: TabPool | null = null;
    private stopping = false;
    private previewTableId: number | null = null;
    private previewSaved = 0;
    // Workers save previews from their finally blocks concurrently; the chain keeps two of them
    // from both creating a preview table or racing on `previewSaved`.
    private previewChain: Promise<void> = Promise.resolve();
    /** Earliest time the next page of a host may start (per-host gap and backoff). */
    private hostNextAllowed = new Map<string, number>();

    constructor(private kind: RunKind) { }

    private get storageKey() { return `${this.kind}_extraction_state` as const; }
    private get alarmName() { return `${this.kind}_extraction_keepalive`; }

    /** Pages of this run that needed a window; past WINDOW_AFTER, every page opens in one. */
    private windowPages = 0;

    get running(): boolean {
        return this.job !== null;
    }

    async start(job: RunJob): Promise<{ jobId: number; originalCount: number; uniqueCount: number }> {
        if (this.job) throw new Error('An extraction is already in progress');
        if (job.urls.length === 0) throw new Error('No URLs provided');

        const urls = Array.from(new Set(job.urls));
        this.job = job;
        this.stopping = false;
        try {
            const jobId = await this.createJob(job, urls);
            this.previewTableId = null;
            this.previewSaved = 0;
            this.previewChain = Promise.resolve();
            this.hostNextAllowed.clear();
            this.state = { jobId, urls: urls.map(url => ({ url, status: 'queued' })), rows: [], columns: [], startTime: Date.now() };
            await this.persist();
            chrome.alarms.create(this.alarmName, { periodInMinutes: 0.4 });

            const s = job.settings;
            this.tabPool = new TabPool(job.maxConcurrent ?? defaultConcurrency(), s.viewportWidth || 800, s.viewportHeight || 600, s.loadTimeout || 30000, s.waitForLoad !== false);
            this.tabPool.setOnTabRemoved(tabId => this.tabClosed(tabId));
            this.windowPages = 0;
            if (job.interactive) await registerShim(urls);

            this.run().catch(err => {
                console.error(`[${this.kind} run] Fatal error:`, err);
                void this.finish(true, err.message);
            });
            return { jobId, originalCount: job.urls.length, uniqueCount: urls.length };
        } catch (e) {
            this.job = null;
            throw e;
        }
    }

    async stop() {
        this.stopping = true;
        if (this.tabPool) this.tabPool.shouldStop = true;
    }

    private async createJob(job: RunJob, urls: string[]): Promise<number> {
        const stats = { startTime: Date.now(), itemsExtracted: 0, pagesVisited: 0, errors: 0 };
        if (job.jobId) {
            await db.jobs.update(job.jobId, { status: 'running', stats });
            return job.jobId;
        }
        const name = job.name || buildInitialName(urls);
        const now = Date.now();
        const recipe = await db.jobs.saveRecipe(name, job.spec);
        return db.jobs.create({
            recipeId: recipe.id, recipeRev: recipe.rev, name, status: 'running',
            input: { urls, ...(job.maxConcurrent ? { concurrency: job.maxConcurrent } : {}) },
            stats, createdAt: now, updatedAt: now,
        });
    }

    private async run() {
        if (!this.state || !this.tabPool) return;
        const queue = this.state.urls.map(u => u.url);
        const workers = Math.min(this.tabPool.availableSlots + this.tabPool.activeCount, queue.length);
        const running: Promise<void>[] = [];
        for (let i = 0; i < workers; i++) {
            // Stagger startup so tab/window creation doesn't all land in one tick.
            if (i > 0) await sleep(400);
            running.push(this.worker(queue));
        }
        await Promise.all(running);
        await this.finish(this.stopping);
    }

    private async worker(queue: string[]) {
        while (!this.stopping) {
            const url = queue.shift();
            if (!url) break;
            await this.waitForHost(url);
            if (this.stopping) break;
            if (await this.processUrl(url) === 'retry') queue.push(url);
        }
    }

    /** Waits until the host's backoff / minimum gap has passed, then reserves the next slot. */
    private async waitForHost(url: string) {
        const host = hostOf(url);
        while (!this.stopping) {
            const wait = (this.hostNextAllowed.get(host) ?? 0) - Date.now();
            if (wait <= 0) break;
            await sleep(Math.min(wait, 1000));
        }
        const gap = Number(this.job?.settings.domainMinGapMs) || 0;
        if (gap > 0) this.hostNextAllowed.set(host, Math.max(this.hostNextAllowed.get(host) ?? 0, Date.now() + gap));
    }

    private backOff(url: string, attempt: number) {
        const host = hostOf(url);
        const ms = Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), BACKOFF_MAX_MS);
        this.hostNextAllowed.set(host, Math.max(this.hostNextAllowed.get(host) ?? 0, Date.now() + ms));
        console.warn(`[${this.kind} run] Backing off ${host} for ${ms / 1000}s`);
    }

    private async classify(tabId: number, url: string): Promise<PageClassification | null> {
        try {
            const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: collectPageSignals });
            return res?.result ? classifyPage(res.result as any, url) : null;
        } catch {
            return null;
        }
    }

    /** Shows a bot-check tab to the user and waits until it clears, times out, or the run stops. */
    private async waitForChallenge(tabId: number, url: string, status: UrlState): Promise<PageClassification | null> {
        status.status = 'waiting';
        this.broadcast();
        try {
            const tab = await chrome.tabs.get(tabId);
            await chrome.windows.update(tab.windowId, { focused: true });
            await chrome.tabs.update(tabId, { active: true });
        } catch { /* tab gone: the poll below gives up */ }

        const deadline = Date.now() + (Number(this.job?.settings.challengeTimeoutMs) || CHALLENGE_TIMEOUT_MS);
        let last: PageClassification | null = null;
        while (!this.stopping && Date.now() < deadline) {
            await sleep(CHALLENGE_POLL_MS);
            last = await this.classify(tabId, url);
            if (!last || last.verdict !== 'challenge') break;
        }
        status.status = 'extracting';
        this.broadcast();
        return last;
    }

    /** Walls and dead pages would be saved as junk rows: extract, retry later, or skip. */
    private async verdict(tabId: number, url: string, status: UrlState): Promise<'extract' | 'retry' | 'skip'> {
        let check = await this.classify(tabId, url);
        if (!check) return 'extract';
        if (check.verdict === 'challenge' && this.job?.settings.pauseOnChallenge !== false) {
            check = await this.waitForChallenge(tabId, url, status);
            if (!check) return 'extract';
        }
        status.verdict = check.verdict;
        if (check.verdict === 'ok') return 'extract';

        const label = VERDICT_LABELS[check.verdict];
        status.error = check.reason ? `${label}: ${check.reason}` : label;
        if (check.verdict === 'rate_limited' || check.verdict === 'waiting_room') {
            const attempt = (status.attempts ?? 0) + 1;
            status.attempts = attempt;
            this.backOff(url, attempt);
            if (attempt <= MAX_RETRY_ATTEMPTS && !this.stopping) return 'retry';
        }
        return 'skip';
    }

    private async processUrl(url: string): Promise<'retry' | void> {
        const { state, tabPool, job } = this;
        if (!state || !tabPool || !job) return;
        const status = state.urls.find(u => u.url === url);
        if (!status) return;

        status.status = 'extracting';
        this.broadcast();
        let tabId: number | null = null;

        try {
            const mode = status.window || this.windowPages >= WINDOW_AFTER ? 'window' : 'background';
            tabId = await tabPool.acquireTab(url, mode);
            if (tabId === null && !this.stopping) {
                // Pool full or content script not ready: one more try.
                await sleep(2000);
                tabId = await tabPool.acquireTab(url, mode);
            }
            if (tabId === null) {
                throw new Error(this.stopping ? 'Extraction stopped' : `Could not open the page: ${tabPool.lastFailure || 'unknown reason'}`);
            }
            status.tabId = tabId;
            tabPool.markExtracting(tabId);

            const decision = await this.verdict(tabId, url, status);
            if (decision === 'retry') {
                status.status = 'queued';
                return 'retry';
            }
            if (decision === 'skip') {
                status.status = 'error';
                return;
            }

            const page = await job.extract(tabId, url, { stopped: () => this.stopping, message: tabPool.sendMessage.bind(tabPool) });
            // Its clicks did nothing in a hidden tab: read it again in a parked window (once).
            if (page?.needsWindow && mode === 'background' && job.interactive) {
                status.window = true;
                this.windowPages++;
                status.status = 'queued';
                return 'retry';
            }
            if (page?.steps) status.steps = page.steps;
            if (!page || page.rows.length === 0) {
                status.status = 'error';
                status.error = 'No data extracted';
                return;
            }
            page.columns?.forEach(c => { if (!state.columns.some(k => k.id === c.id)) state.columns.push(c); });
            state.rows.push(...page.rows.map(r => ({ ...r, source_url: url })));
            status.status = 'done';
        } catch (err: any) {
            console.error(`[${this.kind} run] ${url}:`, err?.message);
            status.status = 'error';
            status.error = err?.message;
        } finally {
            if (tabId !== null) await tabPool.releaseTab(tabId);
            this.broadcast();
            await this.persist();
            this.previewChain = this.previewChain
                .then(() => this.savePreview())
                .catch(e => console.warn(`[${this.kind} run] Preview save failed:`, e));

            let delay = job.settings.requestDelay ?? 1000;
            if (job.settings.enableRandomization && delay > 0) delay += Math.floor(Math.random() * delay * 0.5);
            if (delay > 0 && !this.stopping) await sleep(delay);
        }
    }

    private tableData(rows: Row[]) {
        const { state, job } = this;
        return {
            type: job!.tableType,
            items: rows,
            columns: job!.columns(state!.columns),
            source_url: state!.urls[0]?.url || '',
            count: state!.rows.length,
            timestamp: new Date().toISOString(),
        };
    }

    /** Appends new rows to the live preview table (created on the first save). */
    private async savePreview() {
        const { state } = this;
        if (!state) return;
        const fresh = state.rows.slice(this.previewSaved);
        if (fresh.length === 0) return;
        const finished = state.urls.filter(u => u.status === 'done' || u.status === 'error').length;
        if (fresh.length < PREVIEW_BATCH && finished < state.urls.length) return;

        const done = state.urls.filter(u => u.status === 'done').length;
        const name = buildPreviewName(state.urls.map(u => u.url), done, state.urls.length);
        const id = await db.tables.save(this.tableData(fresh), {
            name, jobId: state.jobId, preview: true, ...(this.previewTableId !== null ? { tableId: this.previewTableId } : {}),
        });
        if (this.previewTableId === null) this.previewTableId = id;
        this.previewSaved = state.rows.length;
        this.broadcast();
    }

    private tabClosed(tabId: number) {
        const status = this.state?.urls.find(u => u.tabId === tabId && u.status === 'extracting');
        if (!status) return;
        status.status = 'error';
        status.error = 'Tab was closed during extraction';
        status.tabId = undefined;
        this.broadcast();
    }

    private verdictCounts(): Record<string, number> {
        const counts: Record<string, number> = {};
        for (const u of this.state?.urls ?? []) if (u.verdict) counts[u.verdict] = (counts[u.verdict] ?? 0) + 1;
        return counts;
    }

    /** Promotes the preview table to the final one (or saves it), closes the job, and cleans up. */
    private async finish(stoppedByUser: boolean, error?: string) {
        const { state, job } = this;
        if (!state || !job) return;
        await unregisterShim();
        await this.previewChain.catch(() => undefined);

        const { jobId, urls, rows, startTime } = state;
        const done = urls.filter(u => u.status === 'done').length;
        const errors = urls.filter(u => u.status === 'error').length;
        // Every page failed: the run failed, with the first page's reason (never "completed, 0 rows").
        if (!error && !stoppedByUser && done === 0 && errors > 0) {
            const first = urls.find(u => u.status === 'error')?.error;
            error = errors === urls.length && first ? `Every page failed. First error: ${first}` : `No page could be read (${errors} failed).`;
        }
        let tableId: number | undefined;

        try {
            if (rows.length > 0) {
                const name = buildFinalName(urls.map(u => u.url), done);
                if (this.previewTableId !== null) {
                    const unsaved = rows.slice(this.previewSaved);
                    if (unsaved.length > 0) await db.tables.appendRows(this.previewTableId, unsaved);
                    await db.tables.setColumns(this.previewTableId, job.columns(state.columns));
                    await db.tables.update(this.previewTableId, {
                        name,
                        source: job.tableType,
                        preview: false,
                    });
                    tableId = this.previewTableId;
                } else {
                    tableId = await db.tables.save(this.tableData(rows), { name, jobId });
                }
            }

            await db.jobs.update(jobId, {
                status: stoppedByUser ? 'stopped' : error ? 'failed' : 'completed',
                tableId,
                ...(error ? { error } : {}),
                stats: {
                    startTime, endTime: Date.now(), itemsExtracted: rows.length, pagesVisited: done, errors, stoppedByUser, verdicts: this.verdictCounts(),
                    ...(urls.some(u => u.steps) ? { steps: stepStats(urls.filter(u => u.steps)) } : {}),
                },
            });
            void send(MESSAGES[this.kind].complete, { jobId, tableId, totalItems: rows.length, success: !error && !stoppedByUser, error, stoppedByUser });
        } catch (e) {
            console.error(`[${this.kind} run] Finishing failed:`, e);
            void send(MESSAGES[this.kind].complete, { jobId, tableId, totalItems: rows.length, success: false, error: String(e), stoppedByUser });
        } finally {
            chrome.alarms.clear(this.alarmName);
            if (this.tabPool) {
                await this.tabPool.destroyAll();
                this.tabPool = null;
            }
            await storage.remove(this.storageKey);
            this.job = null;
            this.state = null;
            this.previewTableId = null;
            this.previewSaved = 0;
        }
    }

    private broadcast() {
        const { state } = this;
        if (!state) return;
        void send(MESSAGES[this.kind].progress, {
            jobId: state.jobId,
            completedUrls: state.urls.filter(u => u.status === 'done').length,
            totalUrls: state.urls.length,
            currentUrl: state.urls.find(u => u.status === 'extracting')?.url,
            activeTabs: this.tabPool?.activeCount || 0,
            urlStatuses: state.urls.map(({ url, status, error, verdict }) => ({ url, status, error, verdict })),
            verdicts: this.verdictCounts(),
            previewTableId: this.previewTableId,
        });
    }

    /** Saved so a restarted service worker can close the run's tabs and fail its job (see `recover`). */
    private async persist() {
        const { state } = this;
        if (!state) return;
        await storage.set(this.storageKey, {
            jobId: state.jobId,
            urlStatuses: state.urls.map(({ url, status, tabId }) => ({ url, status, tabId })),
            isRunning: true,
        });
    }

    /**
     * At service-worker startup: a run still marked running in storage was cut off (MV3 suspension,
     * crash, browser restart) and nothing will finish it. Closes its tabs, marks its job failed, and
     * clears the state.
     */
    async recover(): Promise<void> {
        const saved = await storage.get(this.storageKey);
        if (!saved?.isRunning || !saved.jobId) return;

        console.warn(`[${this.kind} run] Recovering interrupted job ${saved.jobId}`);
        for (const u of saved.urlStatuses ?? []) {
            if (u.status === 'extracting' && typeof u.tabId === 'number') {
                await chrome.tabs.remove(u.tabId).catch(() => undefined);
            }
        }
        await db.jobs.update(saved.jobId, {
            status: 'failed',
            error: 'Extraction interrupted — the browser or extension was restarted mid-run.',
            stats: { startTime: Date.now(), endTime: Date.now(), itemsExtracted: 0, stoppedByUser: false },
        }).catch(e => console.error(`[${this.kind} run] Could not mark job failed:`, e));
        await storage.remove(this.storageKey);
    }
}
