/**
 * The crawler worker end to end, as it ships: `npm run crawler:build`, then `dist/worker.mjs` run on a
 * file of jobs, with Chromium. Around it: two local sites (a shop, and one that blocks), Pro's mock
 * backend as the recipe store, and a fake Elasticsearch that keeps every bulk it is sent.
 */
import { expect, test } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
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

test.beforeAll(() => {
    execFileSync('npm', ['run', 'crawler:build'], { cwd: ROOT, stdio: 'ignore' });
    expect(existsSync(WORKER)).toBe(true);
});

type Doc = { index: string; id?: string; doc: Record<string, any> };

/** Elasticsearch: keeps each bulk's documents. */
async function fakeElasticsearch(): Promise<{ origin: string; docs: Doc[]; close: () => void }> {
    const docs: Doc[] = [];
    const server = await serve((req, res) => {
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
    return { ...server, docs };
}

/**
 * The recipe store: an approved, live recipe. By default acme's product recipe, whose title has a dead
 * selector before h1.
 */
async function publishRecipe(backend: Awaited<ReturnType<typeof serveMockBackend>>['backend'],
    o: { spec?: object; competitor?: string; pageType?: string } = {}) {
    const { specDigest } = await import('../src/pro/recipe/canonical');
    const { competitor = 'acme', pageType = 'product' } = o;
    const spec = (o.spec ?? { kind: 'page', steps: [
        { kind: 'field', field: { id: 'f-title', name: 'title', type: 'text', read: 'text', ops: [], ways: [
            { id: 'w-old', addedIn: 1, kind: 'selector', selector: 'h1.product-name' },
            { id: 'w-h1', addedIn: 1, kind: 'selector', selector: 'h1' },
        ] } },
        { kind: 'field', field: { id: 'f-price', name: 'price', type: 'text', read: 'text', ops: [], ways: [{ id: 'w-price', addedIn: 1, kind: 'selector', selector: '.price' }] } },
    ] }) as { kind: string };
    const digest = await specDigest(spec as never);
    const call = (method: string, p: string, body?: unknown, headers: Record<string, string> = {}) =>
        backend.handle({ method, path: p, headers: { authorization: 'Bearer dev-token', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }).body as any;
    const recipe = { name: `${competitor} ${pageType}`, site: '127.0.0.1', kind: spec.kind, competitor, pageType };
    const { id: recipeId } = call('POST', '/recipes', recipe);
    call('POST', `/recipes/${recipeId}/versions`, {
        format: 3, recipe, labels: {}, samples: [],
        versions: [{ version: 1, spec, settings: {}, pages: { kind: 'urls', urls: [] }, output: {}, digest, origin: 'built', note: '', author: 'a', createdAt: '2026-10-28T00:00:00Z' }],
    }, { 'idempotency-key': digest });
    call('POST', `/recipes/${recipeId}/versions/1/review`, { state: 'approved', by: 'reviewer', note: '' });
    call('POST', `/recipes/${recipeId}/labels/live`, { version: 1, reason: 'ship' });
    return { recipeId: recipeId as string, digest };
}

/**
 * The built worker on `dir`'s crawler.json and jobs.jsonl; its output, once it exits. With `CRAWLER_IMAGE`
 * set, the worker runs in that container image instead (host network, `dir` mounted), testing the image.
 */
function runCli(dir: string, env: Record<string, string> = {}): Promise<string> {
    const vars = { STORE_TOKEN: 'dev-token', ...env };
    const cli = ['--config', 'crawler.json', '--jobs', 'jobs.jsonl', '--dead-letter', 'dead.jsonl'];
    const image = process.env.CRAWLER_IMAGE;
    if (image) chmodSync(dir, 0o777);
    const [cmd, args] = image
        ? ['docker', ['run', '--rm', '--network', 'host', '-v', `${dir}:/work`, '-w', '/work', ...Object.entries(vars).flatMap(([k, v]) => ['-e', `${k}=${v}`]), image, ...cli]]
        : ['node', [WORKER, ...cli]];
    return new Promise<string>((resolve, reject) => {
        const child = spawn(cmd, args as string[], { cwd: dir, env: { ...process.env, ...vars } });
        let log = '';
        child.stdout.on('data', c => { log += c; });
        child.stderr.on('data', c => { log += c; });
        const cap = setTimeout(() => { child.kill(); reject(new Error(`worker still running after 120 s:\n${log}`)); }, 120_000);
        child.on('exit', code => { clearTimeout(cap); if (code === 0) resolve(log); else reject(new Error(`worker exited ${code}:\n${log}`)); });
    });
}

test('crawler worker: reads pages with the live recipe, retries, backs off on blocks, and reports to Elasticsearch', async () => {
    test.setTimeout(180_000);

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
    const es = await fakeElasticsearch();
    const docs = es.docs;
    const mock = await serveMockBackend();
    const { recipeId, digest } = await publishRecipe(mock.backend);

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

    const out = await runCli(dir);
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
    expect(blocked[0]).toMatchObject({
        status: 403, errorClass: 'blocked', blockSignal: 'status 403 + cf-mitigated: challenge + block wording', outcome: 'deferred', headers: { 'cf-mitigated': 'challenge' },
        blockVendor: 'Cloudflare', blockKind: 'challenge', blockConfidence: 'high', protection: ['Cloudflare'],
        blockEvidence: { title: 'Access denied', textSample: 'You have been blocked.' },
    });
    expect(blocked[blocked.length - 1]).toMatchObject({ final: true, outcome: 'dead_letter' });
    expect(of('j-captcha').some(e => e.errorClass === 'captcha')).toBe(true);

    // Site events: the blocking site cooled down, then was marked blocked, with the vendor.
    const sites = docs.filter(d => d.index.startsWith('crawl-sites-')).map(d => d.doc).filter(e => e.host === new URL(wall.origin).host);
    expect(sites.map(e => e.state)).toContain('cooldown');
    expect(sites.find(e => e.state === 'cooldown' && e.vendor === 'Cloudflare')).toBeTruthy();
    expect(sites.map(e => e.state)).toContain('blocked');

    for (const s of [shop, wall, es]) s.close();
    mock.close();
});

test('crawler worker: identifies the bot protection a site uses, a vendor\'s captcha, and a soft block no vendor marks', async () => {
    test.setTimeout(120_000);
    // A shop behind a bot manager: its cookie and sensor script on every page. Its pages are long; once, it
    // answers /p/9 with a short 200 stub that has none of the recipe's fields.
    const LONG = (title: string) => PRODUCT(title).replace('</p>', `${'Made in Portugal from European flax, washed for softness, with mother-of-pearl buttons. '.repeat(20)}</p>`)
        .replace('</head>', '<script src="https://client.perimeterx.net/PXtest/main.min.js" async></script></head>');
    let stubbed = false;
    const shop = await serve((req, res) => {
        if (req.url === '/robots.txt') return html(res, 404, '');
        const cookie = { 'set-cookie': '_pxhd=SECRETVALUE; path=/' };
        if (req.url === '/p/9' && !stubbed) {
            stubbed = true;
            return html(res, 200, '<title>Shop</title><p>Our shop is taking a short break. Thank you for your patience, we will be right back with you soon.</p>', cookie);
        }
        return html(res, 200, LONG(`Shirt ${req.url}`), cookie);
    });
    // A site behind AWS WAF that answers with its captcha.
    const waf = await serve((req, res) => req.url === '/robots.txt' ? html(res, 404, '') : html(res, 405, '<title></title><div id="captcha-container"></div>', { 'x-amzn-waf-action': 'captcha' }));
    const es = await fakeElasticsearch();
    const mock = await serveMockBackend();
    await publishRecipe(mock.backend);
    const dir = mkdtempSync(path.join(tmpdir(), 'crawler-detect-'));
    writeFileSync(path.join(dir, 'crawler.json'), JSON.stringify({
        workerId: 'e2e-worker', concurrency: 1, navigationTimeoutMs: 10_000, settleMs: 0,
        retry: { maxAttempts: 2, baseDelayMs: 100, maxDelayMs: 500, maxInlineWaitMs: 5000 },
        sites: { default: { minDelayMs: 20, cooldownBaseMs: 300, cooldownMaxMs: 600, blockResources: ['script'] } },
        recipeStore: { url: mock.origin, token: '${STORE_TOKEN}' },
        search: { url: es.origin, flushMs: 200 },
    }));
    const job = (jobId: string, url: string) => JSON.stringify({ jobId, url, competitor: 'acme', pageType: 'product' });
    writeFileSync(path.join(dir, 'jobs.jsonl'), [
        ...[1, 2, 3, 4, 5].map(n => job(`j-${n}`, `${shop.origin}/p/${n}`)),
        job('j-9', `${shop.origin}/p/9`),
        job('j-waf', `${waf.origin}/p/1`),
    ].join('\n'));

    const out = await runCli(dir);
    expect(out).toContain('7 jobs: 6 read, 0 failed, 1 dead-lettered');
    const events = es.docs.filter(d => d.index.startsWith('crawl-requests-')).map(d => d.doc);
    const of = (id: string) => events.filter(e => e.jobId === id).sort((a, b) => a.attempt - b.attempt);

    // Every page of the shop names its protection, and is read as a page.
    expect(of('j-1')[0]).toMatchObject({ errorClass: 'none', protection: ['HUMAN'], fieldsFilled: 2 });
    expect(of('j-1')[0].textLength).toBeGreaterThan(1500);
    // The stub: no vendor mark, but no data and far shorter than the shop's pages. Waited out, then read.
    expect(of('j-9').map(e => [e.errorClass, e.outcome])).toEqual([['blocked', 'deferred'], ['none', 'success']]);
    expect(of('j-9')[0]).toMatchObject({ blockKind: 'soft_block', blockVendor: 'HUMAN', blockConfidence: 'medium', fieldsFilled: 0, blockEvidence: { cookieNames: ['_pxhd'] } });
    expect(of('j-9')[0].blockSignal).toMatch(/^soft block: no data, page \d+% of its usual length/);
    // The WAF's captcha: identified by the header it sends only when it challenges.
    expect(of('j-waf')[0]).toMatchObject({ status: 405, errorClass: 'captcha', blockVendor: 'AWS WAF', blockKind: 'captcha', blockConfidence: 'high' });
    // Cookie values are never written.
    expect(JSON.stringify(es.docs)).not.toContain('SECRETVALUE');

    for (const s of [shop, waf, es]) s.close();
    mock.close();
});

test('crawler worker: sets the location and store a retailer page needs, chooses fulfilment, and reads it per ZIP code', async () => {
    test.setTimeout(180_000);
    // The retailer page (e2e/site/retailer.html): consent banner, "Deliver to" ZIP dialog, store list, promo,
    // fulfilment tiles. Its state is in cookies, as real ones keep it.
    const RETAILER = readFileSync(path.join(ROOT, 'e2e/site/retailer.html'), 'utf8');
    const shop = await serve((req, res) => req.url === '/robots.txt' ? html(res, 404, '') : html(res, 200, RETAILER));
    const es = await fakeElasticsearch();
    const mock = await serveMockBackend();
    const sel = (selector: string) => ({ kind: 'selector', selector });
    const act = (id: string, name: string, selector: string | string[], extra = {}) => ({ id, name, ways: (Array.isArray(selector) ? selector : [selector]).map(sel), ...extra });
    const field = (id: string, name: string, selector: string) => ({ kind: 'field', field: { id, name, type: 'text', read: 'text', ops: [], ways: [sel(selector)] } });
    const spec = {
        kind: 'page',
        setup: {
            // Closed whenever they show, on every page: the consent banner, and the promo that pops up after load.
            dismiss: [act('d-consent', 'Cookie banner', '#consent-reject'), act('d-promo', 'Promo', '#promo-close')],
            steps: [
                act('s-open', 'Open location', '#deliver-to'),
                act('s-zip', 'Type ZIP', '#zip-input', { do: 'type', value: '{zip}' }),
                act('s-apply', 'Apply ZIP', '#zip-apply'),
                act('s-store', 'Open stores', '#store-link'),
                act('s-pick', 'Choose store', ['.store-list li button'], { do: 'choose', value: '{store}' }),
            ],
            check: { ways: [sel('#loc-label')], contains: '{zip}' },
        },
        steps: [
            field('f-title', 'title', 'h1.product-title'),
            field('f-price', 'price', '#price'),
            // Optional: skipped when there is no "Show more" (there isn't).
            { kind: 'click', click: act('p-more', 'Show more', '#show-more', { optional: true }) },
            { kind: 'click', click: act('p-pickup', 'Pickup', '.fulfil-tile', { do: 'choose', value: 'Pickup' }) },
            field('f-pickup', 'pickup', '#fulfil-detail'),
            { kind: 'click', click: act('p-delivery', 'Delivery', '.fulfil-tile', { do: 'choose', value: 'Delivery' }) },
            field('f-delivery', 'delivery', '#fulfil-detail'),
        ],
    };
    await publishRecipe(mock.backend, { spec, competitor: 'retail', pageType: 'product' });

    const dir = mkdtempSync(path.join(tmpdir(), 'crawler-steps-'));
    writeFileSync(path.join(dir, 'crawler.json'), JSON.stringify({
        workerId: 'e2e-worker', concurrency: 1, navigationTimeoutMs: 15_000, settleMs: 0,
        retry: { maxAttempts: 2, baseDelayMs: 100, maxDelayMs: 500, maxInlineWaitMs: 5000 },
        sites: { default: { minDelayMs: 20 } },
        recipeStore: { url: mock.origin, token: '${STORE_TOKEN}' },
        search: { url: es.origin, flushMs: 200 },
    }));
    const job = (jobId: string, p: string, context?: Record<string, string>) =>
        JSON.stringify({ jobId, url: `${shop.origin}${p}`, competitor: 'retail', pageType: 'product', ...(context ? { context } : {}) });
    writeFileSync(path.join(dir, 'jobs.jsonl'), [
        job('lamp', '/p/lamp', { zip: '10001', store: 'Chelsea' }),
        job('lamp', '/p/lamp', { zip: '94105', store: 'SoMa' }),
        job('lamp-2', '/p/lamp-2', { zip: '10001', store: 'Chelsea' }),
        job('no-zip', '/p/lamp'),
        job('bad-zip', '/p/lamp', { zip: '00000', store: 'Chelsea' }),
        job('moved-zip', '/p/lamp', { zip: '60601', store: 'Loop' }),
    ].join('\n'));

    const out = await runCli(dir);
    expect(out).toContain('6 jobs: 3 read, 0 failed, 3 dead-lettered');
    const scrape = (id: string) => es.docs.find(d => d.index === 'scrapes-retail' && d.id === id)?.doc;

    // Each ZIP code's values, in a document of its own, with the location it is for.
    expect(scrape('lamp~store=Chelsea,zip=10001')).toMatchObject({
        context: { zip: '10001', store: 'Chelsea' },
        attributes: { title: 'Brass desk lamp', price: '$12.99', pickup: 'Pickup today at Chelsea: In stock', delivery: 'Delivery tomorrow to 10001' },
    });
    expect(scrape('lamp~store=SoMa,zip=94105')).toMatchObject({
        context: { zip: '94105', store: 'SoMa' },
        attributes: { price: '$14.49', pickup: 'Pickup today at SoMa: Only 3 left', delivery: 'Delivery tomorrow to 94105' },
    });

    // The setup ran once per session: the second 10001 page found the location already set.
    const events = es.docs.filter(d => d.index.startsWith('crawl-requests-')).map(d => d.doc);
    const of = (id: string, zip?: string) => events.filter(e => e.jobId === id && (!zip || e.context?.zip === zip));
    expect(of('lamp', '10001')[0]).toMatchObject({ errorClass: 'none', setup: { ran: true }, context: { zip: '10001' } });
    expect(of('lamp-2')[0]).toMatchObject({ errorClass: 'none', setup: { ran: false } });

    // A job without the ZIP its recipe needs is a person's to fix. A ZIP the site refuses fails the setup at the
    // step that can't go on; one it serves as another area fails the check: never read for the wrong location.
    expect(of('no-zip')[0]).toMatchObject({ errorClass: 'missing_context', outcome: 'dead_letter' });
    expect(of('bad-zip')[0]).toMatchObject({ errorClass: 'setup_failed', setup: { ran: true, failedStep: 'Open stores' } });
    expect(of('moved-zip')[0]).toMatchObject({ errorClass: 'setup_failed', setup: { ran: true, failedStep: 'check' } });
    expect(of('moved-zip')[0].errorMessage).toContain('should show "60601", but it shows "60602"');
    expect(es.docs.some(d => d.index === 'scrapes-retail' && d.doc.context?.zip === '60601')).toBe(false);
    const dead = readFileSync(path.join(dir, 'dead.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    expect(dead.map(d => d.jobId).sort()).toEqual(['bad-zip', 'moved-zip', 'no-zip']);

    // The setup's and steps' selectors are counted like fields'.
    const usage = es.docs.find(d => d.index.startsWith('selector-usage-') && d.id === 'lamp~store=Chelsea,zip=10001')!.doc;
    expect(usage.ways).toEqual(expect.arrayContaining([
        expect.objectContaining({ field: 'setup: Type ZIP', tried: true, matched: true, won: true }),
        expect.objectContaining({ field: 'click: Delivery', tried: true, matched: true, won: true }),
    ]));

    for (const s of [shop, es]) s.close();
    mock.close();
});

test('crawler worker: reads fields from the page\'s meta tags and microdata when selectors find nothing', async () => {
    test.setTimeout(90_000);
    const PAGE = readFileSync(path.join(ROOT, 'e2e/site/microdata-product.html'), 'utf8');
    const shop = await serve((req, res) => req.url === '/robots.txt' ? html(res, 404, '') : html(res, 200, PAGE));
    const es = await fakeElasticsearch();
    const mock = await serveMockBackend();
    const field = (id: string, name: string, ways: object[]) => ({ kind: 'field', field: { id, name, type: 'text', read: 'text', ops: [], ways } });
    await publishRecipe(mock.backend, { competitor: 'marked', pageType: 'product', spec: { kind: 'page', steps: [
        // The old layout's selectors first in the list, the markup read before them anyway.
        field('f-title', 'title', [{ id: 'w-old', kind: 'selector', selector: 'h1.product-title' }, { id: 'w-og', kind: 'markup', source: 'meta', key: 'og:title' }]),
        field('f-price', 'price', [{ id: 'w-price', kind: 'markup', source: 'microdata', type: 'Product', key: 'offers.price' }]),
        field('f-currency', 'currency', [{ id: 'w-cur', kind: 'markup', source: 'meta', key: 'product:price:currency' }]),
        field('f-stock', 'availability', [{ id: 'w-stock', kind: 'markup', source: 'microdata', type: 'Product', key: 'offers.availability' }]),
        field('f-sku', 'sku', [{ id: 'w-sku', kind: 'markup', source: 'microdata', type: 'Product', key: 'sku' }]),
    ] } });
    const dir = mkdtempSync(path.join(tmpdir(), 'crawler-markup-'));
    writeFileSync(path.join(dir, 'crawler.json'), JSON.stringify({
        workerId: 'e2e-worker', concurrency: 1, navigationTimeoutMs: 15_000, settleMs: 0,
        retry: { maxAttempts: 1, baseDelayMs: 100, maxDelayMs: 500, maxInlineWaitMs: 5000 },
        sites: { default: { minDelayMs: 20 } },
        recipeStore: { url: mock.origin, token: '${STORE_TOKEN}' },
        search: { url: es.origin, flushMs: 200 },
    }));
    writeFileSync(path.join(dir, 'jobs.jsonl'), JSON.stringify({ jobId: 'shirt', url: `${shop.origin}/p/shirt`, competitor: 'marked', pageType: 'product' }));

    expect(await runCli(dir)).toContain('1 jobs: 1 read');
    const scrape = es.docs.find(d => d.index === 'scrapes-marked' && d.id === 'shirt')!.doc;
    expect(scrape).toMatchObject({ pageStatus: 'ok', attributes: { title: 'Linen overshirt', price: '79.00', currency: 'GBP', availability: 'https://schema.org/InStock', sku: 'LX-2041' }, fieldStatus: { title: 'ok', price: 'ok' } });
    // Selector usage: the markup won; the old selector was tried and matched nothing.
    const usage = es.docs.find(d => d.index.startsWith('selector-usage-') && d.id === 'shirt')!.doc;
    expect(usage.ways).toEqual(expect.arrayContaining([
        { field: 'title', wayId: 'w-og', tried: true, matched: true, won: true },
        { field: 'title', wayId: 'w-old', tried: true, matched: false, won: false },
        { field: 'price', wayId: 'w-price', tried: true, matched: true, won: true },
    ]));
    for (const s of [shop, es]) s.close();
    mock.close();
});

test('crawler worker: reads a product once per fulfilment method, one document each', async () => {
    test.setTimeout(120_000);
    const RETAILER = readFileSync(path.join(ROOT, 'e2e/site/retailer.html'), 'utf8');
    const shop = await serve((req, res) => req.url === '/robots.txt' ? html(res, 404, '') : html(res, 200, RETAILER));
    const es = await fakeElasticsearch();
    const mock = await serveMockBackend();
    const sel = (selector: string) => ({ kind: 'selector', selector });
    const act = (id: string, name: string, selector: string, extra = {}) => ({ id, name, ways: [sel(selector)], ...extra });
    const field = (id: string, name: string, selector: string) => ({ kind: 'field', field: { id, name, type: 'text', read: 'text', ops: [], ways: [sel(selector)] } });
    await publishRecipe(mock.backend, { competitor: 'retail', pageType: 'product', spec: {
        kind: 'page',
        setup: {
            dismiss: [act('d1', 'Cookie banner', '#consent-reject'), act('d2', 'Promo', '#promo-close')],
            steps: [act('s1', 'Open location', '#deliver-to'), act('s2', 'Type ZIP', '#zip-input', { do: 'type', value: '{zip}' }), act('s3', 'Apply', '#zip-apply'),
                act('s4', 'Open stores', '#store-link'), act('s5', 'Choose store', '.store-list li button', { do: 'choose', value: '{store}' })],
            check: { ways: [sel('#loc-label')], contains: '{zip}' },
        },
        steps: [
            field('f-title', 'title', 'h1.product-title'),
            // Every tile the page shows, in its order: the fields after it are read for each.
            { kind: 'click', click: act('p-tile', 'Fulfilment', '.fulfil-tile', { do: 'choose', forEach: {} }) },
            field('f-detail', 'detail', '#fulfil-detail'),
            field('f-price', 'price', '#price'),
        ],
    } });
    const dir = mkdtempSync(path.join(tmpdir(), 'crawler-each-'));
    writeFileSync(path.join(dir, 'crawler.json'), JSON.stringify({
        workerId: 'e2e-worker', concurrency: 1, navigationTimeoutMs: 15_000, settleMs: 0,
        retry: { maxAttempts: 1, baseDelayMs: 100, maxDelayMs: 500, maxInlineWaitMs: 5000 },
        sites: { default: { minDelayMs: 20 } },
        recipeStore: { url: mock.origin, token: '${STORE_TOKEN}' },
        search: { url: es.origin, flushMs: 200 },
    }));
    writeFileSync(path.join(dir, 'jobs.jsonl'), JSON.stringify({ jobId: 'lamp', url: `${shop.origin}/p/lamp`, competitor: 'retail', pageType: 'product', context: { zip: '10001', store: 'Chelsea' } }));

    const out = await runCli(dir);
    expect(out).toContain('1 jobs: 1 read');
    const docs = es.docs.filter(d => d.index === 'scrapes-retail').sort((a, b) => String(a.id).localeCompare(String(b.id)));
    expect(docs.map(d => d.id)).toEqual([
        'lamp~store=Chelsea,zip=10001~opt=Delivery', 'lamp~store=Chelsea,zip=10001~opt=Pickup', 'lamp~store=Chelsea,zip=10001~opt=Shipping',
    ]);
    const by = (v: string) => docs.find(d => d.doc.option?.value === v)!.doc;
    expect(by('Pickup')).toMatchObject({ option: { step: 'Fulfilment', value: 'Pickup' }, context: { zip: '10001' }, attributes: { title: 'Brass desk lamp', price: '$12.99', detail: 'Pickup today at Chelsea: In stock' } });
    expect(by('Delivery').attributes).toMatchObject({ detail: 'Delivery tomorrow to 10001', price: '$12.99' });
    expect(by('Shipping').attributes).toMatchObject({ detail: 'Ships in 3–5 days' });

    for (const s of [shop, es]) s.close();
    mock.close();
});

test('crawler worker: goes through the site\'s proxy with its credentials, and fails over from a dead one', async () => {
    test.setTimeout(120_000);
    const shop = await serve((req, res) => req.url === '/robots.txt' ? html(res, 404, '') : html(res, 200, PRODUCT('Linen shirt')));
    // A forward proxy that wants credentials: 407 without them, as real ones answer.
    const through: string[] = [];
    const proxy = await serve((req, res) => {
        if (req.headers['proxy-authorization'] !== `Basic ${Buffer.from('crawler:s3cret').toString('base64')}`) {
            res.writeHead(407, { 'proxy-authenticate': 'Basic realm="proxy"' });
            return res.end();
        }
        through.push(req.url ?? '');
        const target = new URL(req.url ?? '');
        const upstream = httpRequest({ host: target.hostname, port: target.port, path: target.pathname + target.search, method: req.method, headers: { ...req.headers, host: target.host } }, up => {
            res.writeHead(up.statusCode ?? 502, up.headers);
            up.pipe(res);
        });
        upstream.on('error', () => { res.writeHead(502); res.end(); });
        req.pipe(upstream);
    });
    // A proxy that is gone: its port is closed.
    const gone = await serve(() => {});
    gone.close();

    const es = await fakeElasticsearch();
    const mock = await serveMockBackend();
    await publishRecipe(mock.backend);
    const dir = mkdtempSync(path.join(tmpdir(), 'crawler-proxy-'));
    writeFileSync(path.join(dir, 'crawler.json'), JSON.stringify({
        workerId: 'e2e-worker', concurrency: 1, navigationTimeoutMs: 10_000, settleMs: 0,
        retry: { maxAttempts: 4, baseDelayMs: 100, maxDelayMs: 500, maxInlineWaitMs: 5000 },
        proxyPools: { eu: [
            { id: 'eu-gone', server: gone.origin, country: 'DE', bypass: '<-loopback>' },
            { id: 'eu-good', server: proxy.origin, username: 'crawler', password: '${PROXY_PASS}', country: 'DE', bypass: '<-loopback>' },
        ] },
        sites: { default: { minDelayMs: 50, proxyPool: 'eu', proxyCountry: 'DE' } },
        recipeStore: { url: mock.origin, token: '${STORE_TOKEN}' },
        search: { url: es.origin, flushMs: 200 },
    }));
    writeFileSync(path.join(dir, 'jobs.jsonl'), JSON.stringify({ jobId: 'j-proxy', url: `${shop.origin}/p/1`, competitor: 'acme', pageType: 'product' }));

    const out = await runCli(dir, { PROXY_PASS: 's3cret' });
    expect(out).toContain('1 jobs: 1 read');

    // The page went through the good proxy, after the dead one failed at the proxy's end.
    expect(through).toContain(`${shop.origin}/p/1`);
    const events = es.docs.filter(d => d.index.startsWith('crawl-requests-')).map(d => d.doc).sort((a, b) => a.attempt - b.attempt);
    expect(events.map(e => [e.proxyId, e.errorClass, e.outcome])).toEqual([['eu-gone', 'proxy', 'retry'], ['eu-good', 'none', 'success']]);
    expect(events[1]).toMatchObject({ proxyCountry: 'DE', status: 200 });
    // The password is nowhere in what was written.
    expect(JSON.stringify(es.docs)).not.toContain('s3cret');
    expect(es.docs.find(d => d.index === 'scrapes-acme')?.doc).toMatchObject({ attributes: { title: 'Linen shirt' } });

    for (const s of [shop, proxy, es]) s.close();
    mock.close();
});

test('crawler worker: reads list recipes, follows Next links and details pages as jobs, and clicks Load more', async () => {
    test.setTimeout(120_000);
    const card = (n: number) => `<li class="card"><a class="card-link" href="/item/${n}"><h3 class="card-title">Lamp ${n}</h3></a><span class="price">$${n}0.99</span></li>`;
    const page = (title: string, cards: string, more = '') => `<!doctype html><title>${title}</title><body><h1>${title}</h1>
<p>${'Lamps for every room, in brass, glass and linen. '.repeat(4)}</p><ul id="results">${cards}</ul>${more}</body>`;
    const shop = await serve((req, res) => {
        const url = req.url ?? '/';
        if (url === '/robots.txt') return html(res, 404, '');
        if (url === '/list/1') return html(res, 200, page('Lamps', [1, 2, 3].map(card).join(''), '<a class="next" href="/list/2">Next</a>'));
        if (url === '/list/2') return html(res, 200, page('Lamps, page 2', [4, 5].map(card).join(''), '<a class="next disabled">Next</a>'));
        const item = /^\/item\/(\d+)$/.exec(url);
        if (item) return html(res, 200, PRODUCT(`Lamp ${item[1]} detail`));
        // Load more: two cards, then two more per click, until the button is spent.
        if (url === '/more') return html(res, 200, page('More lamps', [1, 2].map(card).join(''), `<button class="more">Load more</button>
<script>let n = 2; document.querySelector('.more').onclick = e => { setTimeout(() => {
  for (let i = 0; i < 2; i++) { n++; document.querySelector('#results').insertAdjacentHTML('beforeend', ${JSON.stringify(card(0))}.replace(/0/g, String(n))); }
  if (n >= 6) e.target.setAttribute('disabled', ''); }, 100); };</script>`));
        return html(res, 404, '<h1>Not found</h1>');
    });

    const reader = (chain: string, attr: string, shape: string) => ({ v: 3, chain: [chain], attr, shape });
    const fields = [
        { id: 'c-title', name: 'title', type: 'text', reader: reader('.card-title', 'text', 'text') },
        { id: 'c-link', name: 'link', type: 'url', reader: reader('a.card-link', 'href', 'url') },
        { id: 'c-price', name: 'price', type: 'text', reader: reader('.price', 'text', 'price') },
    ];
    const lists = [{ id: 'L', container: ['#results'], items: ['li.card'], mode: 'list', fields }];
    const details = { urlColumn: 'c-link', spec: { kind: 'page', steps: [
        { kind: 'field', field: { id: 'd-name', name: 'name', type: 'text', read: 'text', ops: [], ways: [{ id: 'w-d-h1', addedIn: 1, kind: 'selector', selector: 'h1' }] } },
    ] } };

    const es = await fakeElasticsearch();
    const mock = await serveMockBackend();
    const paged = await publishRecipe(mock.backend, { competitor: 'lampco', pageType: 'listing', spec: { kind: 'list', lists, pagination: { mode: 'pagination', next: ['a.next'] }, details } });
    await publishRecipe(mock.backend, { competitor: 'moreco', pageType: 'listing', spec: { kind: 'list', lists, pagination: { mode: 'loadMore', next: ['button.more'] } } });

    const dir = mkdtempSync(path.join(tmpdir(), 'crawler-lists-'));
    writeFileSync(path.join(dir, 'crawler.json'), JSON.stringify({
        workerId: 'e2e-worker', concurrency: 2, navigationTimeoutMs: 15_000, settleMs: 0, maxListPages: 5,
        sites: { default: { minDelayMs: 20, concurrency: 2 } },
        recipeStore: { url: mock.origin, token: '${STORE_TOKEN}' },
        search: { url: es.origin, flushMs: 200 },
    }));
    writeFileSync(path.join(dir, 'jobs.jsonl'), [
        JSON.stringify({ jobId: 'j-list', url: `${shop.origin}/list/1`, competitor: 'lampco', pageType: 'listing', runId: 'run-2' }),
        JSON.stringify({ jobId: 'j-more', url: `${shop.origin}/more`, competitor: 'moreco', pageType: 'listing' }),
    ].join('\n'));
    const out = await runCli(dir);
    // Two jobs in the file; they led to page 2 and five details pages: 8 pages read.
    expect(out).toContain('2 jobs: 8 read, 0 failed, 0 dead-lettered');

    const scrapes = (index: string) => new Map(es.docs.filter(d => d.index === index).map(d => [d.id!, d.doc]));
    const lampco = scrapes('scrapes-lampco');
    expect(lampco.get('j-list~L~0')).toMatchObject({ page: 1, listId: 'L', row: 0, recipeId: paged.recipeId, runId: 'run-2', attributes: { title: 'Lamp 1', link: `${shop.origin}/item/1`, price: '$10.99' }, fieldStatus: { title: 'ok', link: 'ok', price: 'ok' } });
    expect(lampco.get('j-list~p2~L~1')).toMatchObject({ page: 2, url: `${shop.origin}/list/2`, attributes: { title: 'Lamp 5' } });
    expect(lampco.get('j-list~dL.2')).toMatchObject({ url: `${shop.origin}/item/3`, parent: { jobId: 'j-list', listId: 'L', row: 2 }, attributes: { name: 'Lamp 3 detail' } });
    expect(lampco.get('j-list~p2~dL.0')).toMatchObject({ parent: { jobId: 'j-list~p2', listId: 'L', row: 0 }, attributes: { name: 'Lamp 4 detail' } });
    expect([...lampco.keys()].filter(k => k.includes('~d'))).toHaveLength(5);

    const events = es.docs.filter(d => d.index.startsWith('crawl-requests-')).map(d => d.doc);
    expect(events.find(e => e.jobId === 'j-list')).toMatchObject({ outcome: 'success', rows: 3, listPages: 1, followUps: 4 });
    expect(events.find(e => e.jobId === 'j-list~p2')).toMatchObject({ rows: 2, followUps: 2 });

    // Load more: clicked until the button was spent, every card read once.
    const moreco = scrapes('scrapes-moreco');
    expect([...moreco.values()].map(d => d.attributes.title)).toEqual(['Lamp 1', 'Lamp 2', 'Lamp 3', 'Lamp 4', 'Lamp 5', 'Lamp 6']);
    expect(events.find(e => e.jobId === 'j-more')).toMatchObject({ rows: 6, listPages: 3, followUps: 0 });

    for (const s of [shop, es]) s.close();
    mock.close();
});
