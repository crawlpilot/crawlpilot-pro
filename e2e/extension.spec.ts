/**
 * The extension in a real browser: loads, picks lists with real layout (jsdom has none), paginates
 * across navigations, runs a Page Extractor bulk job with a click step, and migrates a v5 database.
 */
import { test, expect, pickList, pickElement } from './harness';

test('loads: service worker, side panel, content script', async ({ panel, ext, origin }) => {
    const errors: string[] = [];
    panel.page.on('pageerror', e => errors.push(e.message));
    await expect(panel.page.locator('body')).toContainText(/Or choose what you want/i);

    const page = await ext.newPage();
    await page.goto(`${origin}/site/list-1.html`);
    const reply = await panel.toTab(await panel.tabId(page.url()), 'PING');
    expect(reply?.success).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
});

const LISTINGS = [
    // Ground truth from src/test/corpus/targets.ts. Walmart is covered on its styled capture by
    // sections.spec.ts, picker.spec.ts and listing.spec.ts: the old capture has no styles, so no card sizes.
    { name: 'amazon-search', container: '.s-main-slot', items: ':scope > [data-component-type="s-search-result"]', click: '[data-component-type="s-search-result"] h2' },
];

for (const l of LISTINGS) {
    test(`list pick on ${l.name}: the stored chains find every item once`, async ({ panel, ext, origin }) => {
        const page = await ext.newPage();
        await page.goto(`${origin}/corpus/${l.name}`);
        const picked = await pickList(panel, page, l.click);

        expect(picked.success).toBe(true);
        expect(picked.selectionMode).toBe('list');
        expect(picked.container.length).toBeGreaterThan(0);
        expect(picked.items.length).toBeGreaterThan(0);

        const [expected, found] = await page.evaluate(([c, i, chain]) => {
            const root = document.querySelector(c)!;
            const truth = Array.from(root.querySelectorAll(i));
            const container = document.querySelector((chain as any).container[0])!;
            const sel = (chain as any).items[0] as string;
            const rows = sel.startsWith('/') || sel.startsWith('./')
                ? (() => { const r = document.evaluate(sel, container, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null); return Array.from({ length: r.snapshotLength }, (_, k) => r.snapshotItem(k)); })()
                : Array.from(container.querySelectorAll(sel));
            // Each true item is one row: the item, the named element inside it, or the cell around it.
            // Other cells of the section that look like products (ad cells, widgets) may be rows too.
            const rowOf = (t: Element) => rows.filter(r => r === t || t.contains(r as Element) || (r as Element).contains(t));
            return [truth.length, truth.filter(t => rowOf(t).length === 1).length];
        }, [l.container, l.items, { container: picked.container, items: picked.items }] as const);
        // Every true item exactly once (a miss or a double counts against it).
        expect(found).toBe(expected);
        expect(picked.count).toBeGreaterThanOrEqual(expected);
        await page.close();
    });
}

test('pagination: three pages through the picked Next button, every row once', async ({ panel, ext, origin }) => {
    const page = await ext.newPage();
    await page.goto(`${origin}/site/list-1.html`);
    const list = await pickList(panel, page, '.card .card-title');
    expect(list.count).toBe(4);
    const next = await pickElement(panel, page, 'a.next');
    expect(next.selectors.length).toBeGreaterThan(0);

    await panel.clear();
    await panel.toTab(await panel.tabId(page.url()), 'EXECUTE_PAGINATION', {
        container: list.container, items: list.items, next: next.selectors, maxPages: -1,
        navigationDelay: 0, contentLoadDelay: 300, pageLoadDelay: 250, urlChangeTimeout: 5000,
        columns: list.data?.columns,
    });
    const done = await panel.next('PAGINATION_COMPLETE', 45_000);
    expect(done.success).toBe(true);

    const updates = await panel.received('PAGINATION_UPDATE');
    const rows = updates.flatMap(u => u.items);
    expect(rows).toHaveLength(12);
    const titles = rows.map(r => Object.values(r).find(v => typeof v === 'string' && v.startsWith('Lamp model')));
    expect(new Set(titles).size).toBe(12);
    // Page 3 renamed the price's class: the run found the field again by its meaning.
    const price = (list.data?.columns as { id: string; name: string }[]).find(c => c.name === 'Price')!;
    expect(rows.every(r => /^\$\d+\.99$/.test(r[price.id]))).toBe(true);
    expect(updates.find(u => u.healedFields)?.healedFields).toEqual(['Price']);
    expect(page.url()).toContain('list-3.html');
    await page.close();
});

