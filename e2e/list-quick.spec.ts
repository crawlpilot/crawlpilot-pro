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

    // My data has it as one card: open, download (CSV with every row), run again.
    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html?view=history&tabId=${tabId}`);
    // Other tests in this worker saved data too: this run's card is the one with 12 rows, newest first.
    const rows = ui.getByText(/12 rows/).first();
    await expect(rows).toBeVisible({ timeout: 10_000 });
    const saved = rows.locator('xpath=ancestor::div[.//button[normalize-space()="Open"]][1]');
    await expect(saved.getByRole('button', { name: 'Open' })).toBeVisible();
    await expect(saved.getByRole('button', { name: 'Run again' })).toBeVisible();
    const download = ui.waitForEvent('download');
    await saved.getByRole('button', { name: 'Download' }).click();
    const file = await download;
    const csv = await (await import('node:fs/promises')).readFile((await file.path())!, 'utf8');
    expect(csv.trim().split('\n')).toHaveLength(13);
    if (SHOTS) {
        await ui.screenshot({ path: `${SHOTS}/my-data.png` });
        const opened = ext.waitForEvent('page');
        await saved.getByRole('button', { name: 'Open' }).click();
        const table = await opened;
        await table.setViewportSize({ width: 1100, height: 700 });
        await table.waitForTimeout(1500);
        await table.screenshot({ path: `${SHOTS}/data-table.png` });
    }
});
