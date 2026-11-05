/**
 * The user controls how much the picker selects (docs/plans/picker-level-control-plan.md): wider /
 * narrower along visible steps and back, the next item at the same level, a reading chosen and saved
 * as shown, a lock, and the bar's buttons.
 */
import { test, expect, type Panel } from './harness';
import type { Page } from '@playwright/test';

async function start(panel: Panel, page: Page, origin: string) {
    await page.goto(`${origin}/site/picker-levels.html`);
    await panel.clear();
    await panel.toTab(await panel.tabId(page.url()), 'START_PICKER', { mode: 'detail', action: 'extract' });
}

async function hover(page: Page, selector: string) {
    const box = (await page.locator(selector).boundingBox())!;
    await page.mouse.move(box.x + 4, box.y + 4);
    await page.mouse.move(box.x + 6, box.y + 6);
    await page.waitForTimeout(150);
}

/** The outline is on `selector` (within a few pixels). */
async function outlined(page: Page, selector: string) {
    await page.waitForTimeout(200);
    const want = (await page.locator(selector).boundingBox())!;
    const got = (await page.getByTestId('element-picker-highlight').boundingBox())!;
    for (const k of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(got[k] - want[k]), `${selector} ${k}`).toBeLessThan(6);
}

const tooltip = (page: Page) => page.getByTestId('element-picker-tooltip');

test('wider and narrower move one visible step and come back; the click saves what is outlined', async ({ panel, ext, origin }) => {
    const page = await ext.newPage();
    await start(panel, page, origin);
    await hover(page, '#price');
    await outlined(page, '#price');
    await expect(tooltip(page)).toContainText('Text · “$24.99”');

    // The wrapper around the price block has the same box: one press reaches the block.
    await page.keyboard.press('ArrowUp');
    await outlined(page, '#block');
    await page.keyboard.press('ArrowUp');
    await outlined(page, '#card');
    // A small mouse move inside the selection keeps the level.
    await hover(page, '#was');
    await outlined(page, '#card');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await outlined(page, '#price');

    await page.keyboard.press('Enter');
    const picked = await panel.next('ELEMENT_SELECTED');
    expect(picked).toMatchObject({ extractionType: 'text', value: '$24.99' });
    await page.close();
});

test('one row of a list: the next row with →, and read as the row or as every row like it', async ({ panel, ext, origin }) => {
    const page = await ext.newPage();
    await start(panel, page, origin);
    // The cursor is on the row's first word: one step wider is the row.
    await hover(page, '#spec1');
    await expect(tooltip(page)).toContainText('Text · “Height”');
    await page.keyboard.press('ArrowUp');
    await outlined(page, '#spec1');
    // Suggested as before (its two parts as a list); the bar offers every row like it and its own text.
    await expect(tooltip(page)).toContainText('Texts · 2');
    const bar = page.getByTestId('element-picker-bar');
    await expect(bar).toContainText('Items like this · 4');
    await expect(bar).toContainText('Text · “Height45 cm”');
    if (process.env.PICKER_SHOTS) await page.screenshot({ path: `${process.env.PICKER_SHOTS}/picker-levels.png` });
    await page.keyboard.press('ArrowRight');
    await outlined(page, '#spec2');
    await page.keyboard.press('v');
    await expect(tooltip(page)).toContainText('Text · “Weight1.2 kg”');
    await page.keyboard.press('Enter');
    const row = await panel.next('ELEMENT_SELECTED');
    // Saved as chosen: this row, not a table of its siblings.
    expect(row).toMatchObject({ extractionType: 'text', count: 1 });
    expect(row.value).toContain('Weight');

    await start(panel, page, origin);
    await hover(page, '#spec3');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('t');
    await expect(tooltip(page)).toContainText('Items like this · 4');
    await page.keyboard.press('Enter');
    const all = await panel.next('ELEMENT_SELECTED');
    expect(all).toMatchObject({ extractionType: 'table', count: 4 });
    await page.close();
});

test('locked: the mouse no longer moves the selection; the bar\'s buttons work like the keys', async ({ panel, ext, origin }) => {
    const page = await ext.newPage();
    await start(panel, page, origin);
    await hover(page, '#price');
    const bar = page.getByTestId('element-picker-bar');
    await bar.locator('[data-action="wider"]').click();
    await outlined(page, '#block');
    await page.keyboard.press(' ');
    await expect(bar).toContainText('Locked');
    await hover(page, '#elsewhere');
    await outlined(page, '#block');
    // A breadcrumb jumps to its level.
    await bar.getByRole('button', { name: 'div.card' }).click();
    await outlined(page, '#card');
    // The card holds a few parts: suggested as a list of them; V reads it as one value.
    await expect(tooltip(page)).toContainText('List · 3 items');
    await page.keyboard.press('v');
    await bar.locator('[data-action="select"]').click();
    const picked = await panel.next('ELEMENT_SELECTED');
    expect(picked.value).toContain('Desk lamp');
    await page.close();
});

