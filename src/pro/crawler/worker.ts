/**
 * One job, start to end (`docs/design/crawler.md`):
 * 1. The recipe: the job's pinned version, or the `live` one for its competitor, page type and URL.
 * 2. The site's turn (`governor.ts`): wait a little, or put the job back when the site is cooling down.
 * 3. A proxy from the site's pool, sticky per site; robots.txt, when the site respects it.
 * 4. Visit, classify (`classify.ts`), and on a good page run the recipe in it (`inPage.ts`): a page recipe's
 *    fields, or a list recipe's rows (clicking through Load more and Next buttons). A list page's next page
 *    (by link) and its rows' details pages become follow-up jobs, pinned to the same version.
 * 5. The outcome goes to the governor (pace, cooldown, blocked) and the proxy pool (proxy health).
 * 6. Retry here, put back on the queue, or finish (`retry.ts`).
 * Every attempt writes a request event; a page read (or found gone) writes its scrape document (one per row
 * for a list), and a page recipe's read writes its selector usage. Those two are confirmed (`writes`): the queue
 * acknowledges the job only once Elasticsearch has them. Index names: `crawl-requests-YYYY.MM.DD`, `crawl-sites-YYYY.MM`,
 * `scrapes-<competitor>` and `selector-usage-YYYY.MM` (with `test-` in front in test mode).
 */
import { classify, classOf, CrawlError, keepHeaders, type Classification } from './classify';
import { siteProfile, type CrawlerConfig } from './config';
import { extract, readListPages, visit, type ListRead, type PageSource, type Visit } from './browser';
import type { SiteGovernor } from './governor';
import { ProxyPool, type ProxyConfig } from './proxies';
import { followUps, inPageRequest, partOf, readListRows, readRun, type RunRead } from './recipeRun';
import { decide } from './retry';
import type { RobotsCache } from './robots';
import type { SearchSink } from './search';
import type { RecipeStore, ResolvedRecipe } from './store';
import type { CrawlJob, RequestEvent, ScrapeDoc, SelectorUsageDoc, SiteEvent } from './types';
import type { Vitals } from './vitals';

export interface WorkerDeps {
    config: CrawlerConfig;
    store: RecipeStore;
    pages: PageSource;
    sink: SearchSink;
    governor: SiteGovernor;
    /** By pool name. */
    proxies: Map<string, ProxyPool>;
    robots: RobotsCache | null;
    /** The in-page script (`dist/inpage.js`). */
    script: string;
    /** Told when the browser fails or works (`vitals.ts`). */
    vitals?: Vitals;
    /** The worker is stopping: take no new attempt. */
    stopped?: () => boolean;
    /** The worker must stop now: an attempt in progress is abandoned and its job put back, not counted. */
    signal?: AbortSignal;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    random?: () => number;
}

export type JobResult =
    | { outcome: 'success' | 'failed' | 'dead_letter'; attempts: number; reason?: string; followUps?: CrawlJob[]; patch?: Partial<CrawlJob>;
        /** The job's scrape and usage documents, confirmed by Elasticsearch. */
        writes?: Promise<void>[] }
    | { outcome: 'deferred'; attempts: number; delayMs: number; reason: string; patch?: Partial<CrawlJob> };

const EXTRACT_TIMEOUT_MS = 60_000;
/** Waited for `load` after the page's DOM is in (`browser.ts`), and room for the rest of an attempt. */
const LOAD_WAIT_MS = 10_000;
const ATTEMPT_MARGIN_MS = 15_000;
/** A dead browser: the job comes back soon, to a browser started again (or another task). */
const BROWSER_DELAY_MS = 5_000;
const PAUSED_DELAY_MS = 10 * 60_000;

/** A store outage: 30 s, then doubling, up to 10 minutes, with jitter so jobs don't come back together. */
export function storeDelay(failures: number, random: () => number): number {
    const cap = Math.min(600_000, 30_000 * 2 ** (failures - 1));
    return Math.round(cap / 2 + random() * cap / 2);
}

const proxyOf = (proxy?: ProxyConfig) => proxy ? { proxyId: proxy.id, ...(proxy.country ? { proxyCountry: proxy.country } : {}) } : {};
/** A list page clicked through several times takes longer. */
const LIST_TIMEOUT_MS = 180_000;

