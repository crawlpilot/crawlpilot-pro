/**
 * The worker under failure: its queue, its recipe store, its browser and its pages misbehaving. Each case is
 * one that used to crash, wedge or empty the queue (`docs/design/crawler.md`, Resilience).
 */
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Browser, Page } from 'playwright';
import { BrowserPool, type PageSource } from './browser';
import { CrawlError } from './classify';
import { parseConfig } from './config';
import { SiteGovernor, type SitePolicy } from './governor';
import { MemoryQueue, runWorker, type Delivery, type JobQueue } from './queue';
import { memorySink } from './search';
import type { RecipeStore } from './store';
import type { CrawlJob, RequestEvent } from './types';
import { Vitals } from './vitals';
import { processJob, storeDelay, type JobResult, type WorkerDeps } from './worker';

const job: CrawlJob = { jobId: 'j1', url: 'https://shop.test/p/1', competitor: 'acme', pageType: 'product' };
const config = parseConfig({ recipeStore: { url: 'https://store.test', token: 't' }, search: { url: 'https://es.test' }, settleMs: 0,
    retry: { maxAttempts: 1, baseDelayMs: 10, maxDelayMs: 10, maxInlineWaitMs: 1000 } }, {});
const policy: SitePolicy = { minDelayMs: 0, maxDelayMs: 1000, concurrency: 1, cooldownBaseMs: 1000, cooldownMaxMs: 10_000, blockAfter: 3 };
const recipe = { recipeId: 'r', version: 1, digest: 'd', settings: {}, spec: { kind: 'page' as const, steps: [
    { kind: 'field' as const, field: { id: 'f', name: 'title', type: 'text' as const, read: 'text', ops: [], ways: [{ id: 'w', addedIn: 1, kind: 'selector' as const, selector: 'h1' }] } },
] } };

/** A page whose title never comes back: a busy main thread. */
function hangingPage() {
    const closed = { value: false };
    const response = { status: () => 200, allHeaders: async () => ({}), request: () => ({ allHeaders: async () => ({}), sizes: async () => ({ responseBodySize: 10 }), redirectedFrom: () => null }) };
    const page = {
        goto: async () => response,
        waitForLoadState: async () => {},
        waitForTimeout: async () => {},
        url: () => job.url,
        title: () => new Promise<string>((_, reject) => { const t = setInterval(() => { if (closed.value) { clearInterval(t); reject(new Error('Target page, context or browser has been closed')); } }, 5); }),
        evaluate: async () => 'x'.repeat(200),
        close: async () => { closed.value = true; },
    };
    return { page: page as unknown as Page, closed };
}

function deps(over: Partial<WorkerDeps> = {}): WorkerDeps & { sink: ReturnType<typeof memorySink> } {
    const store: RecipeStore = { recipeFor: async () => recipe };
    const pages: PageSource = { open: async () => { throw new Error('unused'); }, fetchText: async () => ({ status: 404, text: '' }), close: async () => {} };
    return {
        config, store, pages, sink: memorySink(), governor: new SiteGovernor(() => policy), proxies: new Map(), robots: null, script: '',
        sleep: async () => {}, random: () => 0.5, ...over,
    } as WorkerDeps & { sink: ReturnType<typeof memorySink> };
}
const events = (d: { sink: ReturnType<typeof memorySink> }) => [...d.sink.docs.entries()].filter(([i]) => i.startsWith('crawl-requests-')).flatMap(([, l]) => l.map(x => x.doc as RequestEvent));

afterEach(() => { vi.useRealTimers(); });