test('the side panel mirror: the page sends where the selection is, the panel\'s actions move it', async ({ panel, ext, origin }) => {
    const page = await ext.newPage();
    await start(panel, page, origin);
    const tabId = await panel.tabId(page.url());
    await hover(page, '#price');
    await expect.poll(async () => (await panel.received('PICKER_STATE')).at(-1)?.readings).toEqual(['Text · “$24.99”']);
    const first = (await panel.received('PICKER_STATE')).at(-1);
    expect(first.steps.slice(-3)).toEqual(['div.card', 'div.price-block', 'span.price']);
    expect(first.index).toBe(first.steps.length - 1);

    await panel.toTab(tabId, 'PICKER_ACTION', { action: 'wider' });
    await expect.poll(async () => (await panel.received('PICKER_STATE')).at(-1)?.index).toBe(first.index - 1);
    await outlined(page, '#block');
    await panel.toTab(tabId, 'PICKER_ACTION', { action: 'lock' });
    await expect.poll(async () => (await panel.received('PICKER_STATE')).at(-1)?.locked).toBe(true);
    await panel.toTab(tabId, 'PICKER_ACTION', { action: 'select' });
    expect((await panel.next('ELEMENT_SELECTED')).value).toContain('$24.99');
    await page.close();
});

test('List Extractor: ↑ / ↓ step through the sections around the card; the one shown is saved', async ({ panel, ext, origin }) => {
    const page = await ext.newPage();
    await page.goto(`${origin}/site/sections-nested.html`);
    await panel.clear();
    await panel.toTab(await panel.tabId(page.url()), 'START_PICKER', { mode: 'list', action: 'extract' });
    await hover(page, '#sw2 li:nth-child(3)');
    // Suggested as before: the grid of cards; the swatches of this card are one step narrower.
    await expect(tooltip(page)).toContainText('· 6 items');
    const bar = page.getByTestId('element-picker-bar');
    await expect(bar).toContainText('Sections');
    await expect(bar).toContainText('· 4 items');
    await page.keyboard.press('ArrowDown');
    await outlined(page, '#sw2');
    await expect(tooltip(page)).toContainText('· 4 items');
    // Moving inside the chosen section keeps it.
    await hover(page, '#sw2 li:nth-child(1)');
    await outlined(page, '#sw2');
    await page.keyboard.press('ArrowUp');
    await outlined(page, '#grid');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    const picked = await panel.next('ELEMENT_SELECTED');
    expect(picked.count).toBe(4);
    await page.close();
});

test('List Extractor: a grid laid out in rows is offered as its cards or its rows (BestBuy)', async ({ panel, ext, origin }) => {
    const page = await ext.newPage();
    await page.goto(`${origin}/corpus/bestbuy-search`);
    await panel.clear();
    await panel.toTab(await panel.tabId(page.url()), 'START_PICKER', { mode: 'list', action: 'extract' });
    await page.locator('li.product-list-item h3.product-title').first().scrollIntoViewIfNeeded();
    await hover(page, 'li.product-list-item h3.product-title >> nth=0');
    // Suggested as before: the cards (placeholders still loading included on hover).
    await expect(tooltip(page)).toContainText(/Results · \d+ items/);
    const bar = page.getByTestId('element-picker-bar');
    const rows = bar.getByRole('button', { name: /· \d+ rows/ });
    const n = Number((await rows.innerText()).match(/(\d+) rows/)![1]);
    expect(n).toBeGreaterThanOrEqual(6);
    await rows.click();
    await expect(tooltip(page)).toContainText(`${n} rows`);
    await page.keyboard.press('Enter');
    const picked = await panel.next('ELEMENT_SELECTED');
    expect(picked.count).toBe(n);
    await page.close();
});