test('pagination: a Stop that misses the page (it was moving to the next one) still ends the run', async ({ panel, ext, origin }) => {
    const page = await ext.newPage();
    await page.goto(`${origin}/site/list-1.html`);
    const list = await pickList(panel, page, '.card .card-title');
    const next = await pickElement(panel, page, 'a.next');

    await panel.clear();
    await panel.toTab(await panel.tabId(page.url()), 'EXECUTE_PAGINATION', {
        container: list.container, items: list.items, next: next.selectors, maxPages: -1,
        navigationDelay: 0, contentLoadDelay: 1500, pageLoadDelay: 250, urlChangeTimeout: 5000,
        columns: list.data?.columns,
    });
    await panel.next('PAGINATION_UPDATE', 20_000);
    // The side panel's Stop, as recorded for every page; no STOP message reaches the page.
    await panel.page.evaluate(() => chrome.storage.local.set({ pagination_stopped_at: Date.now() }));
    const done = await panel.next('PAGINATION_COMPLETE', 20_000);
    expect(done).toMatchObject({ success: true, reason: 'cancelled' });
    await page.waitForTimeout(3000);
    expect(page.url()).not.toContain('list-3.html');
    expect(await panel.page.evaluate(() => chrome.storage.local.get('pagination_state'))).toEqual({});
    await page.close();
});

test('scroll run with late content: placeholders fill as they are reached, "Show more" is found and clicked, every row complete', async ({ panel, ext, origin }) => {
    const page = await ext.newPage();
    await page.goto(`${origin}/site/late.html`);
    await page.waitForTimeout(400);
    const list = await pickList(panel, page, '.card .card-title');
    const columns = list.data?.columns as { id: string; name: string }[];
    const price = columns.find(c => c.name === 'Price')!;
    expect(price).toBeTruthy();

    await panel.clear();
    await panel.toTab(await panel.tabId(page.url()), 'EXECUTE_AUTO_SCROLL', {
        container: list.container, items: list.items, enableInfiniteScroll: true,
        scrollDelay: 50, contentLoadDelay: 800, columns,
    });
    const done = await panel.next('AUTO_SCROLL_COMPLETE', 60_000);
    expect(done.success).toBe(true);
    const rows = done.items as Record<string, string>[];
    const titles = rows.map(r => Object.values(r).find(v => v.startsWith('Lamp model')));
    expect(new Set(titles).size).toBe(18);
    expect(rows.every(r => /^\$\d+0\.99$/.test(r[price.id]))).toBe(true);
    await page.close();
});

test('scroll run stopped part way: the rows read so far have already reached the side panel', async ({ panel, ext, origin }) => {
    const page = await ext.newPage();
    await page.goto(`${origin}/site/late.html`);
    await page.waitForTimeout(400);
    const list = await pickList(panel, page, '.card .card-title');
    const tabId = await panel.tabId(page.url());

    await panel.clear();
    await panel.toTab(tabId, 'EXECUTE_AUTO_SCROLL', {
        container: list.container, items: list.items, enableInfiniteScroll: true,
        scrollDelay: 300, contentLoadDelay: 2000, columns: list.data?.columns,
    });
    await panel.next('AUTO_SCROLL_UPDATE', 20_000);
    await panel.toTab(tabId, 'STOP_AUTO_SCROLL');
    await page.waitForTimeout(1000);
    const streamed = (await panel.received('AUTO_SCROLL_UPDATE')).flatMap(u => u.items ?? []);
    const count = (await panel.received('AUTO_SCROLL_UPDATE')).at(-1).count;
    expect(streamed.length).toBeGreaterThan(0);
    // Every row counted was sent, and none twice.
    expect(streamed).toHaveLength(count);
    expect(new Set(streamed.map(r => JSON.stringify(r))).size).toBe(streamed.length);
    await page.close();
});

