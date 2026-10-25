/** Toolkit → Data on this page (docs/plans/automation-and-page-tools-plan.md §3.8, T3). */
import { test, expect } from './harness';

test('the page\'s data as a tree: search, select, copy path, Use in AI Extract', async ({ ext, origin, panel }) => {
    const page = await ext.newPage();
    await page.goto(`${origin}/site/assistant-product.html`);
    const tabId = await panel.tabId(page.url());
    await panel.toTab(tabId, 'PING');
    const ui = await ext.newPage();
    await ui.setViewportSize({ width: 400, height: 900 });
    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html?view=toolkit&tool=data&tabId=${tabId}`);
    await ui.getByRole('tab', { name: 'Inspect' }).click();

    const tree = ui.getByTestId('data-tree');
    await expect(tree).toContainText('JSON-LD · Product');
    // A Product with no image, aggregateRating or sku: recommended, not a problem.
    await expect(ui.getByText(/Recommended but missing: Product: no image/)).toBeVisible();

    await ui.getByLabel('Search the data').fill('price');
    await expect(ui.getByTestId('data-hits')).toHaveText('2 matches');
    await expect(tree).toContainText('"158.89"');

    await tree.getByRole('treeitem').filter({ hasText: 'price:' }).first().click();
    await expect(ui.getByTestId('data-path')).toHaveText('offers.price');

    // The whole Product: AI Extract opens with its schema, and page data answers it.
    await ui.getByLabel('Search the data').fill('');
    await tree.getByRole('treeitem').filter({ hasText: 'Product' }).first().click();
    await ui.getByRole('button', { name: 'Use in AI Extract' }).click();
    const schema = ui.getByRole('textbox').first();
    await expect(schema).toHaveValue(/^name: e\.g\. Trailblazer 24V Kids ATV\nbrand\.name: e\.g\. Yexmas\noffers\.price: e\.g\. 158\.89\noffers\.priceCurrency: e\.g\. USD$/);
    await ui.close();
    await page.close();
});

test('Extract: a list in the page\'s JSON, its attributes ticked and renamed, then run on more pages', async ({ ext, origin, panel }) => {
    test.setTimeout(90_000);
    await panel.clear();
    const page = await ext.newPage();
    await page.goto(`${origin}/site/json-shop.html`);
    const tabId = await panel.tabId(page.url());
    await panel.toTab(tabId, 'PING');
    const ui = await ext.newPage();
    await ui.setViewportSize({ width: 400, height: 900 });
    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html?view=toolkit&tool=data&tabId=${tabId}`);

    // The search results first; the sponsored products are never offered.
    const cards = ui.getByTestId('json-candidate');
    await expect(cards.first()).toContainText('products');
    await expect(cards.first()).toContainText('3 items');
    await expect(cards.filter({ hasText: 'sponsoredProducts' })).toHaveCount(0);
    await cards.first().click();

    await expect(ui.getByLabel('Extract name', { exact: true })).toBeChecked();
    await expect(ui.getByLabel('Extract specs[name=Weight].value')).not.toBeChecked();
    await ui.getByLabel('Extract rating', { exact: true }).uncheck();
    await ui.getByLabel('Column name for name', { exact: true }).fill('title');
    const preview = ui.getByTestId('json-preview');
    await expect(preview.locator('th', { hasText: /^title$/ })).toHaveCount(1);
    await expect(preview.locator('th', { hasText: /^rating$/ })).toHaveCount(0);
    await expect(preview).toContainText('Road Glide');

    // The same fields, bound to the data, go to the Page Extractor with this page.
    await ui.getByRole('button', { name: 'Run on more pages' }).click();
    await ui.getByRole('button', { name: 'Next: pages' }).click();
    await ui.getByRole('button', { name: 'Next: 1 page' }).click();
    await ui.getByRole('button', { name: 'Get 1 page' }).click();
    await expect(ui.getByRole('button', { name: 'Open the table' })).toBeVisible({ timeout: 60_000 });
    // One Back leaves the finished run and returns to where it started: the toolkit, then Home.
    await ui.getByRole('banner').getByRole('button', { name: 'Back' }).click();
    await expect(ui.getByRole('tab', { name: 'Extract' })).toBeVisible();

    // This run's table: the newest (other tests in this worker saved tables too).
    const table = (await panel.store('tables')).filter((t: any) => !t.preview && t.source === 'bulk-page').sort((a: any, b: any) => b.createdAt - a.createdAt)[0];
    const title = table.columns.find((c: any) => c.name === 'title');
    expect(title).toBeTruthy();
    const rows = (await panel.store('rows')).filter((r: any) => r.tableId === table.id);
    expect(rows.map((r: any) => r.data[title.id])).toEqual(['Trail Runner 2', 'Road Glide', 'Peak Pro']);
    await ui.close();
    await page.close();
});