describe('the recipe store failing', () => {
    it('defers the job from 30 s up to 10 minutes and never counts an attempt', async () => {
        const d = deps({ store: { recipeFor: async () => { throw new CrawlError('recipe_store', 'The recipe store answered 503.'); } } });
        const first = await processJob({ ...job, attempts: 2 }, d);
        expect(first).toMatchObject({ outcome: 'deferred', attempts: 2, patch: { storeFailures: 1 } });
        expect((first as { delayMs: number }).delayMs).toBe(storeDelay(1, () => 0.5));
        expect(storeDelay(1, () => 0)).toBe(15_000);
        expect(storeDelay(9, () => 1)).toBe(600_000);
        const later = await processJob({ ...job, attempts: 2, storeFailures: 4 }, d);
        expect(later).toMatchObject({ outcome: 'deferred', attempts: 2, patch: { storeFailures: 5 } });
    });

    it('holds a paused recipe\'s jobs instead of dropping them', async () => {
        const d = deps({ store: { recipeFor: async () => { throw new CrawlError('paused', 'paused'); } } });
        expect(await processJob(job, d)).toMatchObject({ outcome: 'deferred', attempts: 0, delayMs: 600_000 });
    });

    it('starts the wait over once the store answers again', async () => {
        const { page } = hangingPage();
        const ok = { ...page, title: async () => 'Shirt', evaluate: async () => 'x'.repeat(200) } as unknown as Page;
        const d = deps({ pages: { open: async () => ({ page: ok, release: async () => {} }), fetchText: async () => ({ status: 404, text: '' }), close: async () => {} } });
        const r = await processJob({ ...job, storeFailures: 3 }, { ...d, script: '' });
        expect(r).toMatchObject({ patch: { storeFailures: 0 } });
    });
});

describe('a page that hangs', () => {
    it('is closed at the attempt\'s deadline, counted as a timeout, and gives its site slot back', async () => {
        vi.useFakeTimers();
        const { page, closed } = hangingPage();
        const d = deps({ pages: { open: async () => ({ page, release: async () => { await page.close(); } }), fetchText: async () => ({ status: 404, text: '' }), close: async () => {} } });
        const result = processJob(job, d);
        await vi.advanceTimersByTimeAsync(config.navigationTimeoutMs + 10_000 + 60_000 + 15_000 + 100);
        expect(await result).toMatchObject({ outcome: 'dead_letter', attempts: 1, reason: expect.stringContaining('timeout') });
        expect(closed.value).toBe(true);
        expect(events(d)[0]).toMatchObject({ errorClass: 'timeout', outcome: 'dead_letter' });
        expect(d.governor.stateOf('shop.test').inFlight).toBe(0);
    });
});

describe('a busy site', () => {
    it('is waited for a little, then the job goes back on the queue without an attempt', async () => {
        let t = 0;
        const d = deps({ now: () => t, sleep: async ms => { t += ms; } });
        d.governor = new SiteGovernor(() => policy, undefined, () => t);
        d.governor.reserve('shop.test'); // A slot held by a page that never ends.
        const r = await processJob(job, d);
        expect(r).toMatchObject({ outcome: 'deferred', attempts: 0, reason: 'site busy' });
        expect(t).toBeLessThanOrEqual(config.retry.maxInlineWaitMs);
    });
});

describe('the browser failing', () => {
    it('defers the job without counting it, and five failures in a row make the worker unhealthy', async () => {
        const vitals = new Vitals(5);
        const d = deps({ vitals, pages: { open: async () => { throw new Error('browserType.launch: Failed to launch the browser process'); }, fetchText: async () => ({ status: 404, text: '' }), close: async () => {} } });
        for (let i = 0; i < 4; i++) expect(await processJob(job, d)).toMatchObject({ outcome: 'deferred', attempts: 0, delayMs: 5000 });
        expect(vitals.unhealthy).toBe(false);
        await processJob(job, d);
        expect(vitals.unhealthy).toBe(true);
        expect(events(d)[0]).toMatchObject({ errorClass: 'browser', outcome: 'deferred' });
        expect(d.governor.stateOf('shop.test').inFlight).toBe(0);
    });

    it('a page that crashes its tab is the page\'s fault, and counted', async () => {
        const d = deps({ pages: { open: async () => { throw new Error('page.goto: Page crashed'); }, fetchText: async () => ({ status: 404, text: '' }), close: async () => {} } });
        expect(await processJob(job, d)).toMatchObject({ outcome: 'dead_letter', attempts: 1 });
    });
});