test('Page Extractor bulk run with a click step: values revealed by the click are read', async ({ panel, origin }) => {
    const urls = [1, 2, 3].map(n => `${origin}/site/product.html?id=${n}`);
    const elements = [
        { id: 'title', name: 'Title', action: 'extract', type: 'text', selectors: ['h1.product-title', '//h1[@id="title"]'] },
        { id: 'show', name: 'Show specs', action: 'click', type: 'button', selectors: ['button.show-specs'] },
        { id: 'sku', name: 'SKU', action: 'extract', type: 'text', selectors: ['dd.sku'] },
    ];
    await panel.clear();
    const start = await panel.toExtension('BULK_EXTRACTION_START', { urls, elements, config: { requestDelay: 0, clickWaitMs: 500 }, maxConcurrent: 3, customName: 'e2e bulk' });
    expect(start?.success).toBe(true);

    const done = await panel.next('BULK_EXTRACTION_COMPLETE', 50_000);
    expect(done.success).toBe(true);
    expect(done.tableId).toBeTruthy();

    const rows = (await panel.store('rows')).filter(r => r.tableId === done.tableId).map(r => r.data);
    const byTitle = Object.fromEntries(rows.map(r => [r.Title ?? r.title, r.SKU ?? r.sku]));
    expect(byTitle).toEqual({ 'Lamp model 1': 'SKU-1', 'Lamp model 2': 'SKU-2', 'Lamp model 3': 'SKU-3' });
    const job = (await panel.store('jobs')).find(j => j.id === done.jobId);
    expect(job).toMatchObject({ status: 'completed', tableId: done.tableId });
    // Each step's coverage over the pages, for Job details.
    expect(job.stats.steps.map((s: any) => `${s.name}:${s.pages}:${s.fill}`)).toEqual(['Title:3:1', 'Show specs:3:1', 'SKU:3:1']);
});

test('Page Extractor bulk run reads closed sections without clicking: a hidden tab panel\'s table, a closed details, a collapsed accordion', async ({ panel, origin }) => {
    const urls = [1, 2].map(n => `${origin}/site/product-hidden.html?id=${n}`);
    const elements = [
        { id: 'title', name: 'Title', action: 'extract', type: 'text', selectors: ['h1'] },
        { id: 'specs', name: 'Specs', action: 'extract', type: 'table', selectors: ['table.specs'] },
        { id: 'materials', name: 'Materials', action: 'extract', type: 'text', selectors: ['p.materials'] },
        { id: 'highlights', name: 'Highlights', action: 'extract', type: 'text_array', selectors: ['ul.highlights'] },
        { id: 'features', name: 'Features', action: 'extract', type: 'list', selectors: ['ul.features'] },
        { id: 'note', name: 'Note', action: 'extract', type: 'text', selectors: ['p.materials-note'] },
    ];
    await panel.clear();
    const start = await panel.toExtension('BULK_EXTRACTION_START', { urls, elements, config: { requestDelay: 0 }, maxConcurrent: 2, customName: 'e2e hidden' });
    expect(start?.success).toBe(true);
    const done = await panel.next('BULK_EXTRACTION_COMPLETE', 50_000);
    expect(done.success).toBe(true);
    const rows = (await panel.store('rows')).filter(r => r.tableId === done.tableId).map(r => r.data);
    const lamp2 = rows.find(r => (r.Title ?? r.title) === 'Lamp model 2')!;
    // Read as the table's rows, not its text run together.
    expect(JSON.parse(String(lamp2.Specs ?? lamp2.specs))).toEqual([['Wattage', '20 W'], ['Cable', '2 m']]);
    expect(lamp2.Materials ?? lamp2.materials).toBe('Steel and linen');
    expect(JSON.stringify(lamp2.Highlights ?? lamp2.highlights)).toContain('Dimmable to 5%');
    // A list in the hidden panel is read item by item, its fields apart.
    const features = JSON.parse(String(lamp2.Features ?? lamp2.features)) as Record<string, string>[];
    expect(features.map(f => Object.values(f).join('='))).toEqual(['Dimmer=Touch', 'Base=Weighted', 'Bulb=E27', 'Switch=Inline']);
    // visibility: hidden has no innerText at all: read while shown.
    expect(lamp2.Note ?? lamp2.note).toBe('Shade fabric is washable');
});

