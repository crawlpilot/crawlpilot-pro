/** Tables on this page (docs/plans/automation-and-page-tools-plan.md §3.5, T1) on `e2e/site/tables.html`. */
import { test, expect } from './harness';

test('every data table is found and read; layout, nav, hidden and one-row tables are not', async ({ ext, origin, panel }) => {
    const page = await ext.newPage();
    await page.goto(`${origin}/site/tables.html`);
    const reply = await panel.toTab(await panel.tabId(page.url()), 'TABLES_FIND');
    expect(reply.success).toBe(true);
    const tables = reply.tables as { name: string; kind: string; columns: string[]; rows: string[][] }[];
    expect(tables.map(t => t.name)).toEqual(['Products', 'Opening hours', 'Revenue', 'Team members', 'Details', 'Specifications']);
    expect(tables[0].columns).toEqual(['Name', 'Name (link)', 'Price', 'Stock']);
    expect(tables[0].rows[0]).toEqual(['Lamp', `${origin}/p/lamp`, '$49.00', '12']);
    expect(tables[1].rows[1]).toEqual(['Tuesday', '09:00', '18:00']);
    expect(tables[2].columns[1]).toBe('Q1 › Revenue');
    expect(tables[3]).toMatchObject({ kind: 'grid', rows: [['Ana', 'Design'], ['Bo', 'Engineering'], ['Cy', 'Sales']] });
    await page.close();
});

test('the Tables screen: a card per table, Show on page, Save to My data', async ({ ext, origin, panel }) => {
    const page = await ext.newPage();
    await page.goto(`${origin}/site/tables.html`);
    const tabId = await panel.tabId(page.url());
    await panel.toTab(tabId, 'PING');
    const ui = await ext.newPage();
    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html?view=tables&tabId=${tabId}`);

    const cards = ui.getByTestId('page-table');
    await expect(cards).toHaveCount(6);
    await expect(cards.first()).toContainText('Products');
    await expect(cards.first()).toContainText('3 rows × 4 columns');
    await expect(cards.first()).toContainText('Desk');

    await cards.nth(1).getByRole('button', { name: 'Show on page' }).click();
    await expect.poll(() => page.evaluate(() => document.getElementById('spans')!.style.outline)).toMatch(/solid 3px/);

    const opened = ext.waitForEvent('page');
    await cards.first().getByRole('button', { name: 'Save to My data' }).click();
    await opened;
    await expect(cards.first().getByRole('button', { name: 'Saved' })).toBeDisabled();
    await expect.poll(async () => (await panel.store('rows')).filter(r => r.data?.Name === 'Chair').length).toBe(1);
    const chair = (await panel.store('rows')).find(r => r.data?.Name === 'Chair')!.data;
    expect(chair).toMatchObject({ 'Name (link)': `${origin}/p/chair`, Price: '$89.00', Stock: '0', source_url: page.url() });
    await ui.close();
    await page.close();
});
