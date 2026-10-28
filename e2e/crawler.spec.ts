/**
 * The crawler worker end to end, as it ships: `npm run crawler:build`, then `dist/worker.mjs` run on a
 * file of jobs, with Chromium. Around it: two local sites (a shop, and one that blocks), Pro's mock
 * backend as the recipe store, and a fake Elasticsearch that keeps every bulk it is sent.
 */
import { expect, test } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveMockBackend } from './pro';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKER = path.join(ROOT, 'src/pro/crawler/dist/worker.mjs');

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

async function serve(handler: Handler): Promise<{ origin: string; close: () => void }> {
    const server: Server = createServer(handler);
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as { port: number };
    return { origin: `http://127.0.0.1:${port}`, close: () => server.close() };
}

const PRODUCT = (title: string) => `<!doctype html><html><head><title>${title}</title></head><body>
<h1>${title}</h1><span class="price">29,90 €</span>
<p>${'A shirt in washed linen, cut straight, with a camp collar and a single chest pocket. '.repeat(3)}</p></body></html>`;

function html(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}) {
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', server: 'test-shop', ...headers });
    res.end(body);
}

test('crawler worker: reads pages with the live recipe, retries, backs off on blocks, and reports to Elasticsearch', async () => {
    test.setTimeout(180_000);
    execFileSync('npm', ['run', 'crawler:build'], { cwd: ROOT, stdio: 'ignore' });
    expect(existsSync(WORKER)).toBe(true);

    // The shop: products, a page that fails once, one that rate-limits once, a missing page, robots.txt.
    const seen = new Map<string, number>();
    const shop = await serve((req, res) => {
        const url = req.url ?? '/';
        const n = (seen.get(url) ?? 0) + 1;
        seen.set(url, n);
        if (url === '/robots.txt') return html(res, 200, 'User-agent: *\nDisallow: /private', { 'content-type': 'text/plain' });
        if (url === '/flaky' && n === 1) return html(res, 503, '<h1>Busy</h1>');
        if (url === '/limited' && n === 1) return html(res, 429, '<h1>Slow down</h1>', { 'retry-after': '1' });
        if (url === '/missing') return html(res, 404, '<h1>Not found</h1>');
        return html(res, 200, PRODUCT(url === '/p/1' ? 'Linen shirt' : 'Cotton shirt'));
    });
    // A site that blocks: a 403 challenge, and a captcha page.
    const wall = await serve((req, res) => {
        if (req.url === '/robots.txt') return html(res, 404, '');
        if (req.url === '/captcha') return html(res, 200, '<title>Verify</title><p>Please complete the CAPTCHA to continue.</p>');
        return html(res, 403, '<title>Access denied</title><p>You have been blocked.</p>', { 'cf-mitigated': 'challenge', server: 'cloudflare' });
    });
    // Elasticsearch: keeps each bulk's documents.
    const docs: { index: string; id?: string; doc: Record<string, any> }[] = [];
    const es = await serve((req, res) => {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
            const lines = body.trim().split('\n').map(l => JSON.parse(l));
            for (let i = 0; i < lines.length; i += 2) {
                const action = lines[i].index ?? lines[i].create;
                docs.push({ index: action._index, ...(action._id ? { id: action._id } : {}), doc: lines[i + 1] });
            }
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ errors: false, items: [] }));
        });
    });

    // The recipe store: one approved, live product recipe for acme. title has a dead selector before h1.
    const mock = await serveMockBackend();
    const { specDigest } = await import('../src/pro/recipe/canonical');
    const spec = { kind: 'page', steps: [
        { kind: 'field', field: { id: 'f-title', name: 'title', type: 'text', read: 'text', ops: [], ways: [
            { id: 'w-old', addedIn: 1, kind: 'selector', selector: 'h1.product-name' },
            { id: 'w-h1', addedIn: 1, kind: 'selector', selector: 'h1' },
        ] } },
        { kind: 'field', field: { id: 'f-price', name: 'price', type: 'text', read: 'text', ops: [], ways: [{ id: 'w-price', addedIn: 1, kind: 'selector', selector: '.price' }] } },
    ] };
    const digest = await specDigest(spec as never);
    const call = (method: string, p: string, body?: unknown, headers: Record<string, string> = {}) =>
        mock.backend.handle({ method, path: p, headers: { authorization: 'Bearer dev-token', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }).body as any;
    const { id: recipeId } = call('POST', '/recipes', { name: 'Acme product', site: '127.0.0.1', kind: 'page', competitor: 'acme', pageType: 'product' });
    call('POST', `/recipes/${recipeId}/versions`, {
        format: 3, recipe: { name: 'Acme product', site: '127.0.0.1', kind: 'page', competitor: 'acme', pageType: 'product' }, labels: {}, samples: [],
        versions: [{ version: 1, spec, settings: {}, pages: { kind: 'urls', urls: [] }, output: {}, digest, origin: 'built', note: '', author: 'a', createdAt: '2026-10-28T00:00:00Z' }],
    }, { 'idempotency-key': digest });
    call('POST', `/recipes/${recipeId}/versions/1/review`, { state: 'approved', by: 'reviewer', note: '' });
    call('POST', `/recipes/${recipeId}/labels/live`, { version: 1, reason: 'ship' });

    const dir = mkdtempSync(path.join(tmpdir(), 'crawler-'));
    writeFileSync(path.join(dir, 'crawler.json'), JSON.stringify({
        workerId: 'e2e-worker', concurrency: 3, navigationTimeoutMs: 15_000, settleMs: 0,
        retry: { maxAttempts: 4, baseDelayMs: 100, maxDelayMs: 1000, maxInlineWaitMs: 5000 },
        sites: { default: { minDelayMs: 50, maxDelayMs: 2000, concurrency: 2, cooldownBaseMs: 400, cooldownMaxMs: 1500, blockAfter: 3, respectRobots: true, locale: 'de-DE' } },
        recipeStore: { url: mock.origin, token: '${STORE_TOKEN}' },
        search: { url: es.origin, flushMs: 200 },
    }));
    const job = (jobId: string, url: string, extra = {}) => JSON.stringify({ jobId, url, competitor: 'acme', pageType: 'product', runId: 'run-1', ...extra });
    writeFileSync(path.join(dir, 'jobs.jsonl'), [
        job('j-ok', `${shop.origin}/p/1`),
        job('j-flaky', `${shop.origin}/flaky`),
        job('j-limited', `${shop.origin}/limited`),
        job('j-missing', `${shop.origin}/missing`),
        job('j-robots', `${shop.origin}/private/x`),
        job('j-blocked', `${wall.origin}/p/9`),
        job('j-captcha', `${wall.origin}/captcha`),
        job('j-norecipe', `${shop.origin}/p/2`, { pageType: 'listing' }),
    ].join('\n'));

    const out = await new Promise<string>((resolve, reject) => {
        const child = spawn('node', [WORKER, '--config', 'crawler.json', '--jobs', 'jobs.jsonl', '--dead-letter', 'dead.jsonl'], { cwd: dir, env: { ...process.env, STORE_TOKEN: 'dev-token' } });
        let log = '';
        child.stdout.on('data', c => { log += c; });
        child.stderr.on('data', c => { log += c; });
        const cap = setTimeout(() => { child.kill(); reject(new Error(`worker still running after 120 s:\n${log}`)); }, 120_000);
        child.on('exit', code => { clearTimeout(cap); if (code === 0) resolve(log); else reject(new Error(`worker exited ${code}:\n${log}`)); });
    });
    expect(out).toContain('8 jobs: 3 read, 2 failed, 3 dead-lettered');

    // Dead letters, for a person: no recipe for the page type, and the site that kept blocking.
    const dead = readFileSync(path.join(dir, 'dead.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    expect(dead.map(d => d.jobId).sort()).toEqual(['j-blocked', 'j-captcha', 'j-norecipe']);
    expect(dead.find(d => d.jobId === 'j-blocked')).toMatchObject({ reason: 'blocked', attempts: 3 });

    // Scrapes: the values the recipe read, and a missing page recorded as such.
    const scrapes = docs.filter(d => d.index === 'scrapes-acme');
    const scrape = (id: string) => scrapes.find(d => d.id === id)?.doc;
    expect(scrape('j-ok')).toMatchObject({ pageStatus: 'ok', recipeId, version: 1, digest, runId: 'run-1', attributes: { title: 'Linen shirt', price: '29,90 €' }, fieldStatus: { title: 'ok', price: 'ok' } });
    expect(scrape('j-flaky')).toMatchObject({ pageStatus: 'ok', attributes: { title: 'Cotton shirt' } });
    expect(scrape('j-limited')).toMatchObject({ pageStatus: 'ok' });
    expect(scrape('j-missing')).toMatchObject({ pageStatus: 'not_found', attributes: {} });

    // Selector usage: the dead selector tried and found nothing; h1 found the title and won.
    const usage = docs.find(d => d.index.startsWith('selector-usage-') && d.id === 'j-ok')!.doc;
    expect(usage.ways).toEqual([
        { field: 'title', wayId: 'w-old', tried: true, matched: false, won: false },
        { field: 'title', wayId: 'w-h1', tried: true, matched: true, won: true },
        { field: 'price', wayId: 'w-price', tried: true, matched: true, won: true },
    ]);

    // Request events: one per attempt, with status, headers, timings, the error class and what came next.
    const events = docs.filter(d => d.index.startsWith('crawl-requests-')).map(d => d.doc);
    const of = (id: string) => events.filter(e => e.jobId === id).sort((a, b) => a.attempt - b.attempt);
    expect(of('j-ok')).toHaveLength(1);
    expect(of('j-ok')[0]).toMatchObject({ attempt: 1, final: true, outcome: 'success', status: 200, errorClass: 'none', worker: 'e2e-worker', fieldsFilled: 2, fieldsTotal: 2, headers: { server: 'test-shop' }, recipe: { recipeId, version: 1 } });
    expect(of('j-ok')[0].requestHeaders['accept-language']).toContain('de-DE');
    expect(of('j-ok')[0].timings.totalMs).toBeGreaterThan(0);
    expect(of('j-flaky').map(e => [e.status, e.errorClass, e.outcome])).toEqual([[503, 'server_error', 'retry'], [200, 'none', 'success']]);
    expect(of('j-limited').map(e => [e.status, e.errorClass, e.outcome, e.retryAfterMs])).toEqual([[429, 'rate_limited', 'deferred', 1000], [200, 'none', 'success', undefined]]);
    expect(of('j-missing')[0]).toMatchObject({ status: 404, errorClass: 'not_found', outcome: 'failed' });
    expect(of('j-robots')[0]).toMatchObject({ errorClass: 'robots_disallowed', outcome: 'failed' });
    expect(of('j-norecipe')[0]).toMatchObject({ errorClass: 'no_recipe', outcome: 'dead_letter' });
    const blocked = of('j-blocked');
    expect(blocked[0]).toMatchObject({ status: 403, errorClass: 'blocked', blockSignal: 'status 403 + cf-mitigated: challenge + block page', outcome: 'deferred', headers: { 'cf-mitigated': 'challenge' } });
    expect(blocked[blocked.length - 1]).toMatchObject({ final: true, outcome: 'dead_letter' });
    expect(of('j-captcha').some(e => e.errorClass === 'captcha')).toBe(true);

    // Site events: the blocking site cooled down, then was marked blocked.
    const sites = docs.filter(d => d.index.startsWith('crawl-sites-')).map(d => d.doc).filter(e => e.host === new URL(wall.origin).host);
    expect(sites.map(e => e.state)).toContain('cooldown');
    expect(sites.map(e => e.state)).toContain('blocked');

    for (const s of [shop, wall, es]) s.close();
    mock.close();
});