// Headless Chromium shows every tab as visible, so this checks the run opens no window and reads a
// frame-animated section; the hidden-tab behaviour itself is tested in `visibleShim.test.ts`.
test('Page Extractor bulk run with a click step runs in background tabs: no window opens, an animated section opens', async ({ panel, origin }) => {
    const urls = [1, 2, 3].map(n => `${origin}/site/product-anim.html?id=${n}`);
    const elements = [
        { id: 'title', name: 'Title', action: 'extract', type: 'text', selectors: ['h1'] },
        { id: 'open', name: 'Warranty', action: 'click', type: 'button', selectors: ['#toggle'] },
        { id: 'warranty', name: 'Warranty text', action: 'extract', type: 'text', selectors: ['p.warranty'] },
    ];
    await panel.clear();
    await panel.page.evaluate(() => { (window as any).__windows = 0; chrome.windows.onCreated.addListener(() => { (window as any).__windows++; }); });
    const start = await panel.toExtension('BULK_EXTRACTION_START', { urls, elements, config: { requestDelay: 0, clickWaitMs: 500 }, maxConcurrent: 3, customName: 'e2e hidden tabs' });
    expect(start?.success).toBe(true);
    const done = await panel.next('BULK_EXTRACTION_COMPLETE', 60_000);
    expect(done.success).toBe(true);
    expect(await panel.page.evaluate(() => (window as any).__windows)).toBe(0);
    const rows = (await panel.store('rows')).filter(r => r.tableId === done.tableId).map(r => r.data);
    const byTitle = Object.fromEntries(rows.map(r => [r.Title ?? r.title, r['Warranty text'] ?? r.warranty]));
    expect(byTitle).toEqual({ 'Lamp model 1': '1 year warranty', 'Lamp model 2': '2 year warranty', 'Lamp model 3': '3 year warranty' });
});

test('a page whose click does nothing in a background tab is read again in a parked window', async ({ panel, origin }) => {
    const urls = [1, 2].map(n => `${origin}/site/product-anim.html?id=${n}`);
    const elements = [
        { id: 'title', name: 'Title', action: 'extract', type: 'text', selectors: ['h1'] },
        { id: 'noop', name: 'Description', action: 'click', type: 'text', selectors: ['p.description'] },
    ];
    await panel.clear();
    await panel.page.evaluate(() => {
        (window as any).__windows = [];
        chrome.windows.onCreated.addListener(w => { (window as any).__windows.push({ type: w.type, focused: w.focused, width: w.width }); });
    });
    const start = await panel.toExtension('BULK_EXTRACTION_START', { urls, elements, config: { requestDelay: 0, clickWaitMs: 500 }, maxConcurrent: 2, customName: 'e2e window fallback' });
    expect(start?.success).toBe(true);
    const done = await panel.next('BULK_EXTRACTION_COMPLETE', 90_000);
    expect(done.success).toBe(true);
    const windows = await panel.page.evaluate(() => (window as any).__windows);
    expect(windows).toHaveLength(2);
    // Unfocused popups (their size is the browser's to settle: headless gives every window 800 px).
    expect(windows.every((w: any) => w.type === 'popup' && !w.focused)).toBe(true);
    const rows = (await panel.store('rows')).filter(r => r.tableId === done.tableId).map(r => r.data);
    expect(rows.map(r => r.Title ?? r.title).sort()).toEqual(['Lamp model 1', 'Lamp model 2']);
});

test('stopping a run ends it at once: its tabs close, pages cut short are not failures', async ({ panel, origin }) => {
    // Each page takes ~40 s: a click with no effect is waited for twice (20 s each).
    const urls = [1, 2, 3, 4].map(n => `${origin}/site/product-anim.html?id=${n}`);
    const elements = [
        { id: 'title', name: 'Title', action: 'extract', type: 'text', selectors: ['h1'] },
        { id: 'noop', name: 'Description', action: 'click', type: 'text', selectors: ['p.description'] },
    ];
    await panel.clear();
    const start = await panel.toExtension('BULK_EXTRACTION_START', { urls, elements, config: { requestDelay: 0, clickWaitMs: 20_000 }, maxConcurrent: 2, customName: 'e2e stop' });
    expect(start?.success).toBe(true);
    await panel.page.waitForTimeout(2500);
    const t0 = Date.now();
    const stop = await panel.toExtension('BULK_EXTRACTION_STOP');
    expect(stop).toMatchObject({ success: true, running: true });
    const done = await panel.next('BULK_EXTRACTION_COMPLETE', 15_000);
    expect(Date.now() - t0).toBeLessThan(8000);
    expect(done.stoppedByUser).toBe(true);
    const runTabs = await panel.page.evaluate(async () => (await chrome.tabs.query({})).filter(t => /product-anim/.test(t.url || '')).length);
    expect(runTabs).toBe(0);
    const job = (await panel.store('jobs')).find(j => j.id === done.jobId);
    expect(job.status).toBe('stopped');
    expect(job.stats.errors ?? 0).toBe(0);
    // Nothing to stop any more: said so, so the side panel doesn't wait.
    expect(await panel.toExtension('BULK_EXTRACTION_STOP')).toMatchObject({ success: true, running: false });
});

