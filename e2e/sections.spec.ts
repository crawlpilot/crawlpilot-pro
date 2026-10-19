/**
 * Sections (`docs/plans/picker-container-bound-plan.md`) on real pages: a pick is the section under
 * the cursor. A grid split over sibling rows is one list, a sponsored shelf is its own list (picked
 * as a second list when wanted), and the stored selectors carry no positions.
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

test('Walmart: the sponsored shelf and the results are two sections, each picked as its own list', async ({ panel, ext, origin }) => {
    const page = await ext.newPage();
    await page.goto(`${origin}/corpus/walmart-search-live`);
    // The first product title on the page is in the sponsored brand shelf above the results.
    const shelf = await pickList(panel, page, '[data-item-id] [data-automation-id="product-title"] >> nth=0');
    expect(shelf.label).toBe('Sponsored · 3 items');
    expect(shelf.count).toBe(3);
    expect(shelf.alternatives).toBeUndefined();

    // A product further down is in the results: its own section, with none of the shelf's products.
    const results = await pickList(panel, page, '[data-item-id] [data-automation-id="product-title"] >> nth=10');
    expect(results.count).toBeGreaterThanOrEqual(45);
    const titles = (pick: any) => new Set<string>(pick.data.items.map((i: Record<string, string>) => Object.values(i).find(v => v.length > 30)));
    const shelfTitles = titles(shelf);
    expect([...titles(results)].some(t => shelfTitles.has(t))).toBe(false);
    await page.close();
});