const day = (t: number) => new Date(t).toISOString().slice(0, 10).replace(/-/g, '.');
const month = (t: number) => day(t).slice(0, 7);

export const indices = {
    requests: (t: number) => `crawl-requests-${day(t)}`,
    sites: (t: number) => `crawl-sites-${month(t)}`,
    scrapes: (job: CrawlJob) => `${job.mode === 'test' ? 'test-' : ''}scrapes-${job.competitor.toLowerCase()}`,
    usage: (job: CrawlJob, t: number) => `${job.mode === 'test' ? 'test-' : ''}selector-usage-${month(t)}`,
};

/** Site events from the governor, written to the sites index. */
export function siteEventWriter(sink: SearchSink, worker: string, now: () => number = Date.now) {
    return (e: Omit<SiteEvent, '@timestamp' | 'worker'>) => {
        const t = now();
        sink.write(indices.sites(t), { '@timestamp': new Date(t).toISOString(), worker, ...e } satisfies SiteEvent);
    };
}

export async function processJob(job: CrawlJob, d: WorkerDeps): Promise<JobResult> {
    const now = d.now ?? Date.now;
    const sleep = d.sleep ?? (ms => new Promise(r => setTimeout(r, ms)));
    const { config } = d;
    const mode = job.mode ?? 'prod';
    const before = job.attempts ?? 0;
    let host: string;
    try { host = new URL(job.url).host; } catch { return { outcome: 'failed', attempts: before, reason: `Not a URL: ${job.url}` }; }
    const profile = siteProfile(config, host);
    const pool = profile.proxyPool ? d.proxies.get(profile.proxyPool) : undefined;

    const base = (): Omit<RequestEvent, 'attempt' | 'final' | 'outcome' | 'timings' | 'errorClass'> => ({
        '@timestamp': new Date(now()).toISOString(),
        jobId: job.jobId, ...(job.runId ? { runId: job.runId } : {}),
        url: job.url, host, competitor: job.competitor, pageType: job.pageType, mode, worker: config.workerId,
    });
    const emit = (e: RequestEvent) => d.sink.write(indices.requests(now()), e);

    // Put back for too long (a site that stays blocked): for a person, not the queue, to decide.
    if (job.firstSeenAt !== undefined && now() - job.firstSeenAt > config.retry.maxJobAgeMs) {
        const message = `Put back for ${Math.round((now() - job.firstSeenAt) / 3_600_000)} h, past retry.maxJobAgeMs, after ${before} attempts`;
        emit({ ...base(), attempt: before, final: true, outcome: 'dead_letter', timings: { totalMs: 0 }, errorClass: 'expired', errorMessage: message });
        return { outcome: 'dead_letter', attempts: before, reason: `expired: ${message}` };
    }

    // 1. The recipe. A store outage or a paused recipe is not the job's: it waits, and no attempt is counted.
    let recipe: ResolvedRecipe;
    try {
        recipe = await d.store.recipeFor(job);
    } catch (e) {
        const c = e instanceof CrawlError ? classOf(e.errorClass) : classOf('recipe_store');
        const message = e instanceof Error ? e.message : String(e);
        if (c.errorClass === 'recipe_store' || c.errorClass === 'paused') {
            const failures = (job.storeFailures ?? 0) + 1;
            const delayMs = c.errorClass === 'paused' ? PAUSED_DELAY_MS : storeDelay(failures, d.random ?? Math.random);
            emit({ ...base(), attempt: before, final: true, outcome: 'deferred', timings: { totalMs: 0 }, errorClass: c.errorClass, errorMessage: message, nextAttemptInMs: delayMs });
            return { outcome: 'deferred', attempts: before, delayMs, reason: message, ...(c.errorClass === 'recipe_store' ? { patch: { storeFailures: failures } } : {}) };
        }
        const decision = decide(c, before + 1, config.retry, undefined, d.random);
        const outcome = decision.action === 'done' ? decision.outcome : 'deferred';
        emit({ ...base(), attempt: before + 1, final: true, outcome, timings: { totalMs: 0 }, errorClass: c.errorClass, errorMessage: message });
        if (decision.action === 'done') return { outcome: decision.outcome, attempts: before + 1, reason: message };
        return { outcome: 'deferred', attempts: before + 1, delayMs: decision.action === 'defer' ? decision.delayMs : decision.waitMs, reason: message };
    }
    // The store answered: a later outage starts its wait from the beginning again.
    const storeReset = job.storeFailures ? { patch: { storeFailures: 0 } } : {};
    const ref = { recipeId: recipe.recipeId, version: recipe.version, digest: recipe.digest };
    let part: ReturnType<typeof partOf>;
    try {
        part = partOf(recipe.spec, job);
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        emit({ ...base(), attempt: before + 1, final: true, outcome: 'dead_letter', timings: { totalMs: 0 }, errorClass: 'no_recipe', errorMessage: message, recipe: ref });
        return { outcome: 'dead_letter', attempts: before + 1, reason: message };
    }
    const request = 'page' in part ? inPageRequest(part.page, recipe.settings) : undefined;
    const failedProxies = new Set<string>();
    // How long one attempt may take, open to close: past it the page is closed and the attempt is a timeout.
    const attemptMs = config.navigationTimeoutMs + LOAD_WAIT_MS + config.settleMs + ('page' in part ? EXTRACT_TIMEOUT_MS : LIST_TIMEOUT_MS) + ATTEMPT_MARGIN_MS;
    let waitedBusy = 0;

    for (let attempt = before + 1; ; attempt++) {
        // Stopping (SIGTERM): what has not started goes back on the queue at once, its attempt not counted.
        if (d.stopped?.()) return { outcome: 'deferred', attempts: attempt - 1, delayMs: 0, reason: 'worker stopping', ...storeReset };

        // 2. The site's turn. A busy site is waited for a little, then the job goes back on the queue.
        const slot = d.governor.reserve(host);
        if ('deferMs' in slot) {
            if (slot.reason === 'busy' && waitedBusy + slot.deferMs <= config.retry.maxInlineWaitMs) {
                waitedBusy += slot.deferMs;
                await sleep(slot.deferMs);
                attempt--;
                continue;
            }
            return { outcome: 'deferred', attempts: attempt - 1, delayMs: slot.deferMs, reason: `site ${slot.reason}`, ...storeReset };
        }
        // From here the site's slot is held: it is given back exactly once, whatever happens.
        let released = false;
        const done = (cls: Classification) => { if (!released) { released = true; d.governor.done(host, cls); } };
        let c: Classification = classOf('unknown');
        let v: Visit = { redirects: [], navigationMs: 0 };
        let read: RunRead | undefined;
        let listRead: ListRead | undefined;
        let extractMs: number | undefined;
        let errorMessage: string | undefined;
        let proxy: ProxyConfig | undefined;
        let started = now();
        let aborted = false;
        try {
            if (slot.waitMs > 0) await sleep(slot.waitMs);
            started = now();

            // 3. A proxy, and robots.txt. Running out of proxies is no attempt at the page.
            if (pool) {
                proxy = pool.pick(host, profile.proxyCountry, failedProxies);
                if (!proxy) {
                    done(classOf('proxy'));
                    emit({ ...base(), attempt, final: true, outcome: 'deferred', timings: { totalMs: 0 }, errorClass: 'proxy', errorMessage: `No healthy proxy in pool ${profile.proxyPool}` });
                    return { outcome: 'deferred', attempts: attempt - 1, delayMs: 60_000, reason: 'no healthy proxy', ...storeReset };
                }
            }
            if (d.robots && profile.respectRobots !== false && !await d.robots.allowed(job.url).catch(() => true)) {
                const r = classOf('robots_disallowed');
                done(r);
                emit({ ...base(), ...proxyOf(proxy), attempt, final: true, outcome: 'failed', timings: { totalMs: now() - started }, errorClass: r.errorClass, errorMessage: 'robots.txt disallows this URL' });
                return { outcome: 'failed', attempts: attempt, reason: 'robots.txt', ...storeReset };
            }

            // 4. Visit, classify, extract, within the attempt's deadline, unless the worker must stop first.
            let timedOut = false;
            try {
                const { page, release } = await d.pages.open(host, profile, proxy);
                const deadline = setTimeout(() => { timedOut = true; void page.close().catch(() => {}); }, attemptMs);
                const abandon = () => { aborted = true; void page.close().catch(() => {}); };
                if (d.signal?.aborted) abandon(); else d.signal?.addEventListener('abort', abandon, { once: true });
                try {
                    v = await visit(page, job.url, { timeoutMs: config.navigationTimeoutMs, settleMs: config.settleMs, now });
                    c = classify({ error: v.error, status: v.status, headers: v.headers, title: v.title, text: v.text }, now());
                    errorMessage = v.error;
                    if (c.errorClass === 'none') {
                        const t = now();
                        try {
                            if ('page' in part) read = readRun(part.page, v.finalUrl ?? job.url, await extract(page, d.script, request!, EXTRACT_TIMEOUT_MS));
                            else listRead = await readListPages(page, d.script, part.list, { maxPages: config.maxListPages, settleMs: config.settleMs, timeoutMs: LIST_TIMEOUT_MS });
                            // The recipe's page rules and identity check class the page: a block page is a block, a gone product is not found.
                            if (read?.verdict) {
                                c = classOf(read.verdict.errorClass, read.verdict.errorClass === 'blocked' ? { blockSignal: read.verdict.message } : {});
                                errorMessage = read.verdict.message;
                            }
                        } catch (e) {
                            c = classify({ error: e instanceof Error ? e.message : String(e) });
                            if (c.errorClass === 'unknown') c = classOf('extraction');
                            errorMessage = e instanceof Error ? e.message : String(e);
                        }
                        extractMs = now() - t;
                    }
                } finally {
                    clearTimeout(deadline);
                    d.signal?.removeEventListener('abort', abandon);
                    await release();
                }
            } catch (e) {
                // The browser failed: it crashed, could not start, or a page or context could not be made.
                errorMessage = e instanceof Error ? e.message : String(e);
                c = classify({ error: errorMessage });
                if (c.errorClass === 'unknown') c = classOf('browser');
            }
            // A page the deadline closed is a timeout, whatever its pending calls failed with.
            if (timedOut) {
                c = classOf('timeout');
                errorMessage = `The attempt took longer than ${attemptMs} ms; the page was closed`;
            }
        } catch (e) {
            done(classOf('unknown'));
            throw e;
        }

        // Abandoned as the worker stops: not the page's doing, so the job goes back at once, uncounted.
        if (aborted) {
            done(classOf('unknown'));
            emit({ ...base(), ...proxyOf(proxy), attempt, final: true, outcome: 'deferred', timings: { totalMs: now() - started }, errorClass: 'unknown', errorMessage: 'worker stopping: attempt abandoned', nextAttemptInMs: 0, recipe: ref });
            return { outcome: 'deferred', attempts: attempt - 1, delayMs: 0, reason: 'worker stopping', ...storeReset };
        }

        // The browser, not the page: no attempt is counted, and the worker is told, so a browser that keeps
        // failing gets the task replaced.
        if (c.errorClass === 'browser') {
            done(c);
            d.vitals?.browserFailed();
            emit({ ...base(), ...proxyOf(proxy), attempt, final: true, outcome: 'deferred', timings: { totalMs: now() - started }, errorClass: 'browser', errorMessage: errorMessage?.slice(0, 500), nextAttemptInMs: BROWSER_DELAY_MS, recipe: ref });
            return { outcome: 'deferred', attempts: attempt - 1, delayMs: BROWSER_DELAY_MS, reason: `browser: ${errorMessage?.slice(0, 200) ?? ''}`, ...storeReset };
        }
        d.vitals?.browserWorked();

        // 5. What it means for the site and the proxy.
        done(c);
        if (proxy) pool?.report(proxy.id, c.errorClass);
        if (proxy && ProxyPool.isProxyFault(c.errorClass)) failedProxies.add(proxy.id);
        const site = d.governor.stateOf(host);
        const decision = decide(c, attempt, config.retry, site.state !== 'ok' ? Math.max(0, site.cooldownUntil - now()) : undefined, d.random);

        // A list page's next page and details pages, once it is done.
        const next = decision.action === 'done' && listRead && 'list' in part
            ? followUps(job, part.list, ref, listRead, { maxPages: config.maxListPages, details: config.followDetails })
            : [];
        const rows = listRead ? listRead.lists.reduce((n, l) => n + l.rows.length, 0) : undefined;

        // 6. The request event, then retry, defer or finish.
        const final = decision.action !== 'retry';
        const outcome: RequestEvent['outcome'] = decision.action === 'done' ? decision.outcome : decision.action === 'defer' ? 'deferred' : 'retry';
        const kept = v.headers ? keepHeaders(v.headers) : undefined;
        emit({
            ...base(), ...proxyOf(proxy), attempt, final, outcome,
            ...(v.finalUrl ? { finalUrl: v.finalUrl } : {}),
            ...(v.status !== undefined ? { status: v.status } : {}),
            ...(kept ? kept : {}),
            ...(v.requestHeaders ? { requestHeaders: v.requestHeaders } : {}),
            ...(v.redirects.length ? { redirects: v.redirects } : {}),
            ...(v.bytes !== undefined ? { bytes: v.bytes } : {}),
            timings: { totalMs: now() - started, navigationMs: v.navigationMs, ...(extractMs !== undefined ? { extractMs } : {}) },
            errorClass: c.errorClass,
            ...(errorMessage ? { errorMessage: errorMessage.slice(0, 500) } : {}),
            ...(c.blockSignal ? { blockSignal: c.blockSignal } : {}),
            ...(c.retryAfterMs !== undefined ? { retryAfterMs: c.retryAfterMs } : {}),
            ...(decision.action === 'retry' ? { nextAttemptInMs: decision.waitMs } : decision.action === 'defer' ? { nextAttemptInMs: decision.delayMs } : {}),
            recipe: ref,
            ...(read ? { fieldsFilled: read.filled, fieldsTotal: read.total } : {}),
            ...(listRead ? { rows, listPages: listRead.pages, followUps: next.length } : {}),
        });

        if (decision.action === 'done') {
            const t = now();
            const crawledAt = new Date(t).toISOString();
            const writes: Promise<void>[] = [];
            // Awaited by the queue; a rejection before then is not an unhandled one.
            const confirm = (w: Promise<void>) => { w.catch(() => {}); writes.push(w); };
            const scrape = (extra: Partial<ScrapeDoc>): ScrapeDoc => ({
                jobId: job.jobId, ...(job.runId ? { runId: job.runId } : {}), url: job.url, finalUrl: v.finalUrl ?? job.url,
                competitor: job.competitor, pageType: job.pageType, mode, crawledAt, pageStatus: c.pageStatus, ...ref,
                attributes: {}, fieldStatus: {}, ...(job.meta ? { meta: job.meta } : {}), ...(job.parent ? { parent: job.parent } : {}), ...extra,
            });
            if (listRead && 'list' in part) {
                for (const r of readListRows(part.list, listRead.lists).rows) {
                    confirm(d.sink.writeConfirmed(indices.scrapes(job), scrape({ attributes: r.attributes, fieldStatus: r.fieldStatus, listId: r.listId, row: r.index, page: job.page ?? 1 }), `${job.jobId}~${r.listId}~${r.index}`));
                }
            } else if (read || c.pageStatus === 'not_found') {
                // A verdict's page is written with its status only: what was read is not this product's.
                confirm(d.sink.writeConfirmed(indices.scrapes(job), scrape(read && !read.verdict ? { attributes: read.attributes, fieldStatus: read.fieldStatus } : {}), job.jobId));
            }
            if (read && !read.verdict) {
                confirm(d.sink.writeConfirmed(indices.usage(job, t), {
                    jobId: job.jobId, crawledAt, competitor: job.competitor, pageType: job.pageType, pageStatus: c.pageStatus, ...ref, ways: read.ways,
                } satisfies SelectorUsageDoc, job.jobId));
            }
            return {
                outcome: decision.outcome, attempts: attempt, ...storeReset,
                ...(decision.outcome !== 'success' ? { reason: errorMessage ? `${c.errorClass}: ${errorMessage.slice(0, 200)}` : c.errorClass } : {}),
                ...(next.length ? { followUps: next } : {}),
                ...(writes.length ? { writes } : {}),
            };
        }
        if (decision.action === 'defer') return { outcome: 'deferred', attempts: attempt, delayMs: decision.delayMs, reason: c.errorClass, ...storeReset };
        if (d.stopped?.()) return { outcome: 'deferred', attempts: attempt, delayMs: 0, reason: 'worker stopping', ...storeReset };
        await sleep(decision.waitMs);
    }
}