test('a bulk run where every page fails is reported as failed, not completed', async ({ panel }) => {
    // Nothing listens on port 9: every page load fails.
    const urls = ['http://127.0.0.1:9/a', 'http://127.0.0.1:9/b'];
    const elements = [{ id: 'title', name: 'Title', action: 'extract', type: 'text', selectors: ['h1'] }];
    await panel.clear();
    const start = await panel.toExtension('BULK_EXTRACTION_START', { urls, elements, config: { requestDelay: 0, loadTimeout: 5000 }, maxConcurrent: 2 });
    expect(start?.success).toBe(true);
    const done = await panel.next('BULK_EXTRACTION_COMPLETE', 50_000);
    expect(done.success).toBe(false);
    expect(done.error).toBeTruthy();
    expect((await panel.store('jobs')).find(j => j.id === done.jobId)).toMatchObject({ status: 'failed' });
});

test('markdown from a live page: rendered text only, lazy images, shadow DOM, no floating chrome', async ({ panel, ext, origin }) => {
    const page = await ext.newPage();
    await page.goto(`${origin}/site/article.html`);
    const tabId = await panel.tabId(page.url());
    const precise = await panel.toTab(tabId, 'CMD_EXTRACT_METADATA', { url: page.url(), options: { favorPrecision: true, includeImages: true } });
    expect(precise.success).toBe(true);
    const md: string = precise.result.markdown;
    expect(md).toContain('# How to choose a desk lamp');
    expect(md).toContain('## Brightness');
    expect(md).not.toContain('hidden by the stylesheet');
    expect(md).toContain(`![A lamp on a desk](${origin}/site/lamp.jpg)`);
    expect(md).toContain('| Lumens | Colour |');
    expect(md).toContain('| 450 | 2700K |');
    // Fixed and sticky chrome is dropped in precision (fit) mode.
    expect(md).not.toContain('cookies');
    expect(md).not.toContain('Lamps & Co');
    await page.close();
});

test('AI Extract page access: view with block refs, grounding with selectors, on a live page', async ({ panel, ext, origin }) => {
    const page = await ext.newPage();
    await page.goto(`${origin}/site/article.html`);
    const tabId = await panel.tabId(page.url());
    const res = await panel.toTab(tabId, 'AI_PAGE_VIEW', { chunkChars: 4000, maxChunks: 4 });
    expect(res.success).toBe(true);
    const view = res.view.chunks.join('\n\n');
    expect(view).toMatch(/^# How to choose a desk lamp \[b\d+\]$/m);
    expect(view).toMatch(/\| 450 \| 2700K \| \[b\d+\]/);
    const ref = /Look for at least 450 lumens.*\[(b\d+)\]/.exec(view)![1];

    const grounded = await panel.toTab(tabId, 'AI_GROUND', { requests: [
        { key: 'lumens', value: 'at least 450 lumens', ref, type: 'string', compile: true },
        { key: 'cited wrong', value: '2700K', ref, type: 'string' },
        { key: 'invented', value: 'Ships in 3 days', type: 'string' },
    ] });
    const [lumens, moved, invented] = grounded.results;
    expect(lumens).toMatchObject({ status: 'verified' });
    expect(lumens.selectors.length).toBeGreaterThan(0);
    expect(moved.status).toBe('relocated');
    expect(invented.status).toBe('not_on_page');
    await page.close();
});