test('Adjust: the picker opens locked on a picked field, read as it was saved; wider, and the new pick comes back', async ({ panel, ext, origin }) => {
    const page = await ext.newPage();
    await page.goto(`${origin}/site/picker-levels.html`);
    await panel.clear();
    const tabId = await panel.tabId(page.url());
    const res = await panel.toTab(tabId, 'START_PICKER', { mode: 'detail', action: 'extract', adjust: { chain: ['#price'], type: 'text' } });
    expect(res.success).toBe(true);
    await outlined(page, '#price');
    const bar = page.getByTestId('element-picker-bar');
    await expect(bar).toContainText('Locked');
    // Locked: the mouse moving over the page doesn't take the selection away.
    await hover(page, '#elsewhere');
    await outlined(page, '#price');
    await page.keyboard.press('ArrowUp');
    await outlined(page, '#block');
    await page.keyboard.press('Enter');
    const picked = await panel.next('ELEMENT_SELECTED');
    expect(picked.value).toContain('$24.99');
    expect(picked.value).toContain('$30.00');

    // A field no longer on the page: the picker doesn't open, and says so.
    const gone = await panel.toTab(tabId, 'START_PICKER', { mode: 'detail', action: 'extract', adjust: { chain: ['#no-such-field'] } });
    expect(gone).toMatchObject({ success: false, error: expect.stringContaining('no longer on the page') });
    await expect(page.getByTestId('element-picker-bar')).toHaveCount(0);
    await page.close();
});

test('Adjust a picked list: opens on its section; ↓ takes one card\'s swatches instead', async ({ panel, ext, origin }) => {
    const page = await ext.newPage();
    await page.goto(`${origin}/site/sections-nested.html`);
    const tabId = await panel.tabId(page.url());
    await panel.clear();
    await panel.toTab(tabId, 'START_PICKER', { mode: 'list', action: 'extract' });
    await hover(page, '#sw3 li:nth-child(2)');
    await page.keyboard.press('Enter');
    const grid = await panel.next('ELEMENT_SELECTED');
    expect(grid.count).toBe(6);

    await panel.clear();
    expect((await panel.toTab(tabId, 'START_PICKER', { mode: 'list', action: 'extract', adjust: { chain: grid.container, items: grid.items } })).success).toBe(true);
    await outlined(page, '#grid');
    await expect(tooltip(page)).toContainText('· 6 items');
    // Unlocked, the grid stays chosen while the cursor moves inside it; ↓ narrows from where it points.
    await page.keyboard.press(' ');
    await hover(page, '#sw1 li:nth-child(2)');
    await outlined(page, '#grid');
    await page.keyboard.press('ArrowDown');
    await outlined(page, '#sw1');
    await page.keyboard.press('Enter');
    expect((await panel.next('ELEMENT_SELECTED')).count).toBe(4);
    await page.close();
});

test('Adjust, then Deselect: the selection is dropped and unlocked, and what is pointed at next is picked afresh', async ({ panel, ext, origin }) => {
    const page = await ext.newPage();
    await page.goto(`${origin}/site/sections-nested.html`);
    const tabId = await panel.tabId(page.url());
    await panel.clear();
    await panel.toTab(tabId, 'START_PICKER', { mode: 'list', action: 'extract' });
    await hover(page, '#sw3 li:nth-child(2)');
    await page.keyboard.press('Enter');
    const grid = await panel.next('ELEMENT_SELECTED');

    await panel.clear();
    expect((await panel.toTab(tabId, 'START_PICKER', { mode: 'list', action: 'extract', adjust: { chain: grid.container, items: grid.items } })).success).toBe(true);
    await outlined(page, '#grid');
    const bar = page.getByTestId('element-picker-bar');
    await expect(bar).toContainText('Locked');
    // Deselect on the page's bar: no outline, no section outlines, unlocked, and the side panel told.
    await bar.getByRole('button', { name: /Deselect/ }).click();
    await expect(page.getByTestId('element-picker-highlight')).toBeHidden();
    expect(await page.evaluate(() => Array.from(document.documentElement.children).filter(e => (e as HTMLElement).style?.border?.includes('dashed')).length)).toBe(0);
    await expect(bar).not.toContainText('Locked');
    await expect(bar).not.toContainText('Deselect');
    // The side panel is told there is no selection (after the states the adjust sent before it).
    await expect.poll(async () => (await panel.received('PICKER_STATE')).at(-1)).toBeNull();
    // The selection follows the mouse again, read afresh where it points (a card's swatch offers the results first),
    // and a click picks it.
    await hover(page, '#sw1 li:nth-child(2)');
    await expect(tooltip(page)).toContainText('Results · 6 items');
    await expect(bar).not.toContainText('Locked');
    await page.keyboard.press('ArrowDown');
    await outlined(page, '#sw1');
    await page.keyboard.press('Enter');
    expect((await panel.next('ELEMENT_SELECTED')).count).toBe(4);

    // A picked field: ⌫ deselects it the same way, and the next click picks what is under the mouse.
    await page.goto(`${origin}/site/picker-levels.html`);
    await panel.clear();
    expect((await panel.toTab(tabId, 'START_PICKER', { mode: 'detail', action: 'extract', adjust: { chain: ['#price'], type: 'text' } })).success).toBe(true);
    await outlined(page, '#price');
    await page.keyboard.press('Backspace');
    await hover(page, '#elsewhere');
    await outlined(page, '#elsewhere');
    await page.keyboard.press('Enter');
    expect((await panel.next('ELEMENT_SELECTED')).value).not.toContain('$24.99');
    await page.close();
});

