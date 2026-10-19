/**
 * Item sets (`docs/plans/generic-list-selectors-plan.md` GS1) on real pages: a grid split over
 * sibling rows is one list, a sponsored shelf is told apart from the results, and the stored
 * selectors carry no positions.
 */
import { test, expect, pickList } from './harness';

const POSITIONAL = /:nth-(child|of-type)\(|\[\d+\]/;

test('BestBuy: the grid over 6 sibling rows is one list of 18, placeholders included; no positions', async ({ panel, ext, origin }) => {
    const page = await ext.newPage();
    await page.goto(`${origin}/corpus/bestbuy-search`);
    const picked = await pickList(panel, page, 'li.product-list-item h3.product-title');
    expect(picked.count).toBe(18);
    expect(picked.label).toMatch(/· 18 items$/);
    expect([...picked.container, ...picked.items].some((s: string) => POSITIONAL.test(s))).toBe(false);
    // The run finds the same 18 through the stored chains.
    const found = await page.evaluate(([c, i]) => document.querySelector(c)!.querySelectorAll(i).length, [picked.container[0], picked.items[0]] as const);
    expect(found).toBe(18);
    await page.close();
});

test('BestBuy: the carousel above the grid is labelled sponsored', async ({ panel, ext, origin }) => {
    const page = await ext.newPage();
    await page.goto(`${origin}/corpus/bestbuy-search`);
    const picked = await pickList(panel, page, '[data-testid="sponsored-sbb"] .c-carousel-item .sku-title');
    expect(picked.label).toMatch(/^Sponsored · \d+ items$/);
    await page.close();
});

test('Walmart: clicking the sponsored shelf picks the 45 results and offers the shelf', async ({ panel, ext, origin }) => {
    const page = await ext.newPage();
    await page.goto(`${origin}/corpus/walmart-search-live`);
    // The first product title on the page is in the sponsored brand shelf above the results.
    const picked = await pickList(panel, page, '[data-item-id] [data-automation-id="product-title"] >> nth=0');
    expect(picked.count).toBe(45);
    expect(picked.label).toMatch(/· 45 items$/);
    const sponsored = picked.alternatives.find((a: any) => a.kind === 'sponsored');
    expect(sponsored).toMatchObject({ count: 3, label: 'Sponsored · 3 items' });

    // Switching to it reads the shelf through its own chains.
    const tabId = await panel.tabId(page.url());
    const read = await panel.toTab(tabId, 'READ_LIST', { container: sponsored.container, items: sponsored.items });
    expect(read.success).toBe(true);
    expect(read.count).toBe(3);
    expect(read.data.items).toHaveLength(3);
    await page.close();
});
