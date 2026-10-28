/**
 * An in-memory crawler backend with the API Pro expects (`types.ts`), as HTTP: `handle` takes a request
 * and returns a status and JSON. Unit tests wrap it as `fetch`; the e2e harness serves it on a port.
 * A crawl moves one state on every read (queued → running → done) and reports each field filled.
 */
import type { CrawlStatus, Schedule } from './types';

export interface MockRequest {
    method: string;
    path: string;
    headers: Record<string, string | undefined>;
    body?: string;
}

export interface MockResponse {
    status: number;
    body: unknown;
}

interface MockRecipe { id: string; name: string; site: string; kind: string; competitor?: string; pageType?: string; matchRules?: unknown; versions: Map<number, { file: unknown; digest: string; review?: { state: string; by: string; note: string } }>; live?: number }
interface MockCrawl {
    id: string; recipeId: string; version: number; schedule: Schedule; pages: number; reads: number; fields: string[];
    /** Set by a test: a field's fill once done, and the pages it failed on (a site that changed). */
    fill?: Record<string, number>;
    failing?: Record<string, string[]>;
}

export interface MockBackend {
    handle(req: MockRequest): MockResponse;
    recipes: Map<string, MockRecipe>;
    crawls: Map<string, MockCrawl>;
    /** Requests seen, oldest first, as "METHOD /path". */
    log: string[];
    /** The next N requests answer this status (to try retries and errors). */
    failNext(status: number, times?: number): void;
}

const STATES: CrawlStatus['status'][] = ['queued', 'running', 'done'];

export function createMockBackend(token = 'dev-token'): MockBackend {
    const recipes = new Map<string, MockRecipe>();
    const crawls = new Map<string, MockCrawl>();
    const byKey = new Map<string, { recipeId: string; version: number }>();
    const log: string[] = [];
    let failing: { status: number; times: number } | null = null;
    let n = 0;

    const json = (status: number, body: unknown): MockResponse => ({ status, body });
    const parse = (body?: string): any => { try { return body ? JSON.parse(body) : {}; } catch { return null; } };

    function handle(req: MockRequest): MockResponse {
        log.push(`${req.method} ${req.path}`);
        if (failing && failing.times > 0) { failing.times--; return json(failing.status, { error: 'Failing on purpose' }); }
        if (req.headers.authorization !== `Bearer ${token}`) return json(401, { error: 'Sign in again: the token was not accepted.' });
        const parts = req.path.split('?')[0].split('/').filter(Boolean).map(decodeURIComponent);
        const body = parse(req.body);
        if (body === null) return json(400, { error: 'The body is not JSON.' });

        if (req.method === 'POST' && parts.length === 1 && parts[0] === 'recipes') {
            if (!body.name || !body.site) return json(422, { error: 'A recipe needs a name and a site.' });
            const id = `rec-${++n}`;
            recipes.set(id, { id, name: body.name, site: body.site, kind: body.kind, competitor: body.competitor, pageType: body.pageType, matchRules: body.matchRules, versions: new Map() });
            return json(201, { id });
        }
        const recipe = parts[0] === 'recipes' ? recipes.get(parts[1]) : undefined;
        if (parts[0] === 'recipes' && !recipe) return json(404, { error: `No recipe ${parts[1]}.` });

        if (req.method === 'POST' && recipe && parts[2] === 'versions' && parts.length === 3) {
            const key = req.headers['idempotency-key'] ?? '';
            const seen = byKey.get(key);
            if (seen && seen.recipeId === recipe.id) return json(200, { version: seen.version, accepted: true });
            const version = body.versions?.[0];
            if ((body.format !== 2 && body.format !== 3) || !version?.spec) return json(422, { error: 'Not a recipe file with a version.', errors: ['$.versions[0].spec is missing'] });
            recipe.versions.set(version.version, { file: body, digest: key });
            byKey.set(key, { recipeId: recipe.id, version: version.version });
            return json(201, { version: version.version, accepted: true });
        }
        if (req.method === 'POST' && recipe && parts[2] === 'versions' && parts[4] === 'review') {
            const stored = recipe.versions.get(Number(parts[3]));
            if (!stored) return json(409, { error: `Version ${parts[3]} was not uploaded.` });
            if (body.state !== 'approved' && body.state !== 'rejected') return json(422, { error: 'A review is approved or rejected.' });
            stored.review = { state: body.state, by: body.by, note: body.note ?? '' };
            return json(200, { state: body.state });
        }
        if (req.method === 'POST' && recipe && parts[2] === 'crawls') {
            const stored = recipe.versions.get(body.version);
            if (!stored) return json(409, { error: `Version ${body.version} was not uploaded.` });
            const v = (stored.file as any).versions[0];
            const fields: string[] = v.spec.kind === 'page' ? v.spec.steps.filter((s: any) => s.kind === 'field').map((s: any) => s.field.name) : [];
            const pages = body.pages?.kind === 'urls' ? body.pages.urls.length : 1;
            const id = `crawl-${++n}`;
            crawls.set(id, { id, recipeId: recipe.id, version: body.version, schedule: body.schedule, pages, reads: 0, fields });
            return json(201, { crawlId: id });
        }
        if (req.method === 'POST' && recipe && parts[2] === 'labels' && parts[3] === 'live') {
            const stored = recipe.versions.get(body.version);
            if (!stored) return json(409, { error: `Version ${body.version} was not uploaded.` });
            if (stored.review?.state !== 'approved') return json(409, { error: `Version ${body.version} is not approved.` });
            recipe.live = body.version;
            return json(200, { live: body.version });
        }
        if (req.method === 'GET' && parts[0] === 'crawls' && parts.length === 2) {
            const crawl = crawls.get(parts[1]);
            if (!crawl) return json(404, { error: `No crawl ${parts[1]}.` });
            const state = STATES[Math.min(crawl.reads++, STATES.length - 1)];
            const done = state === 'done' ? crawl.pages : state === 'running' ? Math.floor(crawl.pages / 2) : 0;
            const status: CrawlStatus = {
                id: crawl.id, status: state, pagesDone: done, pagesFailed: 0,
                fields: crawl.fields.map(name => ({
                    name, fill: done ? (state === 'done' ? crawl.fill?.[name] ?? 1 : 1) : 0, fallbackShare: 0, failedChecks: 0,
                    ...(state === 'done' && crawl.failing?.[name] ? { failingPages: crawl.failing[name] } : {}),
                })),
                samples: done ? [Object.fromEntries(crawl.fields.map(f => [f, `${f} sample`]))] : [],
            };
            return json(200, status);
        }
        return json(404, { error: `No route ${req.method} ${req.path}.` });
    }

    return { handle, recipes, crawls, log, failNext: (status, times = 1) => { failing = { status, times }; } };
}

/** The mock as `fetch`, for the client in unit tests. */
export function mockFetch(backend: MockBackend, baseUrl: string): typeof fetch {
    return async (input, init) => {
        const url = new URL(String(input));
        if (!url.href.startsWith(baseUrl)) throw new TypeError('Failed to fetch');
        const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
        const res = backend.handle({ method: init?.method ?? 'GET', path: url.pathname.slice(new URL(baseUrl).pathname.replace(/\/$/, '').length) + url.search, headers, body: init?.body as string | undefined });
        return new Response(JSON.stringify(res.body), { status: res.status, headers: { 'content-type': 'application/json' } });
    };
}