test('bullets: one bullet is that bullet; widened to the list (through its wrappers), it is read and saved as a list', async ({ panel, ext, origin }) => {
    const page = await ext.newPage();
    await page.goto(`${origin}/site/bullets.html`);
    const tabId = await panel.tabId(page.url());
    await panel.clear();
    await panel.toTab(tabId, 'START_PICKER', { mode: 'detail', action: 'extract' });
    // What is pointed at is what is selected: the one bullet.
    await hover(page, '#top-highlights-module li:nth-child(2)');
    await expect(tooltip(page)).toContainText('Text · “Black nickel-finish handles');
    await outlined(page, '#top-highlights-module li:nth-child(2)');
    await page.keyboard.press('Enter');
    expect(await panel.next('ELEMENT_SELECTED')).toMatchObject({ extractionType: 'text', value: expect.stringMatching(/^Black nickel-finish handles/) });

    // One step wider outlines the six (the list's wrappers have its box): read as the list, saved from the ul.
    await panel.clear();
    await panel.toTab(tabId, 'START_PICKER', { mode: 'detail', action: 'extract' });
    await hover(page, '#top-highlights-module li:nth-child(2)');
    await page.keyboard.press('ArrowUp');
    await outlined(page, '#top-highlights-module ul');
    await expect(tooltip(page)).toContainText('Texts · 6');
    await page.keyboard.press('Enter');
    const list = await panel.next('ELEMENT_SELECTED');
    expect(list).toMatchObject({ extractionType: 'text_array', count: 6 });
    expect(JSON.parse(list.value)).toHaveLength(6);
    expect(list.selectors[0]).toMatch(/ul/);
    await page.close();
});

test('bullets on the saved Walmart page: widened once from a bullet, the six are saved as a list', async ({ panel, ext, origin }) => {
    const page = await ext.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/corpus/pdp-walmart`);
    const tabId = await panel.tabId(page.url());
    await panel.clear();
    await panel.toTab(tabId, 'START_PICKER', { mode: 'detail', action: 'extract' });
    const li = page.locator('#top-highlights-module ul li').nth(1);
    await li.scrollIntoViewIfNeeded();
    const box = (await li.boundingBox())!;
    await page.mouse.move(box.x + 10, box.y + 5);
    await page.mouse.move(box.x + 12, box.y + 6);
    await page.waitForTimeout(200);
    await expect(tooltip(page)).toContainText('Text ·');
    await page.keyboard.press('ArrowUp');
    await expect(tooltip(page)).toContainText('Texts · 6');
    await page.keyboard.press('Enter');
    const list = await panel.next('ELEMENT_SELECTED');
    expect(list).toMatchObject({ extractionType: 'text_array', count: 6 });
    expect(list.selectors[0]).toMatch(/ul$/);
    await page.close();
});

test('spec rows and tables are read as before: no whole-list default on name / value rows, the table still a table', async ({ panel, ext, origin }) => {
    const page = await ext.newPage();
    await page.goto(`${origin}/site/bullets.html`);
    const tabId = await panel.tabId(page.url());
    const readings = async (target: string) => {
        await panel.clear();
        await panel.toTab(tabId, 'START_PICKER', { mode: 'detail', action: 'extract', adjust: { chain: [target] } });
        await page.waitForTimeout(250);
        return (await page.getByTestId('element-picker-bar').innerText()).replace(/\s+/g, ' ');
    };
    // Amazon-style detail bullets: li > span > (name, value). One row is one row, not the whole list.
    expect(await readings('#detailBullets_feature_div li:nth-child(2)')).not.toContain('the whole list');
    expect(await readings('#detailBullets_feature_div ul')).toContain('Texts · 4');
    // An HTML spec table: a row is offered with every row like it, the table as a table.
    expect(await readings('#specs tr:nth-child(2)')).toContain('Items like this · 3');
    expect(await readings('#specs')).toContain('Table · 3 items');
    await page.keyboard.press('Escape');
    await page.close();
});
