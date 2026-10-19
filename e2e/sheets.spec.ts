/**
 * Google Sheets through the user's own Apps Script (docs/plans/leads-and-sheets-plan.md §2). The test
 * server plays the script's web app (`/macros/s/test/exec`, harness.ts).
 */
import { test, expect } from './harness';

test('connect a Google Sheet, send a dataset to it, stop syncing', async ({ ext, origin, panel }) => {
    // A dataset: a small bulk run.
    const urls = [1, 2, 3].map(n => `${origin}/site/product.html?id=${n}`);
    await panel.clear();
    const start = await panel.toExtension('BULK_EXTRACTION_START', { urls, elements: [{ id: 'title', name: 'Title', action: 'extract', type: 'text', selectors: ['h1'] }], config: { requestDelay: 0 }, maxConcurrent: 2, customName: 'Lamps' });
    expect(start?.success).toBe(true);
    const done = await panel.next('BULK_EXTRACTION_COMPLETE', 60_000);

    // Settings: the script's key goes to the (fake) script, then connect.
    const settings = await ext.newPage();
    await settings.goto(`chrome-extension://${panel.extensionId}/sidepanel.html?view=settings`);
    const setup = settings.getByTestId('sheets-setup');
    await expect(setup).toBeVisible();
    const secret = await settings.evaluate(() => localStorage.getItem('crawlpilot.sheets.draftSecret'));
    expect(secret).toMatch(/^[a-z0-9]{12,}$/);
    await fetch(`${origin}/macros/s/test/key`, { method: 'POST', body: secret! });
    await setup.getByLabel('Web app URL').fill(`${origin}/macros/s/test/exec`);
    await setup.getByRole('button', { name: 'Connect' }).click();
    await expect(settings.getByTestId('sheets-connected')).toContainText('Connected to Test sheet');

    // The data table: send it; its rows land in a tab named after the dataset.
    const table = await ext.newPage();
    await table.goto(`chrome-extension://${panel.extensionId}/sidepanel.html?view=data-table&tableId=${done.tableId}`);
    await table.getByRole('button', { name: /Export/ }).click();
    await table.getByRole('menuitem', { name: 'Send to Google Sheets' }).click();
    const bar = table.getByTestId('sheet-bar');
    await expect(bar).toContainText('3 rows in Google Sheets');
    await expect(bar).toContainText('new rows are added as they come');
    const tabs = await (await fetch(`${origin}/macros/s/test/log`)).json();
    const tab = Object.values(tabs)[0] as { header: string[]; rows: unknown[][] };
    expect(tab.header).toContain('Title');
    expect(tab.rows.map(r => r[tab.header.indexOf('Title')]).sort()).toEqual(['Lamp model 1', 'Lamp model 2', 'Lamp model 3']);

    await bar.getByRole('button', { name: 'Stop syncing' }).click();
    await expect(bar).toContainText('not syncing');
    await settings.close();
    await table.close();
});