describe('stopping', () => {
    it('puts a job that has not started back on the queue at once', async () => {
        expect(await processJob(job, deps({ stopped: () => true }))).toMatchObject({ outcome: 'deferred', attempts: 0, delayMs: 0, reason: 'worker stopping' });
    });

    it('abandons an attempt in progress when told to stop now, and puts its job back uncounted', async () => {
        const { page, closed } = hangingPage();
        const abort = new AbortController();
        const d = deps({ signal: abort.signal, pages: { open: async () => ({ page, release: async () => {} }), fetchText: async () => ({ status: 404, text: '' }), close: async () => {} } });
        const result = processJob({ ...job, attempts: 1 }, d);
        await new Promise(r => setTimeout(r, 20));
        abort.abort();
        expect(await result).toMatchObject({ outcome: 'deferred', attempts: 1, delayMs: 0, reason: 'worker stopping' });
        expect(closed.value).toBe(true);
        expect(d.governor.stateOf('shop.test').inFlight).toBe(0);
    });
});

describe('a job put back for too long', () => {
    it('is dead-lettered past retry.maxJobAgeMs, and stamped when it is first put back', async () => {
        const t = 1_000_000_000;
        const d = deps({ now: () => t });
        const old = { ...job, attempts: 2, firstSeenAt: t - config.retry.maxJobAgeMs - 1 };
        expect(await processJob(old, d)).toMatchObject({ outcome: 'dead_letter', attempts: 2, reason: expect.stringContaining('expired') });
        expect(events(d)[0]).toMatchObject({ errorClass: 'expired', outcome: 'dead_letter' });

        const q = new MemoryQueue([job], () => t);
        let runs = 0;
        await runWorker(q, deps({ now: () => t }), { untilIdle: true, process: async j => {
            runs++;
            if (runs === 2) expect(j.firstSeenAt).toBe(t);
            return runs === 1 ? { outcome: 'deferred', attempts: 1, delayMs: 0, reason: 'site blocked' } : { outcome: 'success', attempts: 2 };
        } });
        expect(runs).toBe(2);
    });
});

describe('documents Elasticsearch does not confirm', () => {
    it('keep the job: it is put back to be read again, not acknowledged', async () => {
        const errors: string[] = [];
        let t = 0;
        const q = new MemoryQueue([job], () => t);
        const released: string[] = [];
        const receive = q.receive.bind(q);
        q.receive = async max => (await receive(max)).map((d: Delivery) => ({ ...d, release: () => released.push(d.job.jobId) }));
        let runs = 0;
        const lost = Promise.reject(new Error('s: mapper_parsing_exception bad price'));
        lost.catch(() => {});
        await runWorker(q, deps({ now: () => t, sleep: async ms => { t += ms; } }), { untilIdle: true, onError: m => errors.push(m), process: async () =>
            ++runs === 1 ? { outcome: 'success', attempts: 1, writes: [Promise.resolve(), lost] } : { outcome: 'success', attempts: 1, writes: [Promise.resolve()] } });
        expect(runs).toBe(2);
        expect(errors).toEqual(['job j1: documents not written (s: mapper_parsing_exception bad price); put back to be read again']);
        expect(q.done[0].job.writeFailures).toBe(1);
        expect(q.done).toHaveLength(1);
        expect(released).toEqual(['j1', 'j1']);
    });

    it('send the job to a person once refused five times in a row', async () => {
        const q = new MemoryQueue([{ ...job, writeFailures: 4 }]);
        const refused = Promise.reject(new Error('s: mapper_parsing_exception bad price'));
        refused.catch(() => {});
        await runWorker(q, deps(), { untilIdle: true, onError: () => {}, process: async () => ({ outcome: 'success', attempts: 1, writes: [refused] }) });
        expect(q.dead).toEqual([{ job: { ...job, writeFailures: 4 }, reason: 'documents not written 5 times: s: mapper_parsing_exception bad price' }]);
    });

    it('a page found gone writes its scrape document confirmed', async () => {
        const { page } = hangingPage();
        const gone = { ...page, title: async () => 'Not found', goto: async () => ({ ...(await page.goto('')), status: () => 404 }) } as unknown as Page;
        const d = deps({ pages: { open: async () => ({ page: gone, release: async () => {} }), fetchText: async () => ({ status: 404, text: '' }), close: async () => {} } });
        const confirmed: string[] = [];
        const write = d.sink.writeConfirmed;
        d.sink.writeConfirmed = (index, doc, id) => { confirmed.push(`${index}/${id}`); return write(index, doc, id); };
        const r = await processJob(job, d);
        expect(r).toMatchObject({ outcome: 'failed' });
        expect(confirmed).toEqual(['scrapes-acme/j1']);
        expect((r as { writes?: unknown[] }).writes).toHaveLength(1);
    });
});

