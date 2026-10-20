/**
 * List + details in one table (docs/plans/product-improvements-plan.md §5, S4): after a list run,
 * "Add details from each item's page" opens the Page Extractor on the list's item links, and the
 * fields read on each item's page are joined onto that item's row of the list.
 */
import { test, expect } from './harness';

test('a list, then each item\'s page: the details land on the list\'s rows', async ({ panel, ext, origin }) => {
    test.setTimeout(180_000);
    const page = await ext.newPage();
    await page.goto(`${origin}/site/list-1.html`);
    const tabId = await panel.tabId(page.url());
    await panel.toTab(tabId, 'PING');

    // The list, as a user gets it: point at one card, get the 3 pages.
    const ui = await ext.newPage();
    await ui.setViewportSize({ width: 400, height: 900 });
    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html?view=list-extractor&tabId=${tabId}`);
    await ui.getByRole('button', { name: 'Point at one item' }).click();
    const box = (await page.locator('li.card').first().boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + 10);
    await page.waitForTimeout(150);
    await page.mouse.click(box.x + 20, box.y + 10);
    await expect(ui.getByText('4 items found')).toBeVisible({ timeout: 15_000 });
    await ui.getByRole('button', { name: 'Get the data from 3 pages' }).click();
    await expect(ui.getByText('Done · 12 items from 3 pages')).toBeVisible({ timeout: 60_000 });

    // Add details: the Page Extractor opens on the 12 item links, the first one in the tab.
    await ui.getByRole('button', { name: "Add details from each item's page" }).click();
    await expect(ui.getByRole('status').filter({ hasText: 'Details for the 12 items' })).toBeVisible();
    await expect.poll(() => page.url(), { timeout: 10_000 }).toContain('/site/product.html?id=1');

    // The details run, as the Page Extractor starts it with the list as its join target.
    const list = (await panel.store('tables')).filter(t => !t.preview && t.source !== 'bulk-page').at(-1);
    const urlColumn = list.columns.find((c: any) => c.type === 'url' && c.id !== 'source_url').id;
    const listRows = (await panel.store('rows')).filter(r => r.tableId === list.id);
    const urls = [...new Set(listRows.map(r => r.data[urlColumn] as string))];
    expect(urls).toHaveLength(12);
    await panel.clear();
    const start = await panel.toExtension('BULK_EXTRACTION_START', {
        urls,
        elements: [
            { id: 'model', name: 'Model', action: 'extract', type: 'text', selectors: ['h1'] },
            { id: 'cost', name: 'Cost', action: 'extract', type: 'text', selectors: ['#price'] },
        ],
        config: { requestDelay: 0 }, maxConcurrent: 3, joinInto: { tableId: list.id, urlColumn },
    });
    expect(start?.success).toBe(true);
    const done = await panel.next('BULK_EXTRACTION_COMPLETE', 120_000);
    expect(done.success).toBe(true);

    // Every list row has its own item's page fields.
    const joined = (await panel.store('tables')).find(t => t.id === list.id);
    expect(joined.columns.map((c: any) => c.name)).toEqual(expect.arrayContaining(['Model', 'Cost']));
    expect(joined.view.details).toMatchObject({ urlColumn, matched: 12, unmatched: 0 });
    const rows = (await panel.store('rows')).filter(r => r.tableId === list.id);
    expect(rows).toHaveLength(12);
    for (const r of rows) {
        const id = new URL(r.data[urlColumn]).searchParams.get('id');
        expect(r.data.model, r.data[urlColumn]).toBe(`Lamp model ${id}`);
        expect(r.data.cost).toBe(`$${Number(id) * 10}.99`);
    }

    // "Run again" on the list from My data reads the list, then each item's page, and joins them again.
    await panel.clear();
    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html?view=history&tabId=${tabId}`);
    const card = ui.getByText(list.name, { exact: true }).first().locator('xpath=ancestor::div[.//button[normalize-space()="Run again"]][1]');
    await card.getByRole('button', { name: 'Run again' }).click();
    await ui.getByRole('button', { name: 'Start' }).click();
    // The list (numbered pages, read in the background) and then its details: two runs complete.
    await expect.poll(async () => (await panel.received('BULK_EXTRACTION_COMPLETE')).length, { timeout: 150_000 }).toBeGreaterThanOrEqual(2);
    expect((await panel.received('BULK_EXTRACTION_COMPLETE')).every((c: any) => c.success)).toBe(true);
    const rerunList = (await panel.store('tables')).filter(t => !t.preview && t.source !== 'bulk-page' && t.id !== list.id).at(-1);
    expect(rerunList.view.details).toMatchObject({ matched: 12, unmatched: 0 });
    const rerunRows = (await panel.store('rows')).filter(r => r.tableId === rerunList.id);
    expect(rerunRows.filter(r => /^Lamp model \d+$/.test(r.data.model))).toHaveLength(12);
});
