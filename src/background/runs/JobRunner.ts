/**
 * Runs a multi-URL job in the background service worker: one tab pool, workers pulling from a queue,
 * the page-verdict policy (challenge, rate limit, dead page), a live preview table, the final table,
 * the job record, progress broadcasts, and recovery after a service-worker restart.
 *
 * What a job does on each page (and which columns it produces) is a `RunJob`: see bulkJob.ts and
 * metadataJob.ts.
 */
import { defaultConcurrency } from '../../shared/utils/concurrency';
import { send } from '../../shared/messages';
import type { UrlStatus } from '../../shared/messages';
import { db } from '../../shared/db';
import type { Column, RecipeSpec } from '../../shared/types/database';
import { classifyPage, collectPageSignals, PageClassification, VERDICT_LABELS } from '../../shared/verdict/classifyPage';
import { learnCareful, siteOf, siteRun, siteSettings } from '../../shared/sites/siteSettings';
import { TabPool } from './TabPool';
import { buildFinalName, buildInitialName, buildPreviewName } from './naming';
import { storage } from '../../shared/storage';
import { stepStats, StepResult } from '../../shared/listing/stepStats';

export type RunKind = 'bulk' | 'metadata' | 'contacts' | 'api';
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
    /** How long a page has to show its content (waitForElements' timeout, a list page's list). */
    elementTimeout?: number;
    waitForElements?: boolean;
    /** A login page pauses like a bot check (the site's "Pause" choice): the user signs in in the tab. */
    pauseOnLogin?: boolean;
}

export interface RunContext {
    stopped(): boolean;
    /** The run's settings, the site's applied (its page wait reaches the page this way). */
    settings: RunSettings;
    /** Sends to the page's content script, retrying while it connects. */
    message: TabPool['sendMessage'];
    /** Rows read so far on a long unit (an API run's pages): saved and shown before the unit ends. */
    emit(rows: Row[], columns?: Column[]): void;
}

export interface RunJob {
    kind: RunKind;
    urls: string[];
    maxConcurrent?: number;
    settings: RunSettings;
    /** The run clicks: a page whose clicks had no effect in a hidden tab is read again in a parked window. */
    interactive?: boolean;
    /**
     * Every unit is read through one tab at this page, opened once and kept to the end (an API run:
     * its units are calls sent from the site's page, not pages to open). No page verdicts.
     */
    via?: string;
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
    /** After the run's table is saved, before "complete" is sent (a details run joins its rows onto its list). */
    afterSave?(tableId: number): Promise<void>;
    /** A unit no longer worth opening (numbered pages past the listing's end): dropped from the run. */
    skip?(url: string): boolean;
    /** A unit that failed (it didn't open, a wall, no data): numbered pages end there. */
    unitFailed?(url: string): void;
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
    /** Rows not yet saved to the preview table: saved rows leave memory (a long run stays small). */
    rows: Row[];
    /** Every row the run read so far, saved or not. */
    rowCount: number;
    columns: Column[];
    startTime: number;
}

