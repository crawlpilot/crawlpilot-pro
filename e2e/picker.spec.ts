/**
 * The picker scorecard (`docs/plans/picker-list-detection-plan.md` PK0): hover several points of
 * several cards, the way a user does, and check what the List Extractor highlights: the number of
 * cards in the tooltip, one dashed outline per card, card-sized (not a price line, not a row, not
 * the page).
 */
import type { Page } from '@playwright/test';
import { test, expect, type Panel } from './harness';

interface Case { page: string; cards: string; count: number; points: string[] }

// `count` is the section's cards alike to the hovered one (picker-container-bound-plan.md): same size,
// structure and named parts. Ad tiles in grid cells are left out; BestBuy's 3 ad cells share the
// product cards' parts and count, Amazon's 2 sponsored results too. Walmart cars: the 21 grid cards,
// not the video tile.
const CASES: Case[] = [
    { page: '/corpus/bestbuy-search', cards: 'li.product-list-item', count: 21, points: ['h3.product-title', 'img', '[data-testid="price-block-customer-price"]', '.variations-wrapper-grid', ':scope'] },
    { page: '/corpus/walmart-search-live', cards: '[data-testid="item-stack"] [data-item-id]', count: 45, points: ['[data-automation-id="product-title"]', 'img', '[data-testid="ugpp-main-price"], [data-testid="ugpp-reduced-price"]', '[data-test-id="gpt-variant-link"]', '[data-testid="product-ratings"]'] },
    { page: '/corpus/walmart-cars', cards: '[data-testid="item-stack"] > div:has([data-automation-id="heart-item"])', count: 21, points: ['[data-automation-id="product-title"]', 'img', '[data-automation-id="product-price"]'] },
    { page: '/corpus/amazon-search', cards: '[data-component-type="s-search-result"]', count: 18, points: ['h2', 'img', '[data-cy="reviews-block"]'] },
    { page: '/corpus/homedepot-search', cards: '.browse-search__pod', count: 12, points: ['[data-testid="attribute-product-label"]', 'img', '[data-testid="price-simple"]'] },
    { page: '/corpus/chewy-plp', cards: '[data-testid="plp-product-card"]', count: 36, points: ['.chirp-title', '.chirp-product-card__image img', '.chirp-product-card__rating', '.chirp-product-card__pricing', ':scope'] },
    { page: '/site/app-pane.html', cards: '.x3', count: 20, points: ['.x7', '.x8', ':scope'] },
    { page: '/site/rows-grid.html', cards: 'a.p', count: 12, points: ['img'] },
];

async function hover(page: Page, panel: Panel, selector: string): Promise<{ tip: string; outlines: { w: number; h: number }[] }> {
    const loc = page.locator(selector).first();
    // To the middle of the window: at the top a sticky header would cover it.
    await loc.evaluate(el => el.scrollIntoView({ block: 'center' }));
    const box = (await loc.boundingBox())!;
    await page.mouse.move(box.x + Math.min(8, box.width / 2), box.y + Math.min(8, box.height / 2));
    await page.waitForTimeout(150);
    const tip = (await page.locator('[data-testid="element-picker-tooltip"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
    const outlines = await page.evaluate(() => Array.from(document.documentElement.children)
        .filter(e => (e as HTMLElement).style?.border?.includes('dashed'))
        .map(e => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; }));
    return { tip, outlines };
}

for (const c of CASES) {
    test(`hover finds the cards: ${c.page}`, async ({ panel, ext, origin }) => {
        const page = await ext.newPage();
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.goto(`${origin}${c.page}`);
        // The picker writes what it considered on <html>: a failure says why.
        await page.evaluate(() => document.documentElement.setAttribute('data-cp-debug', ''));
        await panel.toTab(await panel.tabId(page.url()), 'START_PICKER', { mode: 'list', action: 'extract' });
        const cardSize = await page.locator(c.cards).nth(1).boundingBox();
        // Wherever the pointer is, in whichever card: the same section and the same cards.
        for (const n of [0, 1, 3, 5, 8]) {
            for (const point of c.points) {
                const selector = point === ':scope' ? `${c.cards} >> nth=${n}` : `${c.cards} >> nth=${n} >> ${point}`;
                if (!(await page.locator(selector).count())) continue;
                const { tip, outlines } = await hover(page, panel, selector);
                const ladder = await page.evaluate(() => `${document.documentElement.getAttribute('data-cp-debug')}\n${document.documentElement.getAttribute('data-cp-set') ?? ''}`);
                const where = `${point} in card ${n}\n${ladder}`;
                expect(tip, where).toContain(`· ${c.count} items`);
                expect(outlines.length, where).toBe(c.count);
                // Outlines are card-sized: the hovered card's width, give or take.
                const sized = outlines.filter(o => o.w > 0 && Math.abs(o.w - cardSize!.width) <= cardSize!.width * 0.25);
                expect(sized.length, where).toBeGreaterThanOrEqual(Math.floor(c.count * 0.5));
                // Hover never stalls the page: the picker's own measure of this hover.
                const ms = Number(/(\d+) ms\n/.exec(ladder)?.[1] ?? 0);
                expect(ms, where).toBeLessThanOrEqual(10);
            }
        }
        await page.close();
    });
}