describe('the run loop', () => {
    const quick = (r: JobResult) => async () => r;

    it('survives a settle that throws, and leaves that message for the queue', async () => {
        const errors: string[] = [];
        const q = new MemoryQueue([job, { ...job, jobId: 'j2' }]);
        const receive = q.receive.bind(q);
        q.receive = async max => (await receive(max)).map((d: Delivery) => d.job.jobId === 'j1' ? { ...d, ack: async () => { throw new Error('SQS: throttled'); } } : d);
        await runWorker(q, deps(), { untilIdle: true, process: quick({ outcome: 'success', attempts: 1 }), onError: m => errors.push(m) });
        expect(errors).toEqual(['job j1 not settled (success): SQS: throttled']);
        expect(q.done.map(x => x.job.jobId)).toEqual(['j2']);
    });

    it('tries a failing receive again with a growing wait, and keeps going', async () => {
        const errors: string[] = [];
        const waits: number[] = [];
        const inner = new MemoryQueue([job]);
        let failures = 2;
        const q: JobQueue = {
            receive: async max => { if (failures-- > 0) throw new Error('ECONNRESET'); return inner.receive(max); },
            enqueue: jobs => inner.enqueue(jobs),
            idle: () => failures < 0 && inner.idle(),
        };
        await runWorker(q, deps({ sleep: async ms => { waits.push(ms); } }), { untilIdle: true, process: quick({ outcome: 'success', attempts: 1 }), onError: m => errors.push(m) });
        expect(errors).toEqual(['receive failed (1 in a row), again in 1000 ms: ECONNRESET', 'receive failed (2 in a row), again in 2000 ms: ECONNRESET']);
        expect(waits.slice(0, 2)).toEqual([1000, 2000]);
        expect(inner.done).toHaveLength(1);
    });

    it('carries what a job learned (its store failures) when it puts it back', async () => {
        const q = new MemoryQueue([job]);
        let t = 0;
        const runs: CrawlJob[] = [];
        const process = async (j: CrawlJob): Promise<JobResult> => {
            runs.push(j);
            return runs.length === 1 ? { outcome: 'deferred', attempts: 0, delayMs: 10, reason: 'store', patch: { storeFailures: 1 } } : { outcome: 'success', attempts: 1 };
        };
        await runWorker(new Proxy(q, {}) as MemoryQueue, deps({ sleep: async ms => { t += ms; } }), { untilIdle: true, process });
        expect(runs[1]).toMatchObject({ jobId: 'j1', storeFailures: 1, attempts: 0 });
    });
});

