/**
 * The Scraper Toolkit in the side panel, against a saved Walmart search page: Page Recon's verdict
 * and facts, Selector Lab testing as you type, and API Finder's steps. Set TOOLKIT_SHOTS=<dir> to
 * also save screenshots of each tool (for reviewing the UI).
 */
import { test, expect, type Panel } from './harness';
import type { BrowserContext, Page } from '@playwright/test';
import path from 'node:path';

const SHOTS = process.env.TOOLKIT_SHOTS;

async function shot(ui: Page, name: string) {
    if (SHOTS) await ui.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

async function openToolkit(panel: Panel, ext: BrowserContext, origin: string, tool: string): Promise<Page> {
    const page = await ext.newPage();
    await page.goto(`${origin}/corpus/walmart-search`);
    const tabId = await panel.tabId(page.url());
    await panel.toTab(tabId, 'PING');
    const ui = await ext.newPage();
    await ui.setViewportSize({ width: 400, height: 900 });
    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html?view=toolkit&tool=${tool}&tabId=${tabId}`);
    return ui;
}

test('Page Recon: the page it works on, a verdict, facts at a glance and next steps', async ({ panel, ext, origin }) => {
    const ui = await openToolkit(panel, ext, origin, 'recon');
    await expect(ui.getByText('How should I scrape this page?')).toBeVisible();
    await expect(ui.getByText('127.0.0.1', { exact: false }).first()).toBeVisible();
    await shot(ui, 'recon-intro');

    await ui.getByRole('button', { name: 'Analyse this page' }).click();
    await expect(ui.getByText('Protection', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    for (const fact of ['Rendering', 'Embedded data', 'Pagination']) await expect(ui.getByText(fact, { exact: true }).first()).toBeVisible();
    await expect(ui.getByRole('button', { name: 'Test a selector' })).toBeVisible();
    await shot(ui, 'recon-report');

    // A next step hands off to the other tool.
    await ui.getByRole('button', { name: 'Test a selector' }).click();
    await expect(ui.getByRole('button', { name: 'Pick an element on the page' })).toBeVisible();
});

test('Selector Lab: tests a typed selector live and offers code', async ({ panel, ext, origin }) => {
    const ui = await openToolkit(panel, ext, origin, 'lab');
    await expect(ui.getByText("Find a selector that won't break")).toBeVisible();
    await shot(ui, 'lab-intro');

    await ui.getByLabel('Selector').fill('[data-automation-id="product-title"]');
    await expect(ui.getByText(/highlighted on the page/)).toBeVisible({ timeout: 10_000 });
    await expect(ui.getByText('Use it in code')).toBeVisible();
    await shot(ui, 'lab-result');

    await ui.getByLabel('Clear').click();
    await expect(ui.getByText('Try:')).toBeVisible();
});

test('API Finder: shows its three steps, search waits for a recording', async ({ panel, ext, origin }) => {
    const ui = await openToolkit(panel, ext, origin, 'api');
    await expect(ui.getByText('Skip the page, call its API')).toBeVisible();
    await expect(ui.getByText("Record the page's calls")).toBeVisible();
    await expect(ui.getByText('Find a value you see on the page')).toBeVisible();
    await expect(ui.getByLabel('Value to find')).toBeDisabled();
    await shot(ui, 'api-intro');
});
