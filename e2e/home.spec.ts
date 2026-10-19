/**
 * Home starts from the open page: it names the page, suggests the one thing to do with it, and
 * that button opens the right tool (docs/plans/ux-simplification-plan.md §4.2).
 */
import { test, expect, type Panel } from './harness';
import type { BrowserContext, Page } from '@playwright/test';

async function home(panel: Panel, ext: BrowserContext, origin: string, path: string): Promise<Page> {
    const page = await ext.newPage();
    await page.goto(`${origin}${path}`);
    const tabId = await panel.tabId(page.url());
    await panel.toTab(tabId, 'PING');
    const ui = await ext.newPage();
    await ui.setViewportSize({ width: 400, height: 860 });
    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html?tabId=${tabId}`);
    return ui;
}

test('a listing page: Home suggests getting its products as a table, in one click', async ({ panel, ext, origin }) => {
    const ui = await home(panel, ext, origin, '/corpus/walmart-search');
    await expect(ui.getByText(/\d+ products on this page/)).toBeVisible({ timeout: 10_000 });
    await ui.getByRole('button', { name: 'Get them as a table' }).click();
    await expect(ui.getByRole('button', { name: 'Point at one item' })).toBeVisible();
});

test('a product page: Home suggests the product details', async ({ panel, ext, origin }) => {
    const ui = await home(panel, ext, origin, '/corpus/pdp-walmart');
    await expect(ui.getByText('A product page')).toBeVisible({ timeout: 10_000 });
    await expect(ui.getByRole('button', { name: "Get this product's details" })).toBeVisible();
});

test('the other tools are one tap away under More tools', async ({ panel, ext, origin }) => {
    const ui = await home(panel, ext, origin, '/corpus/walmart-search');
    await expect(ui.getByText('Scraper Toolkit')).toBeHidden();
    await ui.getByRole('button', { name: 'More tools' }).click();
    await ui.getByText('Scraper Toolkit').click();
    await expect(ui.getByText('How should I scrape this page?')).toBeVisible();
});
