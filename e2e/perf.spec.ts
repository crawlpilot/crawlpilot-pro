/**
 * Performance on slower machines (`docs/plans/performance-plan.md`). Off by default; run with
 * `PERF=1 npx playwright test e2e/perf.spec.ts` after `npm run build`. Each measure runs at CPU
 * slowdowns of 1× (the machine running it), 4× and 8× (Chrome's CPU throttling), and the results are
 * written to `test-results/perf.json` and printed as a table.
 *
 * - **Every page**: what the content script costs a page the user opens (script time, memory),
 *   against the same page without the extension.
 * - **Picker**: a hover (the picker's own measure) and a click until the pick's rows arrive.
 * - **Side panel**: opening it (until the home screen shows) and how much of its JS runs.
 * - **Data table**: opening a 2,000-row Page Extractor table with two list columns.
 */
import { chromium, type Page, type CDPSession } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { test, pickList } from './harness';

const RATES = [1, 4, 8];
const RUNS = 3;
const results: Record<string, Record<string, number>> = {};
const record = (name: string, rate: number, value: number) => { (results[name] ??= {})[`${rate}x`] = Math.round(value * 10) / 10; };
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

test.skip(!process.env.PERF, 'PERF=1 to measure');
test.describe.configure({ timeout: 600_000 });

async function throttle(page: Page, rate: number): Promise<CDPSession> {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    await cdp.send('Performance.enable');
    return cdp;
}

async function metrics(cdp: CDPSession): Promise<Record<string, number>> {
    const { metrics } = await cdp.send('Performance.getMetrics');
    return Object.fromEntries(metrics.map(m => [m.name, m.value]));
}

const PAGES = ['walmart-search-live', 'amazon-search', 'pdp-walmart', 'article-wikipedia'];

test('every page: what the content script costs', async ({ ext, origin }) => {
    const plain = await chromium.launch({ channel: 'chromium' });
    const bare = await plain.newContext();
    // Offline, as the harness: corpus pages point at their real sites.
    await bare.route(url => !/^(https?:\/\/127\.0\.0\.1[:/]|data:|blob:|about:)/.test(url.href), route => route.abort());
    for (const name of PAGES) {
        for (const rate of RATES) {
            for (const [label, ctx] of [['with', ext], ['without', bare]] as const) {
                const script: number[] = [], heap: number[] = [];
                for (let i = 0; i < RUNS; i++) {
                    const page = await ctx.newPage();
                    const cdp = await throttle(page, rate);
                    await page.goto(`${origin}/corpus/${name}`, { waitUntil: 'load' });
                    // document_idle has passed and the script has run; let it settle.
                    await page.waitForTimeout(1500);
                    const m = await metrics(cdp);
                    script.push(m.ScriptDuration * 1000);
                    heap.push(m.JSHeapUsedSize / 1048576);
                    await page.close();
                }
                record(`page ${name} · script ms (${label})`, rate, median(script));
                record(`page ${name} · JS heap MB (${label})`, rate, median(heap));
            }
        }
    }
    await plain.close();
});

const PICKS = [
    { page: 'walmart-search-live', card: '[data-testid="item-stack"] [data-item-id] >> nth=2', title: '[data-testid="item-stack"] [data-item-id] >> nth=2 >> [data-automation-id="product-title"]' },
    { page: 'amazon-search', card: '[data-component-type="s-search-result"] >> nth=2', title: '[data-component-type="s-search-result"] >> nth=2 >> h2' },
    { page: 'chewy-plp', card: '[data-testid="plp-product-card"] >> nth=2', title: '[data-testid="plp-product-card"] >> nth=2 >> .chirp-title' },
];