test('a recipe bound to the page\'s data reads the same rows after the page\'s markup changes', async ({ origin, panel }) => {
    test.setTimeout(90_000);
    const elements = [{
        id: 'products', name: 'products', action: 'extract', type: 'list', selectors: [],
        data: { kind: 'json', label: '__NEXT_DATA__', nth: 0, path: ['props', 'pageProps', 'search', 'products'], as: 'rows', keys: ['name', 'price.current', 'images[*].url'], names: ['title', 'price', 'images'] },
    }];
    // One run per page: the same rows twice in one run are one set (a repeat is skipped).
    const read = async (url: string) => {
        await panel.clear();
        const start = await panel.toExtension('BULK_EXTRACTION_START', { urls: [url], elements, config: { requestDelay: 0, listOutput: 'rows' }, maxConcurrent: 1 });
        expect(start?.success).toBe(true);
        const done = await panel.next('BULK_EXTRACTION_COMPLETE', 60_000);
        expect(done.success).toBe(true);
        const table = (await panel.store('tables')).find((t: any) => !t.preview && t.jobId === done.jobId);
        const col = (name: string) => table.columns.find((c: any) => c.name === name).id;
        const rows = (await panel.store('rows')).filter((r: any) => r.tableId === table.id).map((r: any) => r.data);
        return rows.map((r: any) => [r[col('title')], r[col('price')], r[col('images')]]);
    };
    const expected = [
        ['Trail Runner 2', '89', 'https://img.example.com/tr2-a.jpg, https://img.example.com/tr2-b.jpg'],
        ['Road Glide', '120.5', 'https://img.example.com/rg-a.jpg'],
        ['Peak Pro', '150', 'https://img.example.com/pp-a.jpg'],
    ];
    expect(await read(`${origin}/site/json-shop.html`)).toEqual(expected);
    expect(await read(`${origin}/site/json-shop-redesign.html`)).toEqual(expected);
});

test('Page Extractor: smart detection lists the page\'s attributes; ticked and named as a schema, they are the fields', async ({ ext, origin, panel }) => {
    test.setTimeout(90_000);
    await panel.clear();
    const page = await ext.newPage();
    await page.goto(`${origin}/site/json-product.html`);
    const tabId = await panel.tabId(page.url());
    await panel.toTab(tabId, 'PING');
    const ui = await ext.newPage();
    await ui.setViewportSize({ width: 400, height: 900 });
    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html?view=page-extractor&tabId=${tabId}`);
    await ui.getByText('Pick the fields yourself').click();

    await ui.getByTestId('smart-detection').click();
    const dialog = ui.getByRole('dialog');
    // The page's main item opens at once: tick only what the schema needs, named as it names them.
    await expect(dialog).toContainText('ProductGroup');
    const all = dialog.getByLabel('All', { exact: true });
    await all.check();
    await all.uncheck();
    const pick = async (key: string, name: string) => {
        await dialog.getByLabel(`Extract ${key}`, { exact: true }).check();
        await dialog.getByLabel(`Column name for ${key}`, { exact: true }).fill(name);
    };
    await pick('brand.name', 'brand');
    await pick('url', 'product_url');
    await pick('description', 'description');
    await pick('image', 'images');
    await pick('hasVariant[*].offers.price', 'price');
    await dialog.getByLabel('How to read hasVariant[*].offers.price').selectOption('first');
    await pick('additionalProperty', 'product_specifications');
    const preview = dialog.getByTestId('json-preview');
    await expect(preview).toContainText('Fit: Relaxed, Length: Regular');
    await expect(preview).toContainText('79.00');
    await dialog.getByRole('button', { name: 'Add 6 fields' }).click();
    await expect(ui.getByText('Page data')).toHaveCount(6);

    // Then the pages, starting with this one.
    await ui.getByRole('button', { name: 'Next: pages' }).click();
    await ui.getByRole('button', { name: 'Next: 1 page' }).click();
    await ui.getByRole('button', { name: 'Get 1 page' }).click();
    await expect(ui.getByRole('button', { name: 'Open the table' })).toBeVisible({ timeout: 60_000 });

    const table = (await panel.store('tables')).filter((t: any) => !t.preview && t.source === 'bulk-page').sort((a: any, b: any) => b.createdAt - a.createdAt)[0];
    const row = (await panel.store('rows')).find((r: any) => r.tableId === table.id).data;
    const value = (name: string) => row[table.columns.find((c: any) => c.name === name).id];
    expect(value('brand')).toBe('Northpeak');
    expect(value('product_url')).toBe(`${origin}/products/linen-overshirt`);
    expect(value('description')).toBe('Relaxed overshirt in washed linen.\nChest pockets\nButton cuffs');
    expect(value('price')).toBe('79.00');
    expect(JSON.parse(value('product_specifications'))).toEqual({ Fit: 'Relaxed', Length: 'Regular' });
    expect(JSON.stringify(value('images'))).toContain(`${origin}/img/overshirt-2.jpg`);
    await ui.close();
    await page.close();
});
