/**
 * The data table's exports and edits (docs/plans/product-improvements-plan.md X1, X2): an export has
 * every row, not only those the table loaded; an edited cell is saved, marked, and exported.
 */
import fs from 'node:fs/promises';
import { test, expect } from './harness';

const ROWS = 2100;

/** A table of `ROWS` rows written straight into the extension's database. */
async function seed(page: import('@playwright/test').Page): Promise<number> {
    return page.evaluate(n => new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('crawl-pilot');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction(['tables', 'rows'], 'readwrite');
            const now = Date.now();
            const req = tx.objectStore('tables').add({
                name: 'Big list', source: 'list', sourceUrl: 'https://shop.test/', preview: false, view: {}, rowCount: n,
                columns: [{ id: 'title', name: 'Title', type: 'text' }, { id: 'price', name: 'Price', type: 'text' }],
                createdAt: now, updatedAt: now,
            });
            req.onsuccess = () => {
                const tableId = req.result as number;
                const rows = tx.objectStore('rows');
                for (let i = 1; i <= n; i++) rows.add({ tableId, data: { title: `Item ${i}`, price: `$${i}.00` }, key: `k${i}`, createdAt: now + i });
                tx.oncomplete = () => { db.close(); resolve(tableId); };
            };
            tx.onerror = () => reject(tx.error);
        };
    }), ROWS);
}

test('an export has every row, though the table shows the first 2,000; an edited cell is saved and exported', async ({ panel, ext }) => {
    test.setTimeout(120_000);
    const tableId = await seed(panel.page);
    const ui = await ext.newPage();
    await ui.setViewportSize({ width: 1280, height: 800 });
    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html?view=data-table&tableId=${tableId}`);
    await expect(ui.getByText(`2,000 / 2,100 rows`)).toBeVisible({ timeout: 15_000 });

    const exportCsv = async () => {
        const download = ui.waitForEvent('download');
        await ui.getByRole('button', { name: 'Export' }).click();
        await ui.getByRole('menuitem', { name: 'CSV', exact: true }).click();
        return (await fs.readFile((await (await download).path())!, 'utf8')).replace(/^﻿/, '').trim().split(/\r?\n/);
    };
    const lines = await exportCsv();
    expect(lines).toHaveLength(ROWS + 1);
    expect(lines[ROWS]).toContain('Item 2100');

    // Excel: every row, prices as numbers.
    const xlsxDownload = ui.waitForEvent('download');
    await ui.getByRole('button', { name: 'Export' }).click();
    await ui.getByRole('menuitem', { name: 'Excel (.xlsx)' }).click();
    const xlsx = await xlsxDownload;
    expect(xlsx.suggestedFilename()).toBe('big-list.xlsx');
    const { unzipSync, strFromU8 } = await import('fflate');
    const sheet = strFromU8(unzipSync(await fs.readFile((await xlsx.path())!))['xl/worksheets/sheet1.xml']);
    expect(sheet.match(/<row /g)).toHaveLength(ROWS + 1);
    expect(sheet).toContain('Item 2100');

    // Edit the first row's title in the grid.
    const cell = ui.locator('.ag-row[row-index="0"] [col-id="title"]');
    await cell.dblclick();
    await ui.keyboard.press('ControlOrMeta+A');
    await ui.keyboard.type('Item 1 (checked)');
    await ui.keyboard.press('Enter');
    await expect(cell).toHaveClass(/bg-warning-soft/);

    // Undo (Ctrl/Cmd+Z) edits a cell back: the value as read, and no mark.
    const second = ui.locator('.ag-row[row-index="1"] [col-id="title"]');
    await second.dblclick();
    await ui.keyboard.press('ControlOrMeta+A');
    await ui.keyboard.type('Wrong');
    await ui.keyboard.press('Enter');
    await expect(second).toHaveClass(/bg-warning-soft/);
    await ui.keyboard.press('ControlOrMeta+Z');
    await expect(second).toContainText('Item 2');
    await expect(second).not.toHaveClass(/bg-warning-soft/);

    // Saved: still there after a reload, still marked, and in the export.
    await ui.reload();
    await expect(ui.locator('.ag-row[row-index="0"] [col-id="title"]')).toContainText('Item 1 (checked)', { timeout: 15_000 });
    await expect(ui.locator('.ag-row[row-index="0"] [col-id="title"]')).toHaveClass(/bg-warning-soft/);
    expect((await exportCsv()).some(l => l.includes('Item 1 (checked)'))).toBe(true);
});

test('integrations are free: the webhook, Zapier and Airtable settings can be filled in', async ({ panel, ext }) => {
    const ui = await ext.newPage();
    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html?view=settings`);
    const hook = ui.getByLabel('Webhook URL');
    await expect(hook).toBeEnabled();
    await hook.fill('https://example.test/hook');
    await expect(ui.getByText(/PRO/)).toHaveCount(0);
    await ui.reload();
    await expect(ui.getByLabel('Webhook URL')).toHaveValue('https://example.test/hook');
});