test('picker: hover and pick', async ({ ext, origin, panel }) => {
    for (const p of PICKS) {
        for (const rate of RATES) {
            const hovers: number[] = [], firstHovers: number[] = [], picks: number[] = [];
            for (let i = 0; i < RUNS; i++) {
                const page = await ext.newPage();
                await page.setViewportSize({ width: 1280, height: 800 });
                await page.goto(`${origin}/corpus/${p.page}`);
                await throttle(page, rate);
                await page.evaluate(() => document.documentElement.setAttribute('data-cp-debug', ''));
                await panel.toTab(await panel.tabId(page.url()), 'START_PICKER', { mode: 'list', action: 'extract' });
                const loc = page.locator(p.title);
                await loc.evaluate(el => el.scrollIntoView({ block: 'center' }));
                const box = (await loc.boundingBox())!;
                for (let h = 0; h < 4; h++) {
                    await page.mouse.move(box.x + 6 + h * 3, box.y + 6);
                    await page.waitForTimeout(250 * rate);
                    const ms = Number(/(\d+) ms$/.exec(await page.evaluate(() => document.documentElement.getAttribute('data-cp-debug') ?? ''))?.[1] ?? NaN);
                    (h === 0 ? firstHovers : hovers).push(ms);
                }
                await panel.toTab(await panel.tabId(page.url()), 'STOP_PICKER').catch(() => {});
                await page.reload();
                await throttle(page, rate);
                const t0 = Date.now();
                const picked = await pickList(panel, page, p.title);
                picks.push(Date.now() - t0 - 150 - 50); // less the harness's hover pause and moves
                if (!picked) throw new Error('no pick');
                await page.close();
            }
            record(`picker ${p.page} · first hover ms`, rate, median(firstHovers));
            record(`picker ${p.page} · hover ms`, rate, median(hovers));
            record(`picker ${p.page} · click → rows ms`, rate, median(picks));
        }
    }
});

// PROFILE=1 (with an unminified build: `npx vite build --minify false`): where a pick's time goes.
test('picker: where a pick spends its time', async ({ ext, origin, panel }) => {
    test.skip(!process.env.PROFILE, 'PROFILE=1 to profile');
    const self = new Map<string, number>();
    let totalMs = 0;
    for (const p of PICKS) {
        const page = await ext.newPage();
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.goto(`${origin}/corpus/${p.page}`);
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
        await cdp.send('Profiler.start');
        await pickList(panel, page, p.title);
        const { profile } = await cdp.send('Profiler.stop');
        const byId = new Map(profile.nodes.map(n => [n.id, n]));
        const parent = new Map<number, number>();
        profile.nodes.forEach(n => n.children?.forEach(c => parent.set(c, n.id)));
        const dt = profile.timeDeltas ?? [];
        (profile.samples ?? []).forEach((id, i) => {
            const ms = (dt[i] ?? 0) / 1000;
            let n = byId.get(id)!;
            const leaf = n.callFrame.functionName || '(anon)';
            // Charged to the nearest extension function: browser work (style, layout) it asked for.
            while (n && !n.callFrame.url.startsWith('chrome-extension://') && parent.has(n.id)) n = byId.get(parent.get(n.id)!)!;
            const ours = n?.callFrame.url.startsWith('chrome-extension://');
            const key = ours ? `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}${leaf !== n.callFrame.functionName && !byId.get(id)!.callFrame.url ? ` [native ${leaf}]` : ''}` : `· ${leaf}`;
            self.set(key, (self.get(key) ?? 0) + ms);
            if (ours) totalMs += ms;
        });
        await page.close();
    }
    const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
    console.log(`\nextension self time over ${PICKS.length} picks: ${Math.round(totalMs)} ms`);
    for (const [k, v] of top) console.log(`${v.toFixed(1).padStart(8)} ms  ${k}`);
});

