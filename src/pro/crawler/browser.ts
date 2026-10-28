/**
 * Pages for the worker, from one Chromium. A context per site and proxy keeps that visitor's cookies and
 * session between pages; it is replaced after `pagesPerContext` pages, or when its proxy changes. A context
 * renders as the site's profile says (locale, timezone, viewport, user agent, extra headers) and may skip
 * images, media and fonts.
 * `visit` reads what came back (status, headers, redirects, size, timings, title, visible text) for
 * classification and telemetry; `extract` and `readListPages` run the in-page script (`inPage.ts`) on it.
 */
import { chromium, type Browser, type BrowserContext, type Page, type Response } from 'playwright';
import type { SiteProfile } from './config';
import type { InPageRequest, InPageResult, ListPageResult } from './inPage';
import type { ListTarget } from '../../shared/types/database';
import type { ListRecipeSpec } from '../recipe/types';
import type { ProxyConfig } from './proxies';

export interface Visit {
    error?: string;
    status?: number;
    headers?: Record<string, string>;
    requestHeaders?: Record<string, string>;
    redirects: string[];
    finalUrl?: string;
    bytes?: number;
    title?: string;
    text?: string;
    navigationMs: number;
}

/** What the worker needs from a browser: a page for a host through a proxy, and robots.txt through it. */
export interface PageSource {
    open(host: string, profile: SiteProfile, proxy?: ProxyConfig): Promise<{ page: Page; release: () => Promise<void> }>;
    fetchText(url: string, profile: SiteProfile, proxy?: ProxyConfig): Promise<{ status: number; text: string }>;
    close(): Promise<void>;
}

interface ContextEntry { context: BrowserContext; pages: number; open: number }

/** Request headers kept on request events. */
const KEEP_REQUEST_HEADERS = ['user-agent', 'accept-language', 'referer'];

export class BrowserPool implements PageSource {
    /** One launch, shared: pages asked for at once must not each start a browser. */
    private browser: Promise<Browser> | null = null;
    private contexts = new Map<string, Promise<ContextEntry>>();

    constructor(private opts: { pagesPerContext: number; headless?: boolean; executablePath?: string }) {}

    private start(): Promise<Browser> {
        if (!this.browser) {
            this.browser = chromium.launch({
                headless: this.opts.headless ?? true,
                ...(this.opts.executablePath ? { executablePath: this.opts.executablePath } : {}),
            });
            this.browser.catch(() => { this.browser = null; });
        }
        return this.browser;
    }

    /** The site's context through this proxy; made once even when asked for at once, renewed when used up. */
    private async context(host: string, profile: SiteProfile, proxy?: ProxyConfig): Promise<ContextEntry> {
        const key = `${host}|${proxy?.id ?? 'direct'}`;
        const existing = this.contexts.get(key);
        if (existing) {
            const entry = await existing;
            if (entry.pages < this.opts.pagesPerContext || entry.open > 0) return entry;
            if (this.contexts.get(key) === existing) {
                this.contexts.delete(key);
                void entry.context.close().catch(() => {});
            }
            return this.context(host, profile, proxy);
        }
        const made = (async (): Promise<ContextEntry> => {
            const browser = await this.start();
            const context = await browser.newContext({
                ...(proxy ? { proxy: { server: proxy.server, ...(proxy.bypass ? { bypass: proxy.bypass } : {}), ...(proxy.username ? { username: proxy.username, password: proxy.password ?? '' } : {}) } } : {}),
                ...(profile.locale ? { locale: profile.locale } : {}),
                ...(profile.timezoneId ? { timezoneId: profile.timezoneId } : {}),
                ...(profile.viewport ? { viewport: profile.viewport } : {}),
                ...(profile.userAgent ? { userAgent: profile.userAgent } : {}),
                ...(profile.extraHeaders ? { extraHTTPHeaders: profile.extraHeaders } : {}),
            });
            const blocked = new Set(profile.blockResources ?? []);
            if (blocked.size) await context.route('**/*', route => blocked.has(route.request().resourceType()) ? route.abort() : route.continue());
            return { context, pages: 0, open: 0 };
        })();
        this.contexts.set(key, made);
        made.catch(() => { if (this.contexts.get(key) === made) this.contexts.delete(key); });
        return made;
    }

    async open(host: string, profile: SiteProfile, proxy?: ProxyConfig) {
        const entry = await this.context(host, profile, proxy);
        entry.pages++;
        entry.open++;
        const page = await entry.context.newPage();
        return {
            page,
            release: async () => {
                entry.open--;
                await page.close().catch(() => {});
            },
        };
    }

    async fetchText(url: string, profile: SiteProfile, proxy?: ProxyConfig) {
        const entry = await this.context(new URL(url).host, profile, proxy);
        const res = await entry.context.request.get(url, { timeout: 15_000, failOnStatusCode: false });
        return { status: res.status(), text: res.ok() ? await res.text() : '' };
    }

    async close() {
        for (const made of this.contexts.values()) await made.then(e => e.context.close()).catch(() => {});
        this.contexts.clear();
        const browser = this.browser;
        this.browser = null;
        await browser?.then(b => b.close()).catch(() => {});
    }
}

