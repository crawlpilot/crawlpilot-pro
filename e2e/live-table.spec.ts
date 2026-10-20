/** The data table open on a run's live preview: the user's edits stay while the run writes into it. */
import { test, expect } from './harness';

test('a renamed column and an open dialog survive the run still writing into the table', async ({ panel, ext, origin }) => {
    test.setTimeout(120_000);
    // Three quick pages make the preview; the rest arrive slowly, so the run writes while the table is edited.
    const urls = Array.from({ length: 9 }, (_, n) => `${origin}/site/product.html?id=${n + 1}${n >= 3 ? '&delay=2500' : ''}`);
    const elements = [
        { id: 'title', name: 'Title', action: 'extract', type: 'text', selectors: ['h1'] },
        { id: 'price', name: 'Price', action: 'extract', type: 'text', selectors: ['#price'] },
    ];
    await panel.clear();
    const start = await panel.toExtension('BULK_EXTRACTION_START', { urls, elements, config: { requestDelay: 0 }, maxConcurrent: 1, customName: 'e2e live' });
    expect(start?.success).toBe(true);
    await expect.poll(async () => (await panel.store('tables')).find(t => t.jobId === start.jobId)?.id, { timeout: 30_000 }).toBeTruthy();
    const tableId = (await panel.store('tables')).find(t => t.jobId === start.jobId).id;

    const ui = await ext.newPage();
    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html?view=data-table&tableId=${tableId}`);
    await ui.getByRole('button', { name: 'Rename column Price' }).click();
    await ui.getByRole('textbox', { name: 'Rename column Price' }).fill('Cost');
    await ui.getByRole('button', { name: 'Save name' }).click();
    await ui.getByRole('button', { name: 'Clean Cost' }).click();
    await expect(ui.getByRole('dialog')).toBeVisible();

    // More pages are written into the table: the view isn't rebuilt (the dialog stays open).
    const before = (await panel.received('BULK_EXTRACTION_PROGRESS')).length;
    await expect.poll(async () => (await panel.received('BULK_EXTRACTION_PROGRESS')).length, { timeout: 20_000 }).toBeGreaterThan(before + 1);
    await expect(ui.getByRole('dialog')).toBeVisible();
    await ui.keyboard.press('Escape');

    const done = await panel.next('BULK_EXTRACTION_COMPLETE', 90_000);
    expect(done.success).toBe(true);
    // Saved as edited: the finished table keeps the name.
    const table = (await panel.store('tables')).find(t => t.id === done.tableId);
    expect(table.columns.find((c: any) => c.id === 'price')?.name).toBe('Cost');
    await ui.reload();
    await expect(ui.getByRole('button', { name: 'Rename column Cost' })).toBeVisible();
    await expect(ui.getByText('Lamp model 9')).toBeVisible();
});
