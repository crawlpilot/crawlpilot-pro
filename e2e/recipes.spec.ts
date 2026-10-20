/**
 * The Recipes screen (docs/plans/product-improvements-plan.md §5, S1): every saved recipe once, how
 * its last run went, and Run / Rename from there.
 */
import { test, expect } from './harness';

test('a list run is a recipe: shown healthy, renamed, run again from its card', async ({ panel, ext, origin }) => {
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
    await ui.getByRole('tab', { name: 'Recipes' }).click();
    // The newest recipe is this list (the same pick run before, in another test, is the same recipe).
    const card = ui.getByTestId('recipe-card').first();
    await expect(card).toContainText('127.0.0.1');
    await expect(card).toContainText('12 rows');
    await expect(card).toContainText('Healthy');
    const runsBefore = Number(/(\d+) runs?/.exec(await card.innerText())![1]);

    await card.getByRole('button', { name: 'Rename' }).click();
    await ui.getByRole('dialog').getByRole('textbox').fill('Lamps every morning');
    await ui.getByRole('button', { name: 'Save' }).click();
    const renamed = ui.getByTestId('recipe-card').filter({ hasText: 'Lamps every morning' });
    await expect(renamed).toHaveCount(1);

    await panel.clear();
    await renamed.getByRole('button', { name: 'Run' }).click();
    await ui.getByRole('button', { name: 'Start' }).click();
    await panel.next('BULK_EXTRACTION_COMPLETE', 90_000);
    // Run again from the card: the same recipe, one run more, its name kept.
    await expect(renamed).toContainText(`${runsBefore + 1} runs`, { timeout: 15_000 });
});