describe('the browser pool', () => {
    function fakeBrowser() {
        const browser = new EventEmitter() as EventEmitter & { newContext: () => Promise<unknown>; close: () => Promise<void> };
        const contexts: (EventEmitter & { close: () => Promise<void> })[] = [];
        browser.newContext = async () => {
            const context = new EventEmitter() as EventEmitter & Record<string, unknown>;
            Object.assign(context, {
                newPage: async () => ({ close: async () => {} }),
                route: async () => {},
                close: async () => { context.emit('close'); },
            });
            contexts.push(context as never);
            return context;
        };
        browser.close = async () => {};
        return { browser, contexts };
    }

    it('starts a new browser after the old one dies, and a new context after one closes', async () => {
        const launched: ReturnType<typeof fakeBrowser>[] = [];
        const pool = new BrowserPool({ pagesPerContext: 50, launch: async () => { const b = fakeBrowser(); launched.push(b); return b.browser as unknown as Browser; } });
        await pool.open('a.test', {});
        await pool.open('a.test', {});
        expect(launched).toHaveLength(1);
        expect(launched[0].contexts).toHaveLength(1);

        await launched[0].contexts[0].close();
        await pool.open('a.test', {});
        expect(launched[0].contexts).toHaveLength(2);

        launched[0].browser.emit('disconnected');
        await pool.open('a.test', {});
        expect(launched).toHaveLength(2);
    });

    it('does not count a page that failed to open', async () => {
        const b = fakeBrowser();
        let fail = true;
        const pool = new BrowserPool({ pagesPerContext: 1, launch: async () => b.browser as unknown as Browser });
        const newContext = b.browser.newContext;
        b.browser.newContext = async () => {
            const c = await newContext() as Record<string, unknown>;
            const newPage = c.newPage as () => Promise<unknown>;
            c.newPage = async () => { if (fail) { fail = false; throw new Error('Target closed'); } return newPage(); };
            return c;
        };
        await expect(pool.open('a.test', {})).rejects.toThrow('Target closed');
        // The failed page left no count behind: this one is the context's first, the next one renews it.
        const { release } = await pool.open('a.test', {});
        await release();
        await pool.open('a.test', {});
        expect(b.contexts).toHaveLength(2);
    });

    const closedCount = (b: ReturnType<typeof fakeBrowser>) => b.contexts.filter(c => (c as unknown as { closed?: boolean }).closed).length;
    function tracked() {
        const b = fakeBrowser();
        const newContext = b.browser.newContext;
        b.browser.newContext = async () => {
            const c = await newContext() as EventEmitter & Record<string, unknown>;
            const close = c.close as () => Promise<void>;
            c.close = async () => { c.closed = true; await close(); };
            return c;
        };
        return b;
    }

    it('closes a context left idle, never one in use', async () => {
        const b = tracked();
        let t = 0;
        const pool = new BrowserPool({ pagesPerContext: 50, idleMs: 1000, now: () => t, launch: async () => b.browser as unknown as Browser });
        const a = await pool.open('a.test', {});
        const held = await pool.open('b.test', {});
        await a.release();
        t = 5000;
        await pool.open('c.test', {});
        expect(b.contexts.map(c => !!(c as unknown as { closed?: boolean }).closed)).toEqual([true, false, false]);
        // a.test comes back to a new context.
        await pool.open('a.test', {});
        expect(b.contexts).toHaveLength(4);
        await held.release();
    });

    it('keeps at most maxContexts, closing the least recently used idle ones', async () => {
        const b = tracked();
        let t = 0;
        const pool = new BrowserPool({ pagesPerContext: 50, maxContexts: 2, now: () => t, launch: async () => b.browser as unknown as Browser });
        for (const host of ['a.test', 'b.test', 'c.test', 'd.test']) { t++; await (await pool.open(host, {})).release(); }
        expect(closedCount(b)).toBe(2);
        expect(b.contexts.slice(0, 2).every(c => (c as unknown as { closed?: boolean }).closed)).toBe(true);
    });

    it('holds a context open while robots.txt is fetched through it', async () => {
        const b = tracked();
        let answer!: () => void;
        const newContext = b.browser.newContext;
        b.browser.newContext = async () => {
            const c = await newContext() as Record<string, unknown>;
            c.request = { get: () => new Promise(r => { answer = () => r({ status: () => 200, ok: () => true, text: async () => 'User-agent: *' }); }) };
            return c;
        };
        let t = 0;
        const pool = new BrowserPool({ pagesPerContext: 50, idleMs: 10, now: () => t, launch: async () => b.browser as unknown as Browser });
        await (await pool.open('a.test', {})).release();
        const robots = pool.fetchText('https://a.test/robots.txt', {});
        await new Promise(r => setTimeout(r, 0));
        t = 1000;
        await pool.open('b.test', {});
        expect((b.contexts[0] as unknown as { closed?: boolean }).closed).toBeFalsy();
        answer();
        expect(await robots).toEqual({ status: 200, text: 'User-agent: *' });

        // Nor is it renewed under the request when its pages are used up.
        const b2 = tracked();
        const newContext2 = b2.browser.newContext;
        b2.browser.newContext = async () => {
            const c = await newContext2() as Record<string, unknown>;
            c.request = { get: () => new Promise(r => { answer = () => r({ status: () => 200, ok: () => true, text: async () => '' }); }) };
            return c;
        };
        const pool2 = new BrowserPool({ pagesPerContext: 1, launch: async () => b2.browser as unknown as Browser });
        const robots2 = pool2.fetchText('https://a.test/robots.txt', {});
        await new Promise(r => setTimeout(r, 0));
        await (await pool2.open('a.test', {})).release();
        await pool2.open('a.test', {});
        expect((b2.contexts[0] as unknown as { closed?: boolean }).closed).toBeFalsy();
        answer();
        await robots2;
    });
});
