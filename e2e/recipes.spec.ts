/**
 * The Recipes screen (docs/plans/product-improvements-plan.md §5, S1): every saved recipe once, how
 * its last run went, and Run / Rename from there.
 */
import { test, expect, saveAsRecipe } from './harness';

test('a list run saved as a recipe: its health shown, renamed, run again from its card', async ({ panel, ext, origin }) => {
    test.setTimeout(150_000);
    const page = await ext.newPage();
    await page.goto(`${origin}/site/list-1.html`);
    const tabId = await panel.tabId(page.url());
    await panel.toTab(tabId, 'PING');

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

    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html?view=history&tabId=${tabId}`);
    // A run is not a recipe until saved: the Recipes screen has only what the user keeps.
    await ui.getByRole('tab', { name: 'Recipes' }).click();
    await expect(ui.getByTestId('recipe-card').filter({ hasText: '127.0.0.1' })).toHaveCount(0);
    await saveAsRecipe(ui, '127.0.0.1');
    const card = ui.getByTestId('recipe-card').filter({ hasText: '127.0.0.1' }).first();
    await expect(card).toContainText('127.0.0.1');
    await expect(card).toContainText('12 rows');
    // Page 3 renamed its price class (list-3.html): the run found Price again by meaning, worth a look.
    await expect(card).toContainText('Check');
    await expect(card.getByTestId('recipe-notes')).toContainText('Price found again by meaning');
    const runsBefore = Number(/(\d+) runs?/.exec(await card.innerText())![1]);

    await card.getByRole('button', { name: 'Rename' }).click();
    await ui.getByRole('dialog').getByRole('textbox').fill('Lamps every morning');
    await ui.getByRole('button', { name: 'Save' }).click();
    const renamed = ui.getByTestId('recipe-card').filter({ hasText: 'Lamps every morning' });
    await expect(renamed).toHaveCount(1);

    await panel.clear();
    await renamed.getByRole('button', { name: 'Run' }).click();
    // The list's start page is the one it ran on.
    await expect(ui.getByTestId('run-start-page')).toHaveValue(`${origin}/site/list-1.html`);
    await ui.getByRole('button', { name: 'Start' }).click();
    await panel.next('PAGINATION_COMPLETE', 90_000);
    // Run again from the card: the same recipe, one run more, its name kept.
    await expect(renamed).toContainText(`${runsBefore + 1} runs`, { timeout: 15_000 });
});

test('ready-made ZARA and UNIQLO are listed before any run', async ({ panel, ext }) => {
    const ui = await ext.newPage();
    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html?view=history`);
    await ui.getByRole('tab', { name: 'Recipes' }).click();
    await expect(ui.getByText('Ready-made')).toBeVisible();
    for (const [name, site] of [['ZARA · product details', 'zara.com'], ['UNIQLO · product details', 'uniqlo.com']]) {
        const card = ui.getByTestId('recipe-card').filter({ hasText: name });
        await expect(card).toContainText(site);
        await expect(card).toContainText('Not run yet');
    }
    // Run asks for pages, starting from the ones it was checked on.
    await ui.getByTestId('recipe-card').filter({ hasText: 'ZARA' }).getByRole('button', { name: 'Run' }).click();
    await expect(ui.getByTestId('run-pages')).toHaveValue(/zara\.com/);
});

test('a page recipe runs on the pages given, as one more run of the same recipe', async ({ panel, ext, origin }) => {
    test.setTimeout(120_000);
    // A page recipe from one run on one page.
    await panel.clear();
    const start = await panel.toExtension('BULK_EXTRACTION_START', {
        urls: [`${origin}/site/product.html?id=1`],
        elements: [{ id: 'model', name: 'Model', action: 'extract', type: 'text', selectors: ['h1'] }],
        config: { requestDelay: 0 }, maxConcurrent: 1, customName: 'Lamp models',
    });
    expect(start?.success).toBe(true);
    await panel.next('BULK_EXTRACTION_COMPLETE', 60_000);
    const recipesBefore = (await panel.store('recipes')).length;

    const ui = await ext.newPage();
    await ui.setViewportSize({ width: 400, height: 900 });
    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html?view=history`);
    // The newest data card is that run (a page run's table is named by its site); its recipe by the run.
    await saveAsRecipe(ui, '127.0.0.1');
    const card = ui.getByTestId('recipe-card').filter({ hasText: 'Lamp models' }).first();
    await card.getByRole('button', { name: 'Run' }).click();
    const pages = [`${origin}/site/product.html?id=2`, `${origin}/site/product.html?id=3`];
    await ui.getByTestId('run-pages').fill(pages.join('\n'));
    await expect(ui.getByText('2 pages · one address per line')).toBeVisible();
    await panel.clear();
    await ui.getByRole('button', { name: 'Start' }).click();
    const done = await panel.next('BULK_EXTRACTION_COMPLETE', 60_000);
    expect(done.success).toBe(true);

    // Same recipe, a new run on the new pages, its rows from them.
    expect((await panel.store('recipes')).length).toBe(recipesBefore);
    const job = (await panel.store('jobs')).at(-1);
    expect(job.input.urls).toEqual(pages);
    const rows = (await panel.store('rows')).filter(r => r.tableId === done.tableId);
    expect(rows.map(r => r.data.model).sort()).toEqual(['Lamp model 2', 'Lamp model 3']);
});

test('a recipe taken off the Recipes screen keeps its data', async ({ panel, ext, origin }) => {
    test.setTimeout(90_000);
    await panel.clear();
    await panel.toExtension('BULK_EXTRACTION_START', {
        urls: [`${origin}/site/product.html?id=4`],
        elements: [{ id: 'price', name: 'Price', action: 'extract', type: 'text', selectors: ['#price'] }],
        config: { requestDelay: 0 }, maxConcurrent: 1, customName: 'Lamp prices',
    });
    const run = await panel.next('BULK_EXTRACTION_COMPLETE', 60_000);
    const ui = await ext.newPage();
    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html?view=history`);
    await saveAsRecipe(ui, '127.0.0.1', 'Lamp prices daily');
    const card = ui.getByTestId('recipe-card').filter({ hasText: 'Lamp prices daily' });
    await expect(card).toHaveCount(1);
    await card.getByRole('button', { name: 'Remove from recipes' }).click();
    await expect(card).toHaveCount(0);
    expect((await panel.store('tables')).some(t => t.id === run.tableId)).toBe(true);
    expect((await panel.store('recipes')).find(r => r.name === 'Lamp prices daily')?.saved).toBeUndefined();
});
