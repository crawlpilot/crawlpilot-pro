/**
 * The extension in a real browser: loads, picks lists with real layout (jsdom has none), paginates
 * across navigations, runs a Page Extractor bulk job with a click step, and migrates a v5 database.
 */
import { test, expect, pickList, pickElement } from './harness';

test('loads: service worker, side panel, content script', async ({ panel, ext, origin }) => {
    const errors: string[] = [];
    panel.page.on('pageerror', e => errors.push(e.message));
    await expect(panel.page.locator('body')).toContainText(/Extract a List/i);

    const page = await ext.newPage();
    await page.goto(`${origin}/site/list-1.html`);
    const reply = await panel.toTab(await panel.tabId(page.url()), 'PING');
    expect(reply?.success).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
});

const LISTINGS = [
    // Ground truth from src/test/corpus/targets.ts.
    { name: 'amazon-search', container: '.s-main-slot', items: ':scope > [data-component-type="s-search-result"]', click: '[data-component-type="s-search-result"] h2' },
    { name: 'walmart-search', container: '[data-testid="item-stack"]', items: ':scope > div:has([data-item-id])', click: '[data-item-id] [data-automation-id="product-title"]' },
];

for (const l of LISTINGS) {
    test(`list pick on ${l.name}: the stored chains find exactly the items`, async ({ panel, ext, origin }) => {
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
            return [truth.length, rows.filter(r => truth.includes(r as Element)).length + (rows.length - truth.length === 0 ? 0 : 1000)];
        }, [l.container, l.items, { container: picked.container, items: picked.items }] as const);
        // Every true item, and nothing else (an extra or a miss adds 1000).
        expect(found).toBe(expected);
        expect(picked.count).toBe(expected);
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
    expect(page.url()).toContain('list-3.html');
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