const MESSAGES = {
    bulk: { progress: 'BULK_EXTRACTION_PROGRESS', complete: 'BULK_EXTRACTION_COMPLETE' },
    metadata: { progress: 'METADATA_EXTRACTION_PROGRESS', complete: 'METADATA_EXTRACTION_COMPLETE' },
    contacts: { progress: 'CONTACTS_PROGRESS', complete: 'CONTACTS_COMPLETE' },
    api: { progress: 'API_PROGRESS', complete: 'API_COMPLETE' },
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
/** The least time between two progress messages. */
const BROADCAST_MS = 250;
/** Easing off: the first pages set what "normal" opening time is on this computer. */
const BASELINE_PAGES = 3;
/** A page this many times slower to open than normal (and at least SLOW_MIN_MS) means the computer struggles. */
const SLOW_FACTOR = 3;
const SLOW_MIN_MS = 15_000;
/** Pages between two easings. */
const EASE_EVERY = 5;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function hostOf(url: string): string {
    try { return new URL(url).host; } catch { return url; }
}

/** One tab per GB of RAM, at most half the cores, at most 5. */

export class JobRunner {
    private job: RunJob | null = null;
    private state: RunState | null = null;
    private tabPool: TabPool | null = null;
    private stopping = false;
    private previewTableId: number | null = null;
    private lastBroadcast = 0;
    /** Workers allowed to take pages; lowered when the computer struggles (`easeOff`). */
    private workerLimit = 1;
    private liveWorkers = 0;
    /** How long each page took to open, in order: the first ones are this computer's normal. */
    private openTimes: number[] = [];
    private eased: { to: number; reason: string } | null = null;
    private easedAtPage = -Infinity;
    private broadcastTimer: ReturnType<typeof setTimeout> | null = null;
    // Workers save previews from their finally blocks concurrently; the chain keeps two of them
    // from both creating a preview table or saving the same rows.
    private previewChain: Promise<void> = Promise.resolve();
    /** Earliest time the next page of a host may start (per-host gap and backoff). */
    private hostNextAllowed = new Map<string, number>();
    /** The one tab a `via` run sends everything from (opened on first use). */
    private viaTab: Promise<number> | null = null;

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
        // The site's settings (speed, page wait, walls), set once for every recipe of the site, win over the run's.
        const site = await siteSettings(siteOf(urls[0]));
        if (site) {
            const s = siteRun(site);
            job = {
                ...job,
                maxConcurrent: s.tabs,
                settings: {
                    ...job.settings,
                    requestDelay: s.delayMs,
                    elementTimeout: s.pageWaitMs,
                    pauseOnChallenge: s.onWall === 'pause',
                    pauseOnLogin: s.onWall === 'pause',
                },
            };
        }
        this.job = job;
        this.stopping = false;
        try {
            const jobId = await this.createJob(job, urls);
            this.previewTableId = null;
            this.previewChain = Promise.resolve();
            this.hostNextAllowed.clear();
            this.viaTab = null;
            this.state = { jobId, urls: urls.map(url => ({ url, status: 'queued' })), rows: [], rowCount: 0, columns: [], startTime: Date.now() };
            await this.persist();
            chrome.alarms.create(this.alarmName, { periodInMinutes: 0.4 });

            const s = job.settings;
            this.tabPool = new TabPool(job.maxConcurrent ?? defaultConcurrency(), s.viewportWidth || 800, s.viewportHeight || 600, s.loadTimeout || 30000, s.waitForLoad !== false);
            this.tabPool.setOnTabRemoved(tabId => this.tabClosed(tabId));
            this.windowPages = 0;
            // Every run's hidden tabs behave as visible ones: an app that renders in animation frames or
            // waits to be seen (a product page's details) otherwise draws nothing until its tab is shown.
            await registerShim(urls);

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

    /**
     * Stops the run now: the run's tabs are closed, so whatever a page was doing (loading, its steps,
     * a message) ends at once instead of after it; those pages go back to the queue. False when no
     * run is going (the side panel then resets instead of waiting for an end that won't come).
     */
    async stop(): Promise<boolean> {
        if (!this.job) return false;
        this.stopping = true;
        await this.tabPool?.closeAll();
        this.broadcast();
        return true;
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
        this.workerLimit = workers;
        this.liveWorkers = 0;
        this.openTimes = [];
        this.eased = null;
        this.easedAtPage = -Infinity;
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
        this.liveWorkers++;
        try {
            while (!this.stopping) {
                // Fewer tabs at once since the computer struggled: this worker leaves its pages to the others.
                if (this.liveWorkers > this.workerLimit) break;
                const url = queue.shift();
                if (!url) break;
                if (this.job?.skip?.(url)) {
                    // Not read, not failed: no longer part of the run.
                    if (this.state) this.state.urls = this.state.urls.filter(u => u.url !== url);
                    this.broadcast();
                    continue;
                }
                await this.waitForHost(url);
                if (this.stopping) break;
                if (await this.processUrl(url) === 'retry') queue.push(url);
            }
        } finally {
            this.liveWorkers--;
        }
    }

    /**
     * One tab fewer at a time for the rest of the run (never below one), when the computer shows it
     * is short of memory or CPU: a page opening far slower than the run's first pages did, or Chrome
     * discarding or closing a run tab. At most once per EASE_EVERY pages, so one slow page doesn't
     * empty the pool.
     */
    private easeOff(reason: string) {
        const page = this.openTimes.length;
        if (this.workerLimit <= 1 || this.stopping || page - this.easedAtPage < EASE_EVERY) return;
        this.workerLimit--;
        this.easedAtPage = page;
        this.eased = { to: this.workerLimit, reason };
        console.warn(`[${this.kind} run] ${this.workerLimit} tab(s) at a time from now: ${reason}`);
    }

    /** Records how long a page took to open, and eases off when it is far slower than the first pages. */
    private noteOpen(ms: number) {
        this.openTimes.push(ms);
        if (this.openTimes.length <= BASELINE_PAGES) return;
        const normal = [...this.openTimes.slice(0, BASELINE_PAGES)].sort((a, b) => a - b)[Math.floor(BASELINE_PAGES / 2)];
        if (ms > Math.max(normal * SLOW_FACTOR, SLOW_MIN_MS)) {
            this.easeOff(`pages took ${Math.round(ms / 1000)} s to open (the first took ${Math.round(normal / 1000)} s)`);
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

    /** Shows a bot-check (or login) tab to the user and waits until it clears, times out, or the run stops. */
    private async waitForChallenge(tabId: number, url: string, status: UrlState, wall: 'challenge' | 'login_wall' = 'challenge'): Promise<PageClassification | null> {
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
            if (!last || last.verdict !== wall) break;
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
        // The site's "Pause" choice: a login page waits for the user to sign in in the tab, like a bot check.
        if (check.verdict === 'login_wall' && this.job?.settings.pauseOnLogin) {
            check = await this.waitForChallenge(tabId, url, status, 'login_wall');
            if (!check) return 'extract';
        }
        status.verdict = check.verdict;
        if (check.verdict === 'ok') return 'extract';

        const label = VERDICT_LABELS[check.verdict];
        status.error = check.reason ? `${label}: ${check.reason}` : label;
        // Rate-limited once: the site goes Careful for every later run (unless the user set its speed).
        if (check.verdict === 'rate_limited') void learnCareful(siteOf(url), check.reason || 'The site said too many requests');
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
        let emitted = 0;
        const ctx: RunContext = {
            stopped: () => this.stopping,
            settings: job.settings,
            message: tabPool.sendMessage.bind(tabPool),
            emit: (rows, columns) => {
                if (rows.length === 0) return;
                columns?.forEach(c => { if (!state.columns.some(k => k.id === c.id)) state.columns.push(c); });
                state.rows.push(...rows.map(r => ({ ...r, source_url: url })));
                state.rowCount += rows.length;
                emitted += rows.length;
                this.broadcast();
                this.previewChain = this.previewChain
                    .then(() => this.savePreview())
                    .catch(e => console.warn(`[${this.kind} run] Preview save failed:`, e));
            },
        };

        if (job.via) {
            try {
                const via = await this.sharedTab(job.via);
                // Kept on the status so a restarted worker closes it (`recover`).
                status.tabId = via;
                const page = await job.extract(via, url, ctx);
                page?.columns?.forEach(c => { if (!state.columns.some(k => k.id === c.id)) state.columns.push(c); });
                if (page?.rows.length) ctx.emit(page.rows);
                if (emitted === 0) {
                    status.status = 'error';
                    status.error = 'No data extracted';
                } else {
                    status.status = 'done';
                }
            } catch (err: any) {
                console.error(`[${this.kind} run] ${url}:`, err?.message);
                status.status = this.stopping ? 'queued' : 'error';
                status.error = this.stopping ? undefined : err?.message;
            } finally {
                this.broadcast();
                await this.persist();
                this.previewChain = this.previewChain
                    .then(() => this.savePreview())
                    .catch(e => console.warn(`[${this.kind} run] Preview save failed:`, e));
            }
            return;
        }

        try {
            const mode = status.window || this.windowPages >= WINDOW_AFTER ? 'window' : 'background';
            const opening = Date.now();
            tabId = await tabPool.acquireTab(url, mode);
            if (tabId !== null) this.noteOpen(Date.now() - opening);
            else if (/discarded|closed/.test(tabPool.lastFailure)) this.easeOff('Chrome discarded or closed a run tab');
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

            const page = await job.extract(tabId, url, ctx);
            // Its clicks did nothing in a hidden tab: read it again in a parked window (once).
            if (page?.needsWindow && mode === 'background' && job.interactive) {
                status.window = true;
                this.windowPages++;
                status.status = 'queued';
                return 'retry';
            }
            if (page?.steps) status.steps = page.steps;
            if (!page || page.rows.length + emitted === 0) {
                status.status = 'error';
                status.error = 'No data extracted';
                return;
            }
            page.columns?.forEach(c => { if (!state.columns.some(k => k.id === c.id)) state.columns.push(c); });
            state.rows.push(...page.rows.map(r => ({ ...r, source_url: url })));
            state.rowCount += page.rows.length;
            status.status = 'done';
        } catch (err: any) {
            console.error(`[${this.kind} run] ${url}:`, err?.message);
            // A page cut short by a stop is not a failed page.
            status.status = this.stopping ? 'queued' : 'error';
            status.error = this.stopping ? undefined : err?.message;
        } finally {
            if (tabId !== null) await tabPool.releaseTab(tabId);
            if (status.status === 'error') job.unitFailed?.(url);
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

    /** The `via` run's tab, opened at its page once; opened again if it was closed. */
    private sharedTab(page: string): Promise<number> {
        this.viaTab ??= (async () => {
            const tabId = await this.tabPool!.acquireTab(page, 'background');
            if (tabId === null) throw new Error(`Could not open ${page}: ${this.tabPool!.lastFailure || 'unknown reason'}`);
            this.tabPool!.markExtracting(tabId);
            return tabId;
        })();
        this.viaTab.catch(() => { this.viaTab = null; });
        return this.viaTab;
    }

    private tableData(rows: Row[]) {
        const { state, job } = this;
        return {
            type: job!.tableType,
            items: rows,
            columns: job!.columns(state!.columns),
            source_url: state!.urls[0]?.url || '',
            count: state!.rowCount,
            timestamp: new Date().toISOString(),
        };
    }

    /** Appends new rows to the live preview table (created on the first save). */
    private async savePreview() {
        const { state } = this;
        if (!state) return;
        const fresh = state.rows.slice();
        if (fresh.length === 0) return;
        const finished = state.urls.filter(u => u.status === 'done' || u.status === 'error').length;
        if (fresh.length < PREVIEW_BATCH && finished < state.urls.length) return;

        const done = state.urls.filter(u => u.status === 'done').length;
        const name = buildPreviewName(state.urls.map(u => u.url), done, state.urls.length);
        const id = await db.tables.save(this.tableData(fresh), {
            name, jobId: state.jobId, preview: true, ...(this.previewTableId !== null ? { tableId: this.previewTableId } : {}),
        });
        if (this.previewTableId === null) this.previewTableId = id;
        // Rows read while this saved stay for the next save.
        state.rows.splice(0, fresh.length);
        this.broadcast();
    }

    private tabClosed(tabId: number) {
        void this.viaTab?.then(id => { if (id === tabId) this.viaTab = null; }, () => undefined);
        const status = this.state?.urls.find(u => u.tabId === tabId && (u.status === 'extracting' || u.status === 'waiting'));
        if (!status) return;
        // Closed by a stop: not read, not failed.
        if (!this.stopping) this.easeOff('a run tab was closed (Chrome may have run out of memory)');
        status.status = this.stopping ? 'queued' : 'error';
        status.error = this.stopping ? undefined : 'Tab was closed during extraction';
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

        const { jobId, urls, rows, rowCount, startTime } = state;
        const done = urls.filter(u => u.status === 'done').length;
        const errors = urls.filter(u => u.status === 'error').length;
        // Every page failed: the run failed, with the first page's reason (never "completed, 0 rows").
        if (!error && !stoppedByUser && done === 0 && errors > 0) {
            const first = urls.find(u => u.status === 'error')?.error;
            error = errors === urls.length && first ? `Every page failed. First error: ${first}` : `No page could be read (${errors} failed).`;
        }
        let tableId: number | undefined;
        // The final statuses before "complete": no progress message after it.
        this.sendProgress();

        try {
            if (rowCount > 0) {
                const name = buildFinalName(urls.map(u => u.url), done);
                if (this.previewTableId !== null) {
                    if (rows.length > 0) await db.tables.appendRows(this.previewTableId, rows);
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
            // The column setup of this recipe's last table (renames, cleaning, merges) carries over.
            if (tableId !== undefined) await db.jobs.carryColumnSetup(jobId, tableId).catch(e => console.warn(`[${this.kind} run] Column setup not carried:`, e));
            if (tableId !== undefined && job.afterSave) {
                try { await job.afterSave(tableId); } catch (e) { console.error(`[${this.kind} run] After save failed:`, e); }
            }

            await db.jobs.update(jobId, {
                status: stoppedByUser ? 'stopped' : error ? 'failed' : 'completed',
                tableId,
                ...(error ? { error } : {}),
                stats: {
                    startTime, endTime: Date.now(), itemsExtracted: rowCount, pagesVisited: done, errors, stoppedByUser, verdicts: this.verdictCounts(),
                    ...(urls.some(u => u.steps) ? { steps: stepStats(urls.filter(u => u.steps)) } : {}),
                    ...(this.eased ? { eased: this.eased } : {}),
                },
            });
            void send(MESSAGES[this.kind].complete, { jobId, tableId, totalItems: rowCount, success: !error && !stoppedByUser, error, stoppedByUser });
        } catch (e) {
            console.error(`[${this.kind} run] Finishing failed:`, e);
            void send(MESSAGES[this.kind].complete, { jobId, tableId, totalItems: rowCount, success: false, error: String(e), stoppedByUser });
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
        }
    }

    /**
     * Progress to the side panel, at most every BROADCAST_MS: each message carries every URL's
     * status, so on a long run (thousands of URLs, several tabs) a message per event is a lot of
     * copying for a slow computer. The latest state always follows within BROADCAST_MS.
     */
    private broadcast() {
        if (!this.state) return;
        const wait = BROADCAST_MS - (Date.now() - this.lastBroadcast);
        if (wait <= 0) { this.sendProgress(); return; }
        this.broadcastTimer ??= setTimeout(() => { this.broadcastTimer = null; this.sendProgress(); }, wait);
    }

    private sendProgress() {
        const { state } = this;
        if (this.broadcastTimer) { clearTimeout(this.broadcastTimer); this.broadcastTimer = null; }
        if (!state) return;
        this.lastBroadcast = Date.now();
        void send(MESSAGES[this.kind].progress, {
            jobId: state.jobId,
            completedUrls: state.urls.filter(u => u.status === 'done').length,
            totalUrls: state.urls.length,
            currentUrl: state.urls.find(u => u.status === 'extracting')?.url,
            activeTabs: this.tabPool?.activeCount || 0,
            urlStatuses: state.urls.map(({ url, status, error, verdict }) => ({ url, status, error, verdict })),
            verdicts: this.verdictCounts(),
            previewTableId: this.previewTableId,
            rows: state.rowCount,
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
