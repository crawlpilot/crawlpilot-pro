/**
 * "Same details from many pages" (docs/plans/ux-simplification-plan.md §4.4): one tool for a list of
 * pages, with the article text as a ready-made choice next to picking fields.
 */
import { test, expect } from './harness';

test('"Article text & details", then this page, gets its text without any setup', async ({ panel, ext, origin }) => {
    test.setTimeout(90_000);
    const page = await ext.newPage();
    await page.goto(`${origin}/site/article.html`);
    const tabId = await panel.tabId(page.url());
    await panel.toTab(tabId, 'PING');

    const ui = await ext.newPage();
    await ui.setViewportSize({ width: 400, height: 900 });
    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html?view=page-extractor&tabId=${tabId}`);
    // What first, then where: the pages start with the open one.
    await expect(ui.getByText('Which details do you want?')).toBeVisible();
    await ui.getByText('Article text & details').click();
    await ui.getByRole('button', { name: 'Next: 1 page' }).click();
    await ui.getByRole('button', { name: 'Get 1 page' }).click();
    await expect(ui.getByText('Done · text from 1 page')).toBeVisible({ timeout: 60_000 });
    await expect(ui.getByRole('button', { name: 'See your table' })).toBeVisible();
});

test('the old article route opens the same tool, ready with this page', async ({ panel, ext, origin }) => {
    const page = await ext.newPage();
    await page.goto(`${origin}/site/article.html`);
    const tabId = await panel.tabId(page.url());
    const ui = await ext.newPage();
    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html?view=metadata-extractor&tabId=${tabId}`);
    await expect(ui.getByText('Same details from many pages')).toBeVisible();
    await expect(ui.getByRole('button', { name: 'Next: 1 page' })).toBeEnabled({ timeout: 10_000 });
});