test('side panel: opening it', async ({ ext, extensionId }) => {
    for (const rate of RATES) {
        const shown: number[] = [], heap: number[] = [];
        let unused = 0, total = 0;
        for (let i = 0; i < RUNS; i++) {
            const page = await ext.newPage();
            const cdp = await throttle(page, rate);
            if (i === 0) await page.coverage.startJSCoverage();
            const t0 = Date.now();
            await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
            await page.waitForFunction(() => (document.getElementById('root')?.innerText.trim().length ?? 0) > 20, null, { timeout: 120_000 });
            shown.push(Date.now() - t0);
            await page.waitForTimeout(500);
            heap.push((await metrics(cdp)).JSHeapUsedSize / 1048576);
            if (i === 0) {
                for (const entry of await page.coverage.stopJSCoverage()) {
                    if (!entry.url.startsWith('chrome-extension://') || !entry.source) continue;
                    const len = entry.source.length;
                    total += len;
                    // Bytes in functions that never ran (block coverage: a function's first range).
                    const ran = new Array<boolean>(len).fill(false);
                    for (const fn of entry.functions) for (const r of fn.ranges) for (let k = r.startOffset; k < r.endOffset; k++) ran[k] = r.count > 0;
                    unused += ran.filter(x => !x).length;
                }
            }
            await page.close();
        }
        record('side panel · open until home shows ms', rate, median(shown));
        record('side panel · JS heap MB', rate, median(heap));
        if (rate === 1) {
            record('side panel · JS loaded KB', rate, total / 1024);
            record('side panel · JS unused at start %', rate, (unused / total) * 100);
        }
    }
});

test('data table: a 2,000-row Page Extractor table', async ({ ext, extensionId, panel }) => {
    const tableId = await panel.page.evaluate(() => new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('crawl-pilot');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction(['tables', 'rows'], 'readwrite');
            const now = Date.now();
            const columns = [
                { id: 'recordId', name: 'RECORD ID', type: 'text' },
                { id: 'source_url', name: 'Source URL', type: 'url' },
                ...Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, name: `Field ${i}`, type: 'text' })),
                { id: 'about', name: 'About', type: 'json' },
                { id: 'specs', name: 'Specs', type: 'json' },
                { id: 'specs__tabledata', name: 'Specs (raw)', type: 'tabledata', hidden: true },
            ];
            const req = tx.objectStore('tables').add({ name: 'perf', source: 'bulk-page', sourceUrl: 'https://example.test', columns, rowCount: 2000, preview: false, view: {}, createdAt: now, updatedAt: now });
            req.onsuccess = () => {
                const id = req.result as number;
                const rows = tx.objectStore('rows');
                for (let r = 0; r < 2000; r++) {
                    const data: Record<string, unknown> = { recordId: `rec_${r}`, source_url: `https://example.test/p/${r}` };
                    for (let i = 0; i < 8; i++) data[`c${i}`] = `Value ${r}-${i} with some words of text`;
                    data.about = JSON.stringify(Array.from({ length: 4 }, (_, k) => `Paragraph ${k} of item ${r}, a sentence or two of description.`));
                    data.specs = JSON.stringify(Array.from({ length: 18 }, (_, k) => [`Spec ${k}`, `${k * 3} in`]));
                    data.specs__tabledata = '{}';
                    rows.add({ tableId: id, data, key: `k${r}`, createdAt: now + r });
                }
                tx.oncomplete = () => { db.close(); resolve(id); };
            };
        };
    }));
    for (const rate of RATES) {
        const shown: number[] = [], heap: number[] = [];
        for (let i = 0; i < 2; i++) {
            const page = await ext.newPage();
            const cdp = await throttle(page, rate);
            const t0 = Date.now();
            await page.goto(`chrome-extension://${extensionId}/sidepanel.html?view=data-table&tableId=${tableId}`);
            await page.waitForSelector('.ag-row', { timeout: 300_000 });
            shown.push(Date.now() - t0);
            await page.waitForTimeout(500);
            heap.push((await metrics(cdp)).JSHeapUsedSize / 1048576);
            await page.close();
        }
        record('data table 2,000 pages (38,000 shown rows) · open ms', rate, median(shown));
        record('data table 2,000 pages · JS heap MB', rate, median(heap));
    }
});

test.afterAll(() => {
    if (Object.keys(results).length === 0) return;
    const out = path.resolve('test-results/perf.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const previous = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : {};
    fs.writeFileSync(out, JSON.stringify({ ...previous, ...results }, null, 2));
    const width = Math.max(...Object.keys(results).map(k => k.length));
    console.log(`\n${'measure'.padEnd(width)}  ${RATES.map(r => `${r}x`.padStart(9)).join('')}`);
    for (const [k, v] of Object.entries(results)) console.log(`${k.padEnd(width)}  ${RATES.map(r => String(v[`${r}x`] ?? '').padStart(9)).join('')}`);
});
