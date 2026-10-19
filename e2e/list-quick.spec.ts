/**
 * The list's happy path (docs/plans/ux-simplification-plan.md §4.3): point at one item, see what was
 * found and how more pages will load, and get every page with one button. The Next link is found on
 * the page, never picked by hand.
 */
import { test, expect } from './harness';

const SHOTS = process.env.UX_SHOTS;

test('point at one card, then one click gets all three pages', async ({ panel, ext, origin }) => {
    test.setTimeout(120_000);
    const page = await ext.newPage();
    await page.goto(`${origin}/site/list-1.html`);
    const tabId = await panel.tabId(page.url());
    await panel.toTab(tabId, 'PING');

    const ui = await ext.newPage();
    await ui.setViewportSize({ width: 400, height: 900 });
    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html?view=list-extractor&tabId=${tabId}`);
    await ui.getByRole('button', { name: 'Point at one item' }).click();

    // Hover then click a card, as a user does.
    const card = page.locator('li.card').first();
    const box = (await card.boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + 10);
    await page.waitForTimeout(150);
    await page.mouse.click(box.x + 20, box.y + 10);

    await expect(ui.getByText('4 items found')).toBeVisible({ timeout: 15_000 });
    await expect(ui.getByText(/Then follows “Next page” through up to/)).toBeVisible();
    if (SHOTS) await ui.screenshot({ path: `${SHOTS}/list-quick-run.png` });
    await ui.getByRole('button', { name: 'Get the data from 3 pages' }).click();

    await expect(ui.getByText('Done · 12 items from 3 pages')).toBeVisible({ timeout: 60_000 });
    await expect(ui.getByRole('button', { name: 'See your table' })).toBeVisible();
    if (SHOTS) await ui.screenshot({ path: `${SHOTS}/list-quick-done.png` });
});