function redirectChain(response: Response): string[] {
    const chain: string[] = [];
    for (let r = response.request().redirectedFrom(); r; r = r.redirectedFrom()) chain.unshift(r.url());
    return chain;
}

export async function visit(page: Page, url: string, o: { timeoutMs: number; settleMs: number; now?: () => number }): Promise<Visit> {
    const now = o.now ?? Date.now;
    const started = now();
    let response: Response | null;
    try {
        response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: o.timeoutMs });
    } catch (e) {
        return { error: e instanceof Error ? e.message : String(e), redirects: [], navigationMs: now() - started };
    }
    await page.waitForLoadState('load', { timeout: Math.min(10_000, o.timeoutMs) }).catch(() => {});
    if (o.settleMs > 0) await page.waitForTimeout(o.settleMs);
    const navigationMs = now() - started;
    if (!response) return { error: 'No response', redirects: [], navigationMs };
    const [headers, requestHeaders, sizes, title, text] = await Promise.all([
        response.allHeaders(),
        response.request().allHeaders(),
        response.request().sizes().catch(() => null),
        page.title().catch(() => ''),
        page.evaluate(() => (document.body?.innerText ?? '').slice(0, 5000)).catch(() => ''),
    ]);
    return {
        status: response.status(),
        headers,
        requestHeaders: Object.fromEntries(KEEP_REQUEST_HEADERS.flatMap(h => requestHeaders[h] ? [[h, requestHeaders[h]]] : [])),
        redirects: redirectChain(response),
        finalUrl: page.url(),
        ...(sizes ? { bytes: sizes.responseBodySize } : {}),
        title,
        text,
        navigationMs,
    };
}

/** Rejects after `ms`, so a page that never settles cannot hold a worker. */
async function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} took longer than ${ms} ms`)), ms); });
    try {
        return await Promise.race([work, timeout]);
    } finally {
        clearTimeout(timer);
    }
}

/** Calls one of the in-page functions, putting the script in first when the page does not have it (a new page, or one a click navigated). */
async function callInPage<T>(page: Page, script: string, fn: 'run' | 'readLists' | 'clickNext' | 'scrollToEnd', args: unknown[]): Promise<T> {
    const loaded = await page.evaluate(() => typeof (globalThis as { crawlpilot?: unknown }).crawlpilot === 'object');
    if (!loaded) await page.evaluate(script);
    const call = ({ name, a }: { name: string; a: unknown[] }) =>
        (globalThis as unknown as { crawlpilot: Record<string, (...x: unknown[]) => unknown> }).crawlpilot[name](...a);
    return page.evaluate(call, { name: fn, a: args as never[] }) as Promise<T>;
}

/** Runs a page recipe in the page. */
export function extract(page: Page, script: string, request: InPageRequest, timeoutMs: number): Promise<InPageResult> {
    return withTimeout(callInPage<InPageResult>(page, script, 'run', [request]), timeoutMs, 'Extraction');
}

export interface ListRead {
    lists: ListPageResult['lists'];
    /** The next page's link, for a list paged by links: a job of its own. */
    nextHref?: string;
    /** Pages read here: clicked through, loaded more, or 1. */
    pages: number;
}

/**
 * Reads a list recipe's rows on the page. Infinite scroll: scrolled to the end first. Load more, and Next
 * controls that are buttons: clicked, waited for, and read again, up to `maxPages`, until nothing new comes.
 * Next controls that are links are left to a job of their own (`nextHref`). Rows seen twice count once.
 */
export function readListPages(page: Page, script: string, req: { lists: ListTarget[]; pagination: ListRecipeSpec['pagination'] },
    o: { maxPages: number; settleMs: number; timeoutMs: number }): Promise<ListRead> {
    return withTimeout((async () => {
        const settle = Math.max(o.settleMs, 300);
        const { mode, next } = req.pagination;
        if (mode === 'auto') await callInPage(page, script, 'scrollToEnd', [o.maxPages, settle]);
        const merged = req.lists.map(l => ({ id: l.id, rows: [] as Record<string, string>[], seen: new Set<string>() }));
        const add = (r: ListPageResult) => {
            let added = 0;
            r.lists.forEach((l, i) => l.rows.forEach(row => {
                const key = JSON.stringify(row);
                if (merged[i].seen.has(key)) return;
                merged[i].seen.add(key);
                merged[i].rows.push(row);
                added++;
            }));
            return added;
        };
        const read = () => callInPage<ListPageResult>(page, script, 'readLists', [{ lists: req.lists, next, settleMs: settle }]);
        let r = await read();
        add(r);
        let pages = 1;
        const clicks = mode === 'loadMore' || (mode === 'pagination' && !r.nextHref);
        while (clicks && next?.length && r.hasNext && pages < o.maxPages) {
            if (!await callInPage<boolean>(page, script, 'clickNext', [next])) break;
            await page.waitForLoadState('domcontentloaded').catch(() => {});
            await page.waitForTimeout(settle);
            r = await read();
            pages++;
            if (add(r) === 0) break;
        }
        return {
            lists: merged.map(({ id, rows }) => ({ id, rows })),
            ...(mode === 'pagination' && r.nextHref ? { nextHref: r.nextHref } : {}),
            pages,
        };
    })(), o.timeoutMs, 'Reading the list');
}
