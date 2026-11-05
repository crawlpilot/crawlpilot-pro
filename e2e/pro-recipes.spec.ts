/**
 * Pro's Recipes screen in the built extension: it is the panel's home, the samples come in as version 1,
 * a re-import adds nothing, and a recipe exports as a format 2 file.
 */
import { readFileSync } from 'node:fs';
import { test, expect } from './harness';
import { proClear, proSetName, proStore, serveMockBackend } from './pro';

test('recipes: samples, re-import and export', async ({ panel }) => {
    const ui = panel.page;
    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html`);
    await proClear(ui);
    await ui.reload();
    await expect(ui.getByText('No recipes yet')).toBeVisible();

    await ui.getByRole('button', { name: 'Add the UNIQLO and ZARA samples' }).click();
    const cards = ui.getByTestId('pro-recipe');
    await expect(cards).toHaveCount(2);
    await expect(cards.filter({ hasText: 'ZARA · product details' })).toContainText('latest v1');
    await expect(cards.first()).toContainText('draft');

    await ui.getByTestId('recipe-import').setInputFiles('src/shared/samples/recipes/zara-product.json');
    await expect(ui.getByText('ZARA · product details: already up to date')).toBeVisible();
    await expect(cards).toHaveCount(2);

    const download = ui.waitForEvent('download');
    await ui.getByRole('button', { name: 'Export ZARA · product details' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('zara-product-details.crawlpilot.json');
    const json = JSON.parse(readFileSync(await file.path(), 'utf8'));
    expect(json).toMatchObject({ format: 3, recipe: { site: 'zara.com', kind: 'page' }, labels: { latest: 1 } });
    expect(json.versions).toHaveLength(1);
});

test('edit: a version opens in the Page Extractor; unchanged is refused, an edit saves version 2', async ({ panel, ext, origin }) => {
    const page = await ext.newPage();
    await page.goto(`${origin}/site/json-product.html`);
    const tabId = await panel.tabId(page.url());
    await panel.toTab(tabId, 'PING');
    const ui = await ext.newPage();
    await ui.setViewportSize({ width: 400, height: 900 });
    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html?tabId=${tabId}`);
    await proClear(ui);
    await ui.reload();

    const file = {
        name: 'Local product', site: '127.0.0.1', built_on: page.url(),
        spec: {
            kind: 'page', settings: { requestDelay: 500, listOutput: 'nested' }, elements: [
                { id: 'a', name: 'heading', action: 'extract', type: 'text', selectors: ['h1'] },
                { id: 'b', name: 'body', action: 'extract', type: 'text', selectors: ['p'] },
            ],
        },
    };
    await ui.getByTestId('recipe-import').setInputFiles({ name: 'local.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
    await ui.getByRole('button', { name: 'Edit Local product' }).click();
    await ui.getByRole('banner').getByRole('button', { name: 'Re-pick on page' }).click();

    await expect(ui.getByRole('button', { name: 'Remove' })).toHaveCount(2);
    await ui.getByRole('button', { name: 'Next: pages' }).click();
    await ui.getByRole('button', { name: 'Next: 1 page' }).click();
    const step = ui.getByTestId('pro-save-version');
    await expect(step).toContainText('Local product: version 2');
    await expect(step).toContainText('Edited from version 1');
    await ui.getByRole('button', { name: 'Save version' }).click();
    await expect(ui.getByText('Nothing changed since the version this was edited from')).toBeVisible();

    await step.getByRole('button', { name: 'Back' }).click();
    await ui.getByRole('banner').getByRole('button', { name: 'Back' }).click();
    await ui.getByRole('button', { name: 'Remove' }).first().click();
    await ui.getByRole('button', { name: 'Next: pages' }).click();
    await ui.getByRole('button', { name: 'Next: 1 page' }).click();
    await ui.getByLabel('What changed').fill('heading dropped');
    await ui.getByRole('button', { name: 'Save version' }).click();
    await expect(ui.getByText('Saved Local product v2')).toBeVisible();

    await ui.getByRole('button', { name: 'Back to recipes' }).click();
    await expect(ui.getByTestId('pro-recipe').filter({ hasText: 'Local product' })).toContainText('latest v2');

    // History: what v2 changed, live moved with a reason, and v1 restored as v3.
    await ui.getByRole('button', { name: 'History of Local product' }).click();
    await expect(ui.getByTestId('pro-version')).toHaveCount(2);
    const diff = ui.getByTestId('pro-diff');
    await expect(diff).toContainText('removed');
    await expect(diff).toContainText('field heading');
    await expect(diff).toContainText('The output changes');

    // v2 is not reviewed: it cannot be live, and its author cannot approve it. Someone else does.
    const v2 = ui.getByTestId('pro-version').first();
    await expect(v2).toContainText('needs review');
    await expect(v2.getByRole('button', { name: 'Mark live' })).toBeDisabled();
    await expect(v2.getByRole('button', { name: 'Approve' })).toHaveCount(0);
    await ui.getByRole('banner').getByRole('button', { name: 'Back' }).click();
    await proSetName(ui, 'reviewer');
    await ui.getByRole('button', { name: 'History of Local product' }).click();
    await v2.getByRole('button', { name: 'Approve' }).click();
    await ui.getByLabel('Note (optional)').fill('checked the grid');
    await ui.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
    await expect(v2).toContainText('approved by reviewer');
    await expect(v2.getByTestId('pro-review-note')).toHaveText('reviewer: checked the grid');

    await v2.getByRole('button', { name: 'Mark live' }).click();
    await ui.getByLabel('Why').fill('checked by hand');
    await ui.getByRole('button', { name: 'Move live' }).click();
    await expect(ui.getByTestId('pro-version').first()).toContainText('live');
    await expect(ui.getByTestId('pro-label-move').first()).toContainText('live v2 · ');

    await ui.getByTestId('pro-version').nth(1).getByRole('button', { name: 'Restore' }).click();
    await expect(ui.getByTestId('pro-version')).toHaveCount(3);
    await expect(ui.getByTestId('pro-version').first()).toContainText('restored');
    await expect(diff).toContainText('added');
    await expect(diff).toContainText('field heading');
    if (process.env.UX_SHOTS) await ui.screenshot({ path: `${process.env.UX_SHOTS}/pro-history.png`, fullPage: true });
    await ui.close();
    await page.close();
});

test('build new: a list picked on the page saves as version 1, then opens again for an edit', async ({ panel, ext, origin }) => {
    const page = await ext.newPage();
    await page.goto(`${origin}/site/list-1.html`);
    const tabId = await panel.tabId(page.url());
    await panel.toTab(tabId, 'PING');
    const ui = await ext.newPage();
    await ui.setViewportSize({ width: 400, height: 900 });
    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html?tabId=${tabId}`);
    await proClear(ui);
    await ui.reload();

    await ui.getByRole('button', { name: 'Build new' }).click();
    await ui.getByRole('button', { name: /^List recipe/ }).click();
    await ui.getByRole('button', { name: 'Point at one item' }).click();
    const box = (await page.locator('li.card').first().boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + 10);
    await page.waitForTimeout(150);
    await page.mouse.click(box.x + 20, box.y + 10);
    await expect(ui.getByRole('button', { name: 'Add another list' })).toBeVisible({ timeout: 15_000 });
    // A recipe session never runs: no one-click run, only the way to the save step.
    await expect(ui.getByRole('button', { name: /Get the data/ })).toHaveCount(0);

    await ui.getByRole('button', { name: 'Change pages & settings' }).click();
    await ui.getByRole('button', { name: 'Continue' }).click();
    const step = ui.getByTestId('pro-save-version');
    await expect(step).toContainText('A new list recipe');
    await expect(step).toContainText('1 list');
    await ui.getByLabel('Recipe name').fill('Local list');
    await ui.getByRole('button', { name: 'Save version' }).click();
    await expect(ui.getByText('Saved Local list v1')).toBeVisible();

    const [version] = await proStore(ui, 'versions');
    expect(version).toMatchObject({ version: 1, origin: 'built', pages: { kind: 'start', url: page.url() }, spec: { kind: 'list' } });
    expect(version.spec.lists[0].fields.length).toBeGreaterThan(0);

    await ui.getByRole('button', { name: 'Back to recipes' }).click();
    await ui.getByRole('button', { name: 'Edit Local list' }).click();
    await expect(ui.getByText("A list recipe's fields are edited by picking the list again.")).toBeVisible();
    await ui.getByRole('banner').getByRole('button', { name: 'Re-pick on page' }).click();
    await expect(ui.getByRole('button', { name: 'Title' })).toBeVisible();
    await ui.getByRole('button', { name: 'Change pages & settings' }).click();
    await ui.getByRole('button', { name: 'Continue' }).click();
    await expect(ui.getByTestId('pro-save-version')).toContainText('Local list: version 2');
    await ui.getByRole('button', { name: 'Save version' }).click();
    await expect(ui.getByText('Nothing changed since the version this was edited from')).toBeVisible();
    await ui.close();
    await page.close();
});

test('fields panel: rename, type, required, a selector and cleanup, saved as the next version', async ({ panel }) => {
    const ui = panel.page;
    await ui.setViewportSize({ width: 400, height: 900 });
    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html`);
    await proClear(ui);
    await ui.reload();
    const file = {
        name: 'Shop product', site: 'shop.test', built_on: 'https://shop.test/p/1',
        spec: {
            kind: 'page', settings: {}, elements: [
                { id: 'a', name: 'title', action: 'extract', type: 'text', selectors: ['h1'] },
                { id: 'b', name: 'specs', action: 'extract', type: 'text', selectors: ['.specs'] },
            ],
        },
    };
    await ui.getByTestId('recipe-import').setInputFiles({ name: 'shop.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
    await ui.getByRole('button', { name: 'Edit Shop product' }).click();
    await expect(ui.getByTestId('pro-field')).toHaveCount(2);
    await expect(ui.getByText('No changes yet.')).toBeVisible();

    const title = ui.getByTestId('pro-field').first();
    await title.getByRole('button').first().click();
    await title.getByLabel('Name').fill('name');
    await title.getByLabel('Required').check();
    await title.getByLabel('Add a selector').fill('h1.product-title');
    await title.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(title).toContainText('h1.product-title');

    const specs = ui.getByTestId('pro-field').nth(1);
    await specs.getByRole('button').first().click();
    await specs.getByLabel('Type').selectOption('object');
    await specs.getByLabel('Add a step').selectOption('toObject');
    await specs.getByLabel('Try on a value').fill('Fit: Relaxed\\nLength: Regular');
    await expect(specs.getByTestId('pro-try-result')).toHaveText('→ {"Fit":"Relaxed","Length":"Regular"}');

    await expect(ui.getByTestId('pro-editor-changes')).toHaveText('2 changes: field title → name, field specs');
    if (process.env.UX_SHOTS) await ui.screenshot({ path: `${process.env.UX_SHOTS}/pro-editor.png` });
    await ui.getByLabel('What changed').fill('typed fields');
    await ui.getByRole('button', { name: 'Save version 2' }).click();

    // Saved: History shows v2 and what it changed.
    await expect(ui.getByTestId('pro-version')).toHaveCount(2);
    const diff = ui.getByTestId('pro-diff');
    await expect(diff).toContainText('field title → name');
    await expect(diff).toContainText('now required');
    await expect(diff).toContainText('way added: h1.product-title');
    await expect(diff).toContainText('type text → object');
    await expect(diff).toContainText('cleanup none → toObject');
    const [v2] = (await proStore(ui, 'versions')).filter(v => v.version === 2);
    const fields = v2.spec.steps.map((s: any) => s.field);
    expect(fields[0]).toMatchObject({ name: 'name', required: true });
    expect(fields[0].ways.map((w: any) => w.selector)).toEqual(['h1', 'h1.product-title']);
    expect(fields[1]).toMatchObject({ type: 'object', ops: [{ op: 'toObject', sep: ':' }] });
});

test('test on this page: each field found, typed and checked; the run is kept for its spec', async ({ panel, ext, origin }) => {
    const page = await ext.newPage();
    await page.goto(`${origin}/site/json-product.html`);
    const tabId = await panel.tabId(page.url());
    await panel.toTab(tabId, 'PING');
    const ui = await ext.newPage();
    await ui.setViewportSize({ width: 400, height: 900 });
    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html?tabId=${tabId}`);
    await proClear(ui);
    await ui.reload();

    const file = {
        name: 'Overshirt', site: '127.0.0.1', built_on: page.url(),
        spec: {
            kind: 'page', settings: {}, elements: [
                { id: 'a', name: 'title', action: 'extract', type: 'text', selectors: ['h1'] },
                { id: 'b', name: 'price', action: 'extract', type: 'text', selectors: ['p.price'] },
                { id: 'c', name: 'sku', action: 'extract', type: 'text', selectors: ['.sku'] },
                { id: 'd', name: 'code', action: 'extract', type: 'text', selectors: [], data: { kind: 'ld', label: 'JSON-LD', nth: 0, type: 'ProductGroup', path: [], as: 'text', key: 'productGroupID' } },
            ],
        },
    };
    await ui.getByTestId('recipe-import').setInputFiles({ name: 'o.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
    await ui.getByRole('button', { name: 'Edit Overshirt' }).click();

    const card = (name: string) => ui.getByTestId('pro-field').filter({ has: ui.getByText(name, { exact: true }) });
    await card('price').getByRole('button').first().click();
    await card('price').getByLabel('Type').selectOption('money');
    await card('sku').getByRole('button').first().click();
    await card('sku').getByLabel('Required').check();

    await ui.getByRole('button', { name: /^Test on this page/ }).click();
    const summary = ui.getByTestId('pro-test-summary');
    await expect(summary).toContainText('3 of 4 fields found');
    await expect(summary).toContainText('1 with a problem');
    await expect(card('price').getByTestId('pro-field-result')).toContainText('79');
    await expect(card('sku')).toContainText('required, but empty');
    await expect(card('code')).toContainText('found');

    // The run is kept under the spec's digest; an edit after it marks it out of date.
    const [run] = await proStore(ui, 'tests');
    expect(run).toMatchObject({ kind: 'page', passed: false });
    expect(run.results[0].fields.find((f: any) => f.name === 'code')).toMatchObject({ status: 'data', value: 'LX-2041' });
    await card('sku').getByLabel('Required').uncheck();
    await expect(summary).toContainText('You changed the recipe since this test.');
    await ui.getByRole('button', { name: /^Test on this page/ }).click();
    await expect(summary).not.toContainText('with a problem');
    if (process.env.UX_SHOTS) await ui.screenshot({ path: `${process.env.UX_SHOTS}/pro-test.png` });
    await ui.close();
    await page.close();
});

test('steps before reading: a ZIP set through the page\'s dialog, checked, pop-ups dismissed, a tile chosen, then the fields', async ({ panel, ext, origin }) => {
    test.setTimeout(120_000);
    // The retailer page: a consent banner, "Deliver to" with a ZIP dialog that reloads, a promo pop-up, fulfilment tiles.
    const page = await ext.newPage();
    await page.goto(`${origin}/site/retailer.html`);
    const tabId = await panel.tabId(page.url());
    await panel.toTab(tabId, 'PING');
    const ui = await ext.newPage();
    await ui.setViewportSize({ width: 400, height: 1000 });
    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html?tabId=${tabId}`);
    await proClear(ui);
    await ui.reload();
    const file = {
        name: 'Lamp', site: '127.0.0.1', built_on: page.url(),
        spec: { kind: 'page', settings: {}, elements: [
            { id: 'a', name: 'title', action: 'extract', type: 'text', selectors: ['h1.product-title'] },
            { id: 'b', name: 'price', action: 'extract', type: 'text', selectors: ['#price'] },
            { id: 'c', name: 'delivery', action: 'extract', type: 'text', selectors: ['#fulfil-detail'] },
        ] },
    };
    await ui.getByTestId('recipe-import').setInputFiles({ name: 'lamp.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
    await ui.getByRole('button', { name: 'Edit Lamp' }).click();

    // Before reading: three setup steps, a check, two dismissals, a test value.
    const before = ui.getByTestId('pro-before-reading');
    await before.getByRole('button', { name: /Before reading/ }).click(); // folded while there is none
    const action = (n: number) => before.getByTestId('pro-action').nth(n);
    const step = async (n: number, name: string, selector: string, what?: string, value?: string) => {
        await before.getByRole('button', { name: 'Add setup step' }).click();
        await action(n).getByLabel('Setup step name').fill(name);
        if (what) await action(n).getByLabel('What it does').selectOption(what);
        if (value) await action(n).getByLabel(/Text to type|The item that shows/).fill(value);
        await action(n).getByLabel('Add a selector').fill(selector);
        await action(n).getByRole('button', { name: 'Add', exact: true }).click();
    };
    await step(0, 'Open location', '#deliver-to');
    await step(1, 'Type ZIP', '#zip-input', 'type', '{zip}');
    await step(2, 'Apply', '#zip-apply');
    await before.getByRole('button', { name: 'Add a check' }).click();
    const check = before.getByTestId('pro-setup-check');
    await check.getByLabel('Its text must contain').fill('{zip}');
    await check.getByLabel('Add a selector').fill('#loc-label');
    await check.getByRole('button', { name: 'Add', exact: true }).click();
    for (const [n, selector] of [[3, '#consent-reject'], [4, '#promo-close']] as const) {
        await before.getByRole('button', { name: 'Add dismissal' }).click();
        await action(n).getByLabel('Add a selector').fill(selector);
        await action(n).getByRole('button', { name: 'Add', exact: true }).click();
        await expect(action(n).getByLabel('What it does')).toHaveCount(0); // a dismissal is a click
    }
    await before.getByTestId('pro-test-values').getByLabel('{zip}').fill('10001');

    // Try setup: it runs on the tab, through the reload, and the check is met.
    await before.getByRole('button', { name: 'Try setup on this page' }).click();
    await expect(before.getByTestId('pro-try-setup')).toContainText('The setup worked on this page', { timeout: 30_000 });
    await expect(page.locator('#loc-label')).toHaveText('10001');

    // The check's element picked on the page too, as a second way.
    if (await page.locator('#promo').isVisible()) await page.locator('#promo-close').click();
    await check.getByRole('button', { name: 'Pick on page' }).click();
    const label = page.locator('#loc-label');
    const box = (await label.boundingBox())!;
    await page.mouse.move(box.x + 2, box.y + 2);
    await page.mouse.move(box.x + 4, box.y + 4);
    await page.waitForTimeout(150);
    await page.mouse.click(box.x + 4, box.y + 4);
    await expect.poll(() => check.getByText('Selector').count()).toBeGreaterThan(1); // the picker gives a selector and fallbacks

    // A page step: choose the Delivery tile, before the delivery field.
    await ui.getByRole('button', { name: 'Add a step' }).click();
    const tile = ui.getByTestId('pro-page-action');
    await tile.getByLabel('Step name').fill('Delivery tile');
    await tile.getByLabel('What it does').selectOption('choose');
    await tile.getByLabel('The item that shows').fill('Delivery');
    await tile.getByLabel('Add a selector').fill('.fulfil-tile');
    await tile.getByRole('button', { name: 'Add', exact: true }).click();
    await tile.getByRole('button', { name: 'Move up' }).click();

    // Test on this page: the session is set already (the check is met), the tile is chosen, the fields read.
    await ui.getByRole('button', { name: /^Test on this page/ }).click();
    const summary = ui.getByTestId('pro-test-summary');
    await expect(summary).toContainText('3 of 3 fields found', { timeout: 30_000 });
    await expect(summary).toContainText('Session already set up.');
    const card = (name: string) => ui.getByTestId('pro-field').filter({ has: ui.getByText(name, { exact: true }) });
    await expect(card('price').getByTestId('pro-field-result')).toContainText('$12.99');
    await expect(card('delivery').getByTestId('pro-field-result')).toContainText('Delivery tomorrow to 10001');

    // The same step for each tile instead: one row per item.
    await tile.getByLabel('For each item: one row per item').check();
    await tile.getByLabel('Only these items, in order').fill('Pickup, Delivery');
    await ui.getByRole('button', { name: /^Test on this page/ }).click();
    const rows = ui.getByTestId('pro-test-option');
    await expect(rows).toHaveCount(2, { timeout: 30_000 });
    await expect(rows.nth(0)).toContainText('Pickup: delivery = Choose a store for pickup');
    await expect(rows.nth(1)).toContainText('Delivery: delivery = Delivery tomorrow to 10001');

    // Saved: the setup and the step are part of the version, their ways with ids.
    await expect(ui.getByTestId('pro-editor-changes')).toContainText('session setup');
    await ui.getByLabel('What changed').fill('ZIP code first');
    await ui.getByRole('button', { name: 'Save version 2' }).click();
    await expect(ui.getByTestId('pro-diff')).toContainText('session setup');
    const [v2] = (await proStore(ui, 'versions')).filter(v => v.version === 2);
    expect(v2.spec.setup.steps.map((s: any) => [s.name, s.do ?? 'click', s.value ?? null])).toEqual([['Open location', 'click', null], ['Type ZIP', 'type', '{zip}'], ['Apply', 'click', null]]);
    expect(v2.spec.setup.check).toMatchObject({ contains: '{zip}' });
    expect(v2.spec.setup.dismiss).toHaveLength(2);
    expect(v2.spec.setup.steps[1].ways[0].id).toEqual(expect.any(String));
    expect(v2.spec.steps.map((s: any) => s.kind === 'field' ? s.field.name : `${s.click.do} each:${s.click.forEach?.values}`)).toEqual(['title', 'price', 'choose each:Pickup,Delivery', 'delivery']);

    // Picked again in the Page Extractor, and saved with a field renamed: the setup and the step stay as they were.
    await ui.getByRole('button', { name: 'Edit fields' }).click();
    await ui.getByRole('banner').getByRole('button', { name: 'Re-pick on page' }).click();
    await ui.getByRole('button', { name: 'Next: pages' }).click();
    await ui.getByRole('button', { name: 'Next: 1 page' }).click();
    const saveFields = ui.getByTestId('pro-save-field');
    await expect(saveFields).toHaveCount(3);
    await saveFields.nth(2).getByLabel('Field 3', { exact: true }).fill('delivery_message');
    await ui.getByLabel('What changed').fill('renamed');
    await ui.getByRole('button', { name: 'Save version' }).click();
    await expect(ui.getByText(/Saved .* v3/)).toBeVisible();
    const [v3] = (await proStore(ui, 'versions')).filter(v => v.version === 3);
    expect(v3.spec.setup.steps.map((s: any) => s.name)).toEqual(['Open location', 'Type ZIP', 'Apply']);
    expect(v3.spec.setup.dismiss).toHaveLength(2);
    expect(v3.spec.steps.map((s: any) => s.kind === 'field' ? s.field.name : `${s.click.do} each:${s.click.forEach?.values}`)).toEqual(['title', 'price', 'choose each:Pickup,Delivery', 'delivery_message']);
    await ui.close();
    await page.close();
});

test('markup: a field read from the page\'s meta tags or microdata, chosen from what the open page has', async ({ panel, ext, origin }) => {
    const page = await ext.newPage();
    await page.goto(`${origin}/site/microdata-product.html`);
    const tabId = await panel.tabId(page.url());
    await panel.toTab(tabId, 'PING');
    const ui = await ext.newPage();
    await ui.setViewportSize({ width: 400, height: 1000 });
    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html?tabId=${tabId}`);
    await proClear(ui);
    await ui.reload();
    // Selectors from an older layout: they find nothing on this page.
    const file = { name: 'Overshirt', site: '127.0.0.1', built_on: page.url(), spec: { kind: 'page', settings: {}, elements: [
        { id: 'a', name: 'title', action: 'extract', type: 'text', selectors: ['h1.product-title'] },
        { id: 'b', name: 'price', action: 'extract', type: 'text', selectors: ['.price'] },
    ] } };
    await ui.getByTestId('recipe-import').setInputFiles({ name: 'o.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
    await ui.getByRole('button', { name: 'Edit Overshirt' }).click();

    const card = (name: string) => ui.getByTestId('pro-field').filter({ has: ui.getByText(name, { exact: true }) });
    const fromMarkup = async (name: string, option: RegExp) => {
        await card(name).getByRole('button').first().click();
        await card(name).getByRole('button', { name: 'From the page\'s markup' }).click();
        const choose = card(name).getByLabel('Read it from the page\'s markup');
        const value = await choose.locator('option').filter({ hasText: option }).first().getAttribute('value');
        await choose.selectOption(value!);
        await expect(card(name)).toContainText('Markup');
    };
    await fromMarkup('title', /^og:title = Linen overshirt$/);
    await fromMarkup('price', /^Product · offers\.price = 79\.00$/);

    await ui.getByRole('button', { name: /^Test on this page/ }).click();
    await expect(ui.getByTestId('pro-test-summary')).toContainText('2 of 2 fields found');
    await expect(card('title').getByTestId('pro-field-result')).toContainText('Linen overshirt');
    await expect(card('price').getByTestId('pro-field-result')).toContainText('79.00');

    await ui.getByLabel('What changed').fill('read from markup');
    await ui.getByRole('button', { name: 'Save version 2' }).click();
    await expect(ui.getByTestId('pro-diff')).toContainText('way added: meta og:title');
    const [v2] = (await proStore(ui, 'versions')).filter(v => v.version === 2);
    expect(v2.spec.steps[1].field.ways[0]).toMatchObject({ kind: 'markup', source: 'microdata', type: 'Product', key: 'offers.price', id: expect.any(String) });
    await ui.close();
    await page.close();
});

test('check: one row per field with its typed value, outlined on the page, and what is left before submitting', async ({ panel, ext, origin }) => {
    const page = await ext.newPage();
    await page.goto(`${origin}/site/json-product.html`);
    const tabId = await panel.tabId(page.url());
    await panel.toTab(tabId, 'PING');
    const ui = await ext.newPage();
    await ui.setViewportSize({ width: 400, height: 1100 });
    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html?tabId=${tabId}`);
    await proClear(ui);
    await ui.reload();
    const file = { name: 'Overshirt', site: '127.0.0.1', built_on: page.url(), spec: { kind: 'page', settings: {}, elements: [
        { id: 'a', name: 'title', action: 'extract', type: 'text', selectors: ['h1'] },
        { id: 'b', name: 'price', action: 'extract', type: 'text', selectors: ['p.price'], shape: 'price' },
        { id: 'c', name: 'sku', action: 'extract', type: 'text', selectors: ['.sku'] },
    ] } };
    await ui.getByTestId('recipe-import').setInputFiles({ name: 'o.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });

    // From the recipe's card straight to Check.
    await ui.getByRole('button', { name: 'Check Overshirt' }).click();
    await ui.getByRole('button', { name: 'Check this page' }).click();
    const rows = ui.getByTestId('pro-check-row');
    await expect(rows).toHaveCount(3);
    const row = (name: string) => rows.filter({ has: ui.getByText(name, { exact: true }) });
    await expect(row('title')).toContainText('Linen Overshirt');
    await expect(row('title')).toContainText('✓ text');
    await expect(row('price').getByTestId('pro-check-value')).toHaveText('79.00 USD');
    await expect(row('price')).toContainText('✓ money, USD');
    await expect(row('price')).toContainText('selector');
    await expect(row('sku').getByTestId('pro-check-value')).toHaveText('—');
    await expect(row('sku')).toContainText('empty');

    // On the page: each field it found, outlined with its name.
    await expect(page.locator('#crawlpilot-check-layer [data-field="price"]')).toHaveCount(1);
    await expect(page.locator('#crawlpilot-check-layer [data-field="sku"]')).toHaveCount(0);
    await ui.getByRole('button', { name: 'Hide on page' }).click();
    await expect(page.locator('#crawlpilot-check-layer')).toHaveCount(0);
    await ui.getByRole('button', { name: 'Show on page' }).click();
    await expect(page.locator('#crawlpilot-check-layer [data-field="title"]')).toHaveCount(1);

    // What is left before submitting, each with the way to it.
    const items = ui.getByTestId('pro-check-item');
    await expect(items.nth(0)).toContainText('2 of 3 fields found on this page');
    await expect(items.nth(1)).toContainText('Not tested on sample pages yet.');
    await expect(items.nth(2).getByRole('button', { name: 'Set targeting' })).toBeVisible();
    await expect(items.nth(3)).toContainText('Not reviewed');
    if (process.env.UX_SHOTS) await ui.screenshot({ path: `${process.env.UX_SHOTS}/pro-check.png` });
    if (process.env.UX_SHOTS) await page.screenshot({ path: `${process.env.UX_SHOTS}/pro-check-page.png` });

    // The page the recipe was built on is its first sample; checked, it fills the grid and is kept for the version.
    await expect(ui.getByRole('button', { name: 'Add this page' })).toBeDisabled();
    await ui.getByRole('button', { name: 'Check 1 sample page' }).click();
    await expect(ui.getByTestId('pro-check-samples')).toContainText('title', { timeout: 30_000 });
    await expect(items.nth(1)).toContainText('Tested on 1 page; it needs 3.');

    // Saving a new version from the Page Extractor goes on to Check.
    await ui.getByRole('banner').getByRole('button', { name: 'Back' }).click();
    await ui.getByRole('button', { name: 'Edit Overshirt' }).click();
    await ui.getByRole('banner').getByRole('button', { name: 'Re-pick on page' }).click();
    await ui.getByRole('button', { name: 'Remove' }).last().click();
    await ui.getByRole('button', { name: 'Next: pages' }).click();
    await ui.getByRole('button', { name: 'Next: 1 page' }).click();
    await ui.getByLabel('What changed').fill('no sku');
    await ui.getByRole('button', { name: 'Save version' }).click();
    await ui.getByRole('button', { name: 'Check it on this page' }).click();
    await expect(ui.getByRole('banner')).toContainText('Overshirt · v2');
    await ui.getByRole('button', { name: 'Check this page' }).click();
    await expect(ui.getByTestId('pro-check-row')).toHaveCount(2);
    await expect(ui.getByTestId('pro-check-item').first()).toContainText('2 of 2 fields found on this page');
    await ui.close();
    await page.close();
});

test('build new: picked fields come to the save step named and typed from the page, and can be changed there', async ({ panel, ext, origin }) => {
    const page = await ext.newPage();
    await page.goto(`${origin}/site/json-product.html`);
    const tabId = await panel.tabId(page.url());
    await panel.toTab(tabId, 'PING');
    const ui = await ext.newPage();
    await ui.setViewportSize({ width: 400, height: 1000 });
    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html?tabId=${tabId}`);
    await proClear(ui);
    await ui.reload();
    await ui.getByRole('button', { name: 'Build new' }).click();
    await ui.getByRole('button', { name: /^Page recipe/ }).click();
    const pickOn = async (target: string) => {
        const box = (await page.locator(target).first().boundingBox())!;
        await page.mouse.move(box.x + 4, box.y + 4);
        await page.mouse.move(box.x + 6, box.y + 6);
        await page.waitForTimeout(150);
        await page.mouse.click(box.x + 6, box.y + 6);
    };
    await ui.getByText('Pick data fields').click();
    await pickOn('h1');
    await expect(ui.getByText('1 field')).toBeVisible();
    await ui.getByRole('button', { name: 'Add field' }).click();
    await pickOn('p.price');
    await expect(ui.getByText('2 fields')).toBeVisible();
    await ui.getByRole('button', { name: 'Next: pages' }).click();
    await ui.getByRole('button', { name: 'Next: 1 page' }).click();

    // Not h1 and p: what the page says they are, and the type the crawler will output.
    const fields = ui.getByTestId('pro-save-field');
    await expect(fields).toHaveCount(2);
    await expect(fields.nth(0).getByLabel('Field 1', { exact: true })).toHaveValue('title');
    await expect(fields.nth(0)).toContainText('named from the page\'s data: name');
    await expect(fields.nth(1).getByLabel('Field 2', { exact: true })).toHaveValue('price');
    await expect(fields.nth(1).getByLabel('Type of field 2')).toHaveValue('money');
    if (process.env.UX_SHOTS) await ui.screenshot({ path: `${process.env.UX_SHOTS}/pro-save-fields.png` });

    // Changed here, before version 1 exists; two of a name can't be saved.
    await fields.nth(0).getByLabel('Field 1', { exact: true }).fill('price');
    await expect(ui.getByText('Two fields have the same name.')).toBeVisible();
    await expect(ui.getByRole('button', { name: 'Save version' })).toBeDisabled();
    await fields.nth(0).getByLabel('Field 1', { exact: true }).fill('product_name');
    await ui.getByRole('button', { name: 'Save version' }).click();
    await expect(ui.getByRole('button', { name: 'Check it on this page' })).toBeVisible();
    const [v1] = await proStore(ui, 'versions');
    expect(v1.spec.steps.map((s: any) => [s.field.name, s.field.type])).toEqual([['product_name', 'text'], ['price', 'money']]);
    await ui.close();
    await page.close();
});

test('test on sample pages: background tabs, a grid of fields × pages, the run kept', async ({ panel, ext, origin }) => {
    test.setTimeout(90_000);
    const page = await ext.newPage();
    await page.goto(`${origin}/site/json-product.html`);
    const tabId = await panel.tabId(page.url());
    const ui = await ext.newPage();
    await ui.setViewportSize({ width: 400, height: 900 });
    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html?tabId=${tabId}`);
    await proClear(ui);
    await ui.reload();

    const file = {
        name: 'Any product', site: '127.0.0.1', built_on: `${origin}/site/json-shop.html`, checked_on: [`${origin}/site/article.html`],
        spec: {
            kind: 'page', settings: { requestDelay: 100 }, elements: [
                { id: 'a', name: 'title', action: 'extract', type: 'text', selectors: ['h1'] },
                { id: 'b', name: 'price', action: 'extract', type: 'text', selectors: ['.price'] },
                { id: 'c', name: 'code', action: 'extract', type: 'text', selectors: [], data: { kind: 'ld', label: 'JSON-LD', nth: 0, type: 'ProductGroup', path: [], as: 'text', key: 'productGroupID' } },
            ],
        },
    };
    await ui.getByTestId('recipe-import').setInputFiles({ name: 'p.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
    await ui.getByRole('button', { name: 'Edit Any product' }).click();

    // The imported pages are the samples; the open page joins them.
    const samples = ui.getByTestId('pro-samples');
    await expect(samples).toContainText('Sample pages (2)');
    await samples.getByRole('button', { name: 'Add this page' }).click();
    await expect(samples).toContainText('Sample pages (3)');
    await expect(samples.getByRole('button', { name: 'Add this page' })).toBeDisabled();

    const before = (await ext.pages()).length;
    await samples.getByRole('button', { name: 'Test on 3 pages' }).click();
    const grid = samples.getByTestId('pro-test-grid');
    await expect(grid).toBeVisible({ timeout: 60_000 });
    expect((await ext.pages()).length).toBe(before);
    const row = (name: string) => grid.locator('tr', { has: ui.getByRole('cell', { name, exact: true }) });
    await expect(row('title')).toContainText('3/3');
    await expect(row('price')).toContainText('2/3');
    await expect(row('code')).toContainText('1/3');
    await expect(samples.getByText('ready', { exact: true })).toBeVisible();

    await grid.getByRole('button', { name: 'code on page 3: found' }).click();
    await expect(samples.getByTestId('pro-grid-cell')).toContainText('LX-2041');

    const runs = await proStore(ui, 'tests');
    expect(runs.find((r: any) => r.kind === 'pages')).toMatchObject({ passed: true });
    expect(runs.find((r: any) => r.kind === 'pages').results.map((r: any) => new URL(r.url).pathname))
        .toEqual(['/site/json-shop.html', '/site/article.html', '/site/json-product.html']);
    if (process.env.UX_SHOTS) await ui.screenshot({ path: `${process.env.UX_SHOTS}/pro-grid.png` });
    await expect(samples.getByTestId('pro-readiness')).toHaveText('Ready to submit.');

    // code required: empty on two pages, so the next version is not ready; the tested v1 is.
    const code = ui.getByTestId('pro-field').filter({ has: ui.getByText('code', { exact: true }) });
    await code.getByRole('button').first().click();
    await code.getByLabel('Required').check();
    await expect(samples.getByTestId('pro-readiness')).toHaveCount(0);
    await samples.getByRole('button', { name: 'Test on 3 pages' }).click();
    await expect(samples.getByTestId('pro-readiness')).toHaveText('Not ready: code: required, but empty on 2 pages.', { timeout: 60_000 });
    await ui.getByRole('button', { name: 'Save version 2' }).click();
    await expect(ui.getByTestId('pro-version')).toHaveCount(2);
    await expect(ui.getByTestId('pro-version').first()).toContainText('Not ready: code: required, but empty on 2 pages.');
    await expect(ui.getByTestId('pro-version').nth(1)).toContainText('ready to submit');
    await ui.close();
    await page.close();
});

test('output contract: pasted, mapped, checked on the tested pages, and part of ready to submit', async ({ panel, ext, origin }) => {
    test.setTimeout(90_000);
    const page = await ext.newPage();
    await page.goto(`${origin}/site/json-product.html`);
    const tabId = await panel.tabId(page.url());
    const ui = await ext.newPage();
    await ui.setViewportSize({ width: 400, height: 900 });
    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html?tabId=${tabId}`);
    await proClear(ui);
    await ui.reload();

    const file = {
        name: 'Contract product', site: '127.0.0.1', built_on: `${origin}/site/json-product.html`,
        checked_on: [`${origin}/site/json-shop.html`, `${origin}/site/article.html`],
        spec: {
            kind: 'page', settings: { requestDelay: 100 }, elements: [
                { id: 'a', name: 'title', action: 'extract', type: 'text', selectors: ['h1'] },
                { id: 'b', name: 'maker', action: 'extract', type: 'text', selectors: [], data: { kind: 'ld', label: 'JSON-LD', nth: 0, type: 'ProductGroup', path: [], as: 'text', key: 'brand.name' } },
            ],
        },
    };
    await ui.getByTestId('recipe-import').setInputFiles({ name: 'c.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
    await ui.getByRole('button', { name: 'Edit Contract product' }).click();

    await ui.getByRole('button', { name: /Output contract/ }).click();
    const contract = ui.getByTestId('pro-contract');
    await contract.getByLabel('Output contract').selectOption('__paste__');
    await contract.getByLabel('JSON Schema').fill(JSON.stringify({
        type: 'object', required: ['title', 'brand'],
        properties: { title: { type: 'string' }, brand: { type: 'string' }, colour: { type: 'string' } },
    }));
    await contract.getByRole('button', { name: 'Use this schema' }).click();
    const rows = contract.getByTestId('pro-contract-row');
    await expect(rows).toHaveCount(3);
    await expect(contract.getByLabel('Field for title')).toHaveValue('title');
    await expect(contract.getByLabel('Field for brand')).toHaveValue('');

    const samples = ui.getByTestId('pro-samples');
    await samples.getByRole('button', { name: 'Test on 3 pages' }).click();
    await expect(samples.getByTestId('pro-readiness')).toHaveText('Not ready: Contract: no field gives the required "brand".', { timeout: 60_000 });

    // brand from maker: mapped by hand, filled on 1 page of 3.
    await contract.getByLabel('Field for brand').selectOption('maker');
    await expect(rows.filter({ hasText: 'brand' })).toContainText('33%');
    await expect(samples.getByTestId('pro-readiness')).toHaveText('Not ready: Contract: "brand" is filled on 33% of pages; it needs 95%.');
    if (process.env.UX_SHOTS) { await contract.scrollIntoViewIfNeeded(); await ui.screenshot({ path: `${process.env.UX_SHOTS}/pro-contract.png` }); }

    await ui.getByRole('button', { name: 'Save version 2' }).click();
    await expect(ui.getByTestId('pro-version')).toHaveCount(2);
    await expect(ui.getByTestId('pro-diff')).toContainText('contract none → Pasted schema');
    await expect(ui.getByTestId('pro-version').first()).toContainText('Contract: "brand" is filled on 33% of pages');
    const [v2] = (await proStore(ui, 'versions')).filter(v => v.version === 2);
    expect(v2.output).toMatchObject({ contract: { label: 'Pasted schema' }, mapping: { brand: 'maker' } });
    await ui.close();
    await page.close();
});

test('submit: a ready version goes to the backend, becomes live, and its crawl is followed', async ({ panel, ext, origin }) => {
    test.setTimeout(90_000);
    const mock = await serveMockBackend();
    const page = await ext.newPage();
    await page.goto(`${origin}/site/json-product.html`);
    const tabId = await panel.tabId(page.url());
    const ui = await ext.newPage();
    await ui.setViewportSize({ width: 400, height: 900 });
    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html?tabId=${tabId}`);
    await proClear(ui);
    await ui.reload();

    // The backend: a wrong token first.
    await ui.getByRole('button', { name: 'Backend' }).click();
    await ui.getByLabel('Address').fill(`${mock.origin}/`);
    await ui.getByLabel('Access token').fill('wrong');
    await ui.getByRole('button', { name: 'Save' }).click();

    const file = {
        name: 'Submitted product', site: '127.0.0.1', built_on: `${origin}/site/json-product.html`,
        checked_on: [`${origin}/site/json-shop.html`, `${origin}/site/article.html`],
        spec: { kind: 'page', settings: { requestDelay: 100 }, elements: [{ id: 'a', name: 'title', action: 'extract', type: 'text', selectors: ['h1'] }] },
    };
    await ui.getByTestId('recipe-import').setInputFiles({ name: 's.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });

    // Not tested: no Submit. Tested on the 3 samples: ready, and Submit appears.
    await ui.getByRole('button', { name: 'History of Submitted product' }).click();
    await expect(ui.getByTestId('pro-version')).toContainText('Not ready: Not tested on sample pages yet.');
    await expect(ui.getByRole('button', { name: 'Submit' })).toHaveCount(0);
    await ui.getByRole('button', { name: 'Edit fields' }).click();
    await ui.getByTestId('pro-samples').getByRole('button', { name: 'Test on 3 pages' }).click();
    await expect(ui.getByTestId('pro-readiness')).toHaveText('Ready to submit.', { timeout: 60_000 });
    // Back from the editor is History again, now with the test.
    await ui.getByRole('banner').getByRole('button', { name: 'Back' }).click();
    await expect(ui.getByTestId('pro-version')).toContainText('ready to submit');

    // Ready, but the workers could not find it yet: no competitor or page type.
    await expect(ui.getByTestId('pro-targeting-missing')).toHaveText('Needed to submit: Set the competitor. Set the page type.');
    await ui.getByRole('button', { name: 'Submit' }).click();
    await expect(ui.getByRole('dialog')).toContainText('Not yet: Set the competitor. Set the page type.');
    await expect(ui.getByRole('dialog').getByRole('button', { name: 'Submit' })).toBeDisabled();
    await ui.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

    // Targeting: rules that leave out a sample are flagged as you type.
    await ui.getByRole('button', { name: 'Edit targeting' }).click();
    await ui.getByLabel('Competitor').fill('Acme');
    await ui.getByLabel('Page type').fill('product');
    await ui.getByLabel('URLs it is for').fill(`${origin}/site/json-*`);
    await expect(ui.getByRole('dialog')).toContainText(`These rules leave out 1 sample page: ${origin}/site/article.html`);
    await ui.getByLabel('URLs it is for').fill(`${origin}/site/*`);
    await expect(ui.getByRole('dialog')).not.toContainText('leave out');
    await ui.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await expect(ui.getByTestId('pro-targeting')).toContainText('acme');
    await expect(ui.getByTestId('pro-targeting')).toContainText(`For ${origin}/site/*`);
    await expect(ui.getByTestId('pro-targeting-missing')).toHaveCount(0);

    // Not reviewed yet, and its author cannot approve it: someone else rejects it, then approves it.
    await ui.getByRole('button', { name: 'Submit' }).click();
    await expect(ui.getByRole('dialog')).toContainText('Not yet: Not reviewed: someone other than its author approves it first.');
    await ui.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(ui.getByTestId('pro-version').getByRole('button', { name: 'Approve' })).toHaveCount(0);
    await ui.getByRole('banner').getByRole('button', { name: 'Back' }).click();
    await proSetName(ui, 'reviewer');
    await ui.getByRole('button', { name: 'History of Submitted product' }).click();
    await ui.getByRole('button', { name: 'Reject' }).click();
    await expect(ui.getByRole('dialog').getByRole('button', { name: 'Reject' })).toBeDisabled();
    await ui.getByLabel('Why').fill('title reads the site name');
    await ui.getByRole('dialog').getByRole('button', { name: 'Reject' }).click();
    await expect(ui.getByTestId('pro-version')).toContainText('rejected by reviewer');
    await expect(ui.getByTestId('pro-review-note')).toHaveText('reviewer: title reads the site name');
    await ui.getByRole('button', { name: 'Approve' }).click();
    await ui.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
    await expect(ui.getByTestId('pro-version')).toContainText('approved by reviewer');

    await ui.getByRole('button', { name: 'Submit' }).click();
    await ui.getByRole('radio', { name: 'Daily' }).click();
    await ui.getByRole('dialog').getByRole('button', { name: 'Submit' }).click();
    await expect(ui.getByRole('dialog')).toContainText('Sign in again: the token was not accepted.');
    expect(mock.backend.recipes.size).toBe(0);
    await ui.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

    // The right token: submitted, live, and a crawl to follow.
    await ui.getByRole('banner').getByRole('button', { name: 'Back' }).click();
    await ui.getByRole('button', { name: 'Backend' }).click();
    await ui.getByLabel('Access token').fill('dev-token');
    await ui.getByRole('button', { name: 'Save' }).click();
    await ui.getByRole('button', { name: 'History of Submitted product' }).click();
    await ui.getByRole('button', { name: 'Submit' }).click();
    await ui.getByRole('radio', { name: 'Daily' }).click();
    await ui.getByRole('dialog').getByRole('button', { name: 'Submit' }).click();
    await expect(ui.getByRole('dialog')).toHaveCount(0);

    const v1 = ui.getByTestId('pro-version').first();
    await expect(v1).toContainText('submitted');
    await expect(v1).toContainText('live');
    const crawl = ui.getByTestId('pro-crawl');
    await expect(crawl).toContainText('v1');
    await expect(crawl).toContainText('daily');
    expect([...mock.backend.recipes.values()][0]).toMatchObject({ name: 'Submitted product', competitor: 'acme', pageType: 'product', live: 1 });

    const refresh = ui.getByTestId('pro-crawls').getByRole('button', { name: 'Refresh' });
    await refresh.click();
    await expect(crawl).toContainText('queued');
    await refresh.click();
    await refresh.click();
    await expect(crawl).toContainText('done');
    await expect(crawl).toContainText('3 pages done · title 100%');

    // A rejection after the submit goes to the backend first: it will not make v1 live again.
    await v1.getByRole('button', { name: 'Reject' }).click();
    await ui.getByLabel('Why').fill('title reads the site name after all');
    await ui.getByRole('dialog').getByRole('button', { name: 'Reject' }).click();
    await expect(v1).toContainText('rejected by reviewer');
    expect([...mock.backend.recipes.values()][0].versions.get(1)!.review).toEqual({ state: 'rejected', by: 'reviewer', note: 'title reads the site name after all' });
    if (process.env.UX_SHOTS) await ui.screenshot({ path: `${process.env.UX_SHOTS}/pro-submit.png` });
    mock.close();
    await ui.close();
    await page.close();
});

test('maintain: a crawl that fills a field much less flags the recipe; Repair opens the editor on a failing page', async ({ panel, ext, origin }) => {
    test.setTimeout(120_000);
    const mock = await serveMockBackend();
    const page = await ext.newPage();
    await page.goto(`${origin}/site/json-product.html`);
    const tabId = await panel.tabId(page.url());
    const ui = await ext.newPage();
    await ui.setViewportSize({ width: 400, height: 900 });
    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html?tabId=${tabId}`);
    await proClear(ui);
    await ui.reload();
    await ui.getByRole('button', { name: 'Backend' }).click();
    await ui.getByLabel('Address').fill(mock.origin);
    await ui.getByLabel('Access token').fill('dev-token');
    await ui.getByRole('button', { name: 'Save' }).click();

    const file = {
        name: 'Watched product', site: '127.0.0.1', built_on: `${origin}/site/json-product.html`,
        checked_on: [`${origin}/site/json-shop.html`, `${origin}/site/article.html`],
        spec: { kind: 'page', settings: { requestDelay: 100 }, elements: [
            { id: 'a', name: 'title', action: 'extract', type: 'text', selectors: ['h1'] },
            { id: 'b', name: 'price', action: 'extract', type: 'text', selectors: ['.price'] },
        ] },
    };
    await ui.getByTestId('recipe-import').setInputFiles({ name: 'w.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
    await ui.getByRole('button', { name: 'History of Watched product' }).click();
    await ui.getByRole('button', { name: 'Edit fields' }).click();
    await ui.getByTestId('pro-samples').getByRole('button', { name: 'Test on 3 pages' }).click();
    await expect(ui.getByTestId('pro-readiness')).toHaveText('Ready to submit.', { timeout: 60_000 });
    await ui.getByRole('banner').getByRole('button', { name: 'Back' }).click();
    await ui.getByRole('button', { name: 'Edit targeting' }).click();
    await ui.getByLabel('Competitor').fill('acme');
    await ui.getByLabel('Page type').fill('product');
    await ui.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await ui.getByRole('banner').getByRole('button', { name: 'Back' }).click();
    await proSetName(ui, 'reviewer');
    await ui.getByRole('button', { name: 'History of Watched product' }).click();
    await ui.getByRole('button', { name: 'Approve' }).click();
    await ui.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
    await ui.getByRole('button', { name: 'Submit' }).click();
    await ui.getByRole('dialog').getByRole('button', { name: 'Submit' }).click();
    await expect(ui.getByTestId('pro-crawl')).toBeVisible();

    // The site changed: the crawl finds price on 10% of pages (it was on 2 of 3 tested pages).
    const crawl = [...mock.backend.crawls.values()][0];
    crawl.fill = { price: 0.1 };
    crawl.failing = { price: [`${origin}/site/product.html`] };
    const refresh = ui.getByTestId('pro-crawls').getByRole('button', { name: 'Refresh' });
    for (let i = 0; i < 3; i++) await refresh.click();
    await expect(ui.getByTestId('pro-crawl')).toContainText('needs repair');
    await expect(ui.getByTestId('pro-crawl-health')).toContainText('price: 67% when tested, 10% now');

    await ui.getByRole('banner').getByRole('button', { name: 'Back' }).click();
    await expect(ui.getByTestId('pro-recipe').filter({ hasText: 'Watched product' })).toContainText('needs repair');
    await ui.getByRole('button', { name: 'History of Watched product' }).click();

    // Repair: the editor names the field, opens a failing page and keeps it as a sample.
    await ui.getByRole('button', { name: 'Repair' }).click();
    const repair = ui.getByTestId('pro-repair');
    await expect(repair).toContainText('Repairing: price');
    await expect(repair).toContainText('price: 67% when tested, 10% on the live crawl.');
    await repair.getByRole('button', { name: 'Open a failing page' }).click();
    await expect(page).toHaveURL(`${origin}/site/product.html`);
    await expect(ui.getByTestId('pro-samples')).toContainText('Sample pages (4)');
    if (process.env.UX_SHOTS) await ui.screenshot({ path: `${process.env.UX_SHOTS}/pro-repair.png` });

    const price = ui.getByTestId('pro-field').filter({ has: ui.getByText('price', { exact: true }) });
    await price.getByLabel('Add a selector').fill('.product-price');
    await price.getByRole('button', { name: 'Add', exact: true }).click();
    await ui.getByLabel('What changed').fill('price on the new layout');
    await ui.getByRole('button', { name: 'Save version 2' }).click();
    await expect(ui.getByTestId('pro-version').first()).toContainText('repaired');
    mock.close();
    await ui.close();
    await page.close();
});

test('selectors: crawl usage labels each selector; Clean up saves a pruned version that keeps the ids', async ({ panel, ext, origin }) => {
    test.setTimeout(120_000);
    const mock = await serveMockBackend();
    const page = await ext.newPage();
    await page.goto(`${origin}/site/json-product.html`);
    const tabId = await panel.tabId(page.url());
    const ui = await ext.newPage();
    await ui.setViewportSize({ width: 400, height: 900 });
    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html?tabId=${tabId}`);
    await proClear(ui);
    await ui.reload();
    await ui.getByRole('button', { name: 'Backend' }).click();
    await ui.getByLabel('Address').fill(mock.origin);
    await ui.getByLabel('Access token').fill('dev-token');
    await ui.getByRole('button', { name: 'Save' }).click();

    const file = {
        name: 'Tracked product', site: '127.0.0.1', built_on: `${origin}/site/json-product.html`,
        checked_on: [`${origin}/site/json-shop.html`, `${origin}/site/article.html`],
        spec: { kind: 'page', settings: { requestDelay: 100 }, elements: [
            { id: 'a', name: 'title', action: 'extract', type: 'text', selectors: ['h1', '.product-title', '.old-title', '.sale-title'] },
        ] },
    };
    await ui.getByTestId('recipe-import').setInputFiles({ name: 't.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
    await ui.getByRole('button', { name: 'History of Tracked product' }).click();

    // Before a submit there is no usage: every selector is new.
    const selectors = ui.getByTestId('pro-selectors');
    await expect(selectors).toContainText('Usage comes from crawls once the recipe is submitted.');
    await expect(selectors.getByTestId('pro-way')).toHaveCount(4);
    await expect(selectors.getByText('new')).toHaveCount(4);
    await expect(selectors.getByRole('button', { name: 'Clean up' })).toBeDisabled();

    // Targeted, tested, approved by someone else and submitted.
    await ui.getByRole('button', { name: 'Edit targeting' }).click();
    await ui.getByLabel('Competitor').fill('acme');
    await ui.getByLabel('Page type').fill('product');
    await ui.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await ui.getByRole('button', { name: 'Edit fields' }).click();
    await ui.getByTestId('pro-samples').getByRole('button', { name: 'Test on 3 pages' }).click();
    await expect(ui.getByTestId('pro-readiness')).toHaveText('Ready to submit.', { timeout: 60_000 });
    await ui.getByRole('banner').getByRole('button', { name: 'Back' }).click();
    await ui.getByRole('banner').getByRole('button', { name: 'Back' }).click();
    await proSetName(ui, 'reviewer');
    await ui.getByRole('button', { name: 'History of Tracked product' }).click();
    await ui.getByRole('button', { name: 'Approve' }).click();
    await ui.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
    await ui.getByRole('button', { name: 'Submit' }).click();
    await ui.getByRole('dialog').getByRole('button', { name: 'Submit' }).click();
    await expect(ui.getByTestId('pro-crawl')).toBeVisible();

    // The workers report: h1 always wins, .product-title finds the title but never wins, .old-title and
    // .sale-title find nothing.
    const [v1] = await proStore(ui, 'versions');
    const [h1, product, old, sale] = v1.spec.steps[0].field.ways;
    const today = new Date().toISOString().slice(0, 10);
    const day = (wayId: string, matched: number, won: number) => ({ field: 'title', wayId, days: [{ date: today, tried: 120, matched, won }] });
    mock.backend.wayStats.set([...mock.backend.recipes.keys()][0], [day(h1.id, 120, 120), day(product.id, 110, 0), day(old.id, 0, 0), day(sale.id, 0, 0)]);
    await selectors.getByRole('button', { name: 'Refresh usage' }).click();
    const ways = selectors.getByTestId('pro-way');
    await expect(ways.nth(0)).toContainText('h1');
    await expect(ways.nth(0)).toContainText('won 120 of 120');
    await expect(ways.nth(0)).toContainText('active');
    await expect(ways.nth(1)).toContainText('won 0 of 120, found 110');
    await expect(ways.nth(1)).toContainText('dormant');
    await expect(ways.nth(2)).toContainText('dead');
    await expect(ways.nth(3)).toContainText('dead');

    // Clean up proposes removing both; .sale-title is kept, with why, and never proposed again.
    await selectors.getByRole('button', { name: 'Clean up' }).click();
    const proposal = ui.getByTestId('pro-cleanup');
    await expect(proposal.getByRole('listitem')).toHaveCount(2);
    await expect(ui.getByLabel('Version note')).toHaveValue('Clean up: 2 dead removed');
    await proposal.getByRole('listitem').filter({ hasText: '.sale-title' }).getByRole('button', { name: 'Keep' }).click();
    await ui.getByLabel('Why keep .sale-title').fill('only on sale pages, twice a year');
    await ui.getByRole('button', { name: 'Keep it' }).click();
    // .sale-title stays where it is: after .product-title, which finds the title.
    await expect(proposal.getByRole('listitem')).toHaveText(['Remove .old-title from title: tried and found nothing.Keep']);
    await expect(ui.getByLabel('Version note')).toHaveValue('Clean up: 1 dead removed');
    await ui.getByRole('dialog').getByRole('button', { name: 'Save v2' }).click();
    const v2row = ui.getByTestId('pro-version').first();
    await expect(v2row).toContainText('v2');
    await expect(v2row).toContainText('pruned');
    await expect(v2row).toContainText('needs review');
    await expect(selectors).toContainText('Selectors in v2');
    await expect(ways).toHaveCount(3);
    await expect(selectors.getByTestId('pro-way-kept')).toHaveText('Kept .sale-title in: only on sale pages, twice a year (reviewer)');
    await expect(selectors.getByRole('button', { name: 'Clean up' })).toBeDisabled();
    const v2 = (await proStore(ui, 'versions')).find(v => v.version === 2);
    expect(v2.spec.steps[0].field.ways.map((w: { id: string }) => w.id)).toEqual([h1.id, product.id, sale.id]);
    if (process.env.UX_SHOTS) await ui.screenshot({ path: `${process.env.UX_SHOTS}/pro-selectors.png`, fullPage: true });
    mock.close();
    await ui.close();
    await page.close();
});
