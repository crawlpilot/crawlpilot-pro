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
 * for a list), and a page recipe's read writes its selector usage. Index names: `crawl-requests-YYYY.MM.DD`, `crawl-sites-YYYY.MM`,
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
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    random?: () => number;
}

export type JobResult =
    | { outcome: 'success' | 'failed' | 'dead_letter'; attempts: number; reason?: string; followUps?: CrawlJob[] }
    | { outcome: 'deferred'; attempts: number; delayMs: number; reason: string };

const EXTRACT_TIMEOUT_MS = 60_000;
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

    // 1. The recipe. A store failure is not the site's: no attempt is counted against it.
    let recipe: ResolvedRecipe;
    try {
        recipe = await d.store.recipeFor(job);
    } catch (e) {
        const c = e instanceof CrawlError ? classOf(e.errorClass) : classOf('recipe_store');
        const message = e instanceof Error ? e.message : String(e);
        const decision = decide(c, before + 1, config.retry, undefined, d.random);
        const outcome = decision.action === 'done' ? decision.outcome : 'deferred';
        emit({ ...base(), attempt: before + 1, final: true, outcome, timings: { totalMs: 0 }, errorClass: c.errorClass, errorMessage: message });
        if (decision.action === 'done') return { outcome: decision.outcome, attempts: before + 1, reason: message };
        return { outcome: 'deferred', attempts: before + 1, delayMs: decision.action === 'defer' ? decision.delayMs : decision.waitMs, reason: message };
    }
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

    for (let attempt = before + 1; ; attempt++) {
        // 2. The site's turn.
        const slot = d.governor.reserve(host);
        if ('deferMs' in slot) {
            if (slot.reason === 'busy' && slot.deferMs <= config.retry.maxInlineWaitMs) { await sleep(slot.deferMs); attempt--; continue; }
            return { outcome: 'deferred', attempts: attempt - 1, delayMs: slot.deferMs, reason: `site ${slot.reason}` };
        }
        if (slot.waitMs > 0) await sleep(slot.waitMs);
        const started = now();

        // 3. A proxy, and robots.txt.
        let proxy: ProxyConfig | undefined;
        if (pool) {
            proxy = pool.pick(host, profile.proxyCountry, failedProxies);
            if (!proxy) {
                d.governor.done(host, classOf('proxy'));
                emit({ ...base(), attempt, final: true, outcome: 'deferred', timings: { totalMs: 0 }, errorClass: 'proxy', errorMessage: `No healthy proxy in pool ${profile.proxyPool}` });
                return { outcome: 'deferred', attempts: attempt, delayMs: 60_000, reason: 'no healthy proxy' };
            }
        }
        const proxyFields = proxy ? { proxyId: proxy.id, ...(proxy.country ? { proxyCountry: proxy.country } : {}) } : {};
        if (d.robots && profile.respectRobots !== false && !await d.robots.allowed(job.url).catch(() => true)) {
            const c = classOf('robots_disallowed');
            d.governor.done(host, c);
            emit({ ...base(), ...proxyFields, attempt, final: true, outcome: 'failed', timings: { totalMs: now() - started }, errorClass: c.errorClass, errorMessage: 'robots.txt disallows this URL' });
            return { outcome: 'failed', attempts: attempt, reason: 'robots.txt' };
        }

        // 4. Visit, classify, extract.
        let c: Classification = classOf('unknown');
        let v: Visit = { redirects: [], navigationMs: 0 };
        let read: RunRead | undefined;
        let listRead: ListRead | undefined;
        let extractMs: number | undefined;
        let errorMessage: string | undefined;
        try {
            const { page, release } = await d.pages.open(host, profile, proxy);
            try {
                v = await visit(page, job.url, { timeoutMs: config.navigationTimeoutMs, settleMs: config.settleMs, now });
                c = classify({ error: v.error, status: v.status, headers: v.headers, title: v.title, text: v.text }, now());
                errorMessage = v.error;
                if (c.errorClass === 'none') {
                    const t = now();
                    try {
                        if ('page' in part) read = readRun(part.page, v.finalUrl ?? job.url, await extract(page, d.script, request!, EXTRACT_TIMEOUT_MS));
                        else listRead = await readListPages(page, d.script, part.list, { maxPages: config.maxListPages, settleMs: config.settleMs, timeoutMs: LIST_TIMEOUT_MS });
                    } catch (e) {
                        c = classOf('extraction');
                        errorMessage = e instanceof Error ? e.message : String(e);
                    }
                    extractMs = now() - t;
                }
            } finally {
                await release();
            }
        } catch (e) {
            // The browser itself failed (it crashed, or a context could not be made).
            errorMessage = e instanceof Error ? e.message : String(e);
        }

        // 5. What it means for the site and the proxy.
        d.governor.done(host, c);
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
            ...base(), ...proxyFields, attempt, final, outcome,
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
            const scrape = (extra: Partial<ScrapeDoc>): ScrapeDoc => ({
                jobId: job.jobId, ...(job.runId ? { runId: job.runId } : {}), url: job.url, finalUrl: v.finalUrl ?? job.url,
                competitor: job.competitor, pageType: job.pageType, mode, crawledAt, pageStatus: c.pageStatus, ...ref,
                attributes: {}, fieldStatus: {}, ...(job.meta ? { meta: job.meta } : {}), ...(job.parent ? { parent: job.parent } : {}), ...extra,
            });
            if (listRead && 'list' in part) {
                for (const r of readListRows(part.list, listRead.lists).rows) {
                    d.sink.write(indices.scrapes(job), scrape({ attributes: r.attributes, fieldStatus: r.fieldStatus, listId: r.listId, row: r.index, page: job.page ?? 1 }), `${job.jobId}~${r.listId}~${r.index}`);
                }
            } else if (read || c.pageStatus === 'not_found') {
                d.sink.write(indices.scrapes(job), scrape(read ? { attributes: read.attributes, fieldStatus: read.fieldStatus } : {}), job.jobId);
            }
            if (read) {
                d.sink.write(indices.usage(job, t), {
                    jobId: job.jobId, crawledAt, competitor: job.competitor, pageType: job.pageType, pageStatus: c.pageStatus, ...ref, ways: read.ways,
                } satisfies SelectorUsageDoc, job.jobId);
            }
            return {
                outcome: decision.outcome, attempts: attempt,
                ...(decision.outcome !== 'success' ? { reason: errorMessage ? `${c.errorClass}: ${errorMessage.slice(0, 200)}` : c.errorClass } : {}),
                ...(next.length ? { followUps: next } : {}),
            };
        }
        if (decision.action === 'defer') return { outcome: 'deferred', attempts: attempt, delayMs: decision.delayMs, reason: c.errorClass };
        await sleep(decision.waitMs);
    }
}
