/**
 * Only new items (docs/plans/product-improvements-plan.md §5, S3): a list read again keeps only the
 * items the run it repeats didn't have.
 */
import { test, expect } from './harness';

test('a rerun with "Only new items" keeps the items the first run didn\'t have', async ({ panel, ext, origin }) => {
    test.setTimeout(150_000);
    const page = await ext.newPage();
    await page.goto(`${origin}/site/list-1.html`);
    const tabId = await panel.tabId(page.url());
    await panel.toTab(tabId, 'PING');

    // The first run: page 1 only (4 items).
    const ui = await ext.newPage();
    await ui.setViewportSize({ width: 400, height: 900 });
    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html?view=list-extractor&tabId=${tabId}`);
    await ui.getByRole('button', { name: 'Point at one item' }).click();
    const box = (await page.locator('li.card').first().boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + 10);
    await page.waitForTimeout(150);
    await page.mouse.click(box.x + 20, box.y + 10);
    await expect(ui.getByText('4 items found')).toBeVisible({ timeout: 15_000 });
    await ui.getByLabel('Pages').selectOption('1');
    await ui.getByRole('button', { name: /^Get (the data|all 4 items)/ }).click();
    await expect(ui.getByText(/^Done · 4 items/)).toBeVisible({ timeout: 60_000 });
    const first = (await panel.store('tables')).filter(t => !t.preview).at(-1);

    // Run again over 3 pages, only new items: pages 2 and 3's 8 items.
    await panel.clear();
    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html?view=history&tabId=${tabId}`);
    const card = ui.getByText(first.name, { exact: true }).first().locator('xpath=ancestor::div[.//button[normalize-space()="Run again"]][1]');
    await card.getByRole('button', { name: 'Run again' }).click();
    await ui.getByLabel('Pages to read at most').fill('3');
    await ui.getByText('Only new items').click();
    await ui.getByRole('button', { name: 'Start' }).click();
    await panel.next('PAGINATION_COMPLETE', 90_000);
    await expect.poll(async () => (await panel.store('tables')).filter(t => !t.preview && t.id !== first.id && t.view?.onlyNew).length, { timeout: 15_000 }).toBe(1);
    const again = (await panel.store('tables')).find(t => !t.preview && t.id !== first.id && t.view?.onlyNew);
    expect(again.view.onlyNew).toMatchObject({ against: first.id, removed: 4 });
    const rows = (await panel.store('rows')).filter(r => r.tableId === again.id);
    expect(rows).toHaveLength(8);
    expect(again.rowCount).toBe(8);
});
