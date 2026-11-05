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
    await ui.getByRole('button', { name: 'Next: save' }).click();
    const step = ui.getByTestId('pro-save-version');
    await expect(step).toContainText('Local product: version 2');
    await expect(step).toContainText('Edited from version 1');
    await ui.getByRole('button', { name: 'Save version' }).click();
    await expect(ui.getByText('Nothing changed since the version this was edited from')).toBeVisible();

    // Back from saving is back at the fields: there is no pages step in a recipe session.
    await step.getByRole('button', { name: 'Back' }).click();
    await ui.getByRole('button', { name: 'Remove' }).first().click();
    await ui.getByRole('button', { name: 'Next: save' }).click();
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

    // v2 is not reviewed: it cannot be live yet, and says why. Someone other than its author approves it, named in
    // the dialog: the saved name stays the author's.
    const v2 = ui.getByTestId('pro-version').first();
    await expect(v2).toContainText('needs review');
    await expect(v2.getByRole('button', { name: 'Mark live' })).toBeDisabled();
    await expect(v2.getByTestId('pro-live-block')).toHaveText('Mark live: someone other than its author approves it first.');
    await v2.getByRole('button', { name: 'Approve' }).click();
    const reviewDialog = ui.getByRole('dialog');
    await expect(reviewDialog.getByLabel('Approved by')).toHaveValue('');
    await expect(reviewDialog.getByRole('button', { name: 'Approve' })).toBeDisabled();
    await reviewDialog.getByLabel('Approved by').fill('local');
    await expect(reviewDialog).toContainText('local wrote this version: someone else reviews it.');
    await expect(reviewDialog.getByRole('button', { name: 'Approve' })).toBeDisabled();
    await reviewDialog.getByLabel('Approved by').fill('reviewer');
    await ui.getByLabel('Note (optional)').fill('checked the grid');
    await reviewDialog.getByRole('button', { name: 'Approve' }).click();
    await expect(v2).toContainText('approved by reviewer');
    await expect(v2.getByTestId('pro-review-note')).toHaveText('reviewer: checked the grid');
    expect((await ui.evaluate(() => chrome.storage.local.get('pro.user')))['pro.user']).toBeUndefined();

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

    // What it is for first: the kind, the competitor and the page type, then picking.
    await ui.getByRole('button', { name: 'Build new' }).click();
    const form = ui.getByTestId('pro-new-recipe');
    await form.getByRole('radio', { name: 'List recipe' }).click();
    await expect(form.getByLabel('Page type')).toHaveValue('listing');
    await form.getByLabel('Competitor').fill('acme');
    await expect(form.getByLabel('Name')).toHaveValue('acme listing');
    await form.getByRole('button', { name: 'Pick it on this page' }).click();
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
    expect((await proStore(ui, 'recipes'))[0]).toMatchObject({ name: 'Local list', competitor: 'acme', pageType: 'listing' });
    expect(version.spec.lists[0].fields.length).toBeGreaterThan(0);

    await ui.getByRole('button', { name: 'Back to recipes' }).click();
    await ui.getByRole('button', { name: 'Edit Local list' }).click();
    await expect(ui.getByText("A list recipe's rows are edited by picking the list again.")).toBeVisible();
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
    // Ways and cleanup are folded under the name, type and value most edits need.
    await expect(title.getByLabel('Add a selector')).toBeHidden();
    await title.getByRole('button', { name: /^Ways and cleanup/ }).click();
    await title.getByLabel('Add a selector').fill('h1.product-title');
    await title.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(title).toContainText('h1.product-title');

    const specs = ui.getByTestId('pro-field').nth(1);
    await specs.getByRole('button').first().click();
    await specs.getByLabel('Type').selectOption('object');
    await specs.getByRole('button', { name: /^Ways and cleanup/ }).click();
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
    await ui.getByRole('button', { name: 'Next: save' }).click();
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
        await card(name).getByRole('button', { name: /^Ways and cleanup/ }).click();
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
    await ui.getByRole('button', { name: 'Next: save' }).click();
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

test('page rules: Check names the rule that held, and an error page is kept as a sample that should hit it', async ({ panel, ext, origin }) => {
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
    ] } };
    await ui.getByTestId('recipe-import').setInputFiles({ name: 'o.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });

    // A rule for a product that is gone, added in the editor.
    await ui.getByRole('button', { name: 'Edit Overshirt' }).click();
    await ui.getByRole('button', { name: /^Page rules/ }).click();
    const rules = ui.getByTestId('pro-page-rules');
    await rules.getByRole('button', { name: 'Add a rule' }).click();
    await rules.getByLabel('Name of rule 1').fill('Gone');
    await rules.getByLabel('Status of Gone').selectOption('unavailable');
    // The new rule opens on one test of the visible text.
    await expect(rules.getByLabel('Condition 1 looks at')).toHaveValue('text');
    await rules.getByLabel('Condition 1 looks for').fill('no longer available');
    await expect(rules.getByTestId('pro-condition-sentence')).toHaveText('Holds when the visible text has "no longer available".');
    // A second test, the group made "none of these", then back to one test: the sentence follows.
    await rules.getByRole('button', { name: 'Condition', exact: true }).click();
    await rules.getByLabel('Condition 2 looks at').selectOption('css');
    await rules.getByLabel('Condition 2 looks for').fill('p.price');
    await rules.getByLabel('Holds when').selectOption('none');
    await expect(rules.getByTestId('pro-condition-sentence')).toHaveText('Holds when none of: the visible text has "no longer available"; "p.price" is on the page.');
    if (process.env.UX_SHOTS) await rules.screenshot({ path: `${process.env.UX_SHOTS}/pro-page-rules.png` });
    await rules.getByRole('button', { name: 'Remove condition 2' }).click();
    await rules.getByLabel('Holds when').selectOption('all');
    await rules.getByRole('button', { name: 'Done' }).click();
    await expect(rules.getByTestId('pro-rule-sentence')).toHaveText('When the visible text has "no longer available"');
    // A way tried only when the page shows a price.
    const price = ui.getByTestId('pro-field').nth(1);
    await price.getByRole('button').first().click();
    await price.getByRole('button', { name: /^Ways and cleanup/ }).click();
    await price.getByRole('button', { name: 'Options of way 1' }).click();
    await price.getByRole('button', { name: 'Only try it when…' }).click();
    await price.getByLabel('Condition 1 looks for').fill('$');
    await expect(price.getByTestId('pro-condition-sentence')).toHaveText('Holds when the visible text has "$".');
    await ui.getByLabel('What changed').fill('gone rule');
    await ui.getByRole('button', { name: 'Save version 2' }).click();
    await expect(ui.getByTestId('pro-version')).toHaveCount(2);
    const [v2] = (await proStore(ui, 'versions')).filter(v => v.version === 2);
    expect(v2.spec.rules).toEqual([{ name: 'Gone', status: 'unavailable', when: { kind: 'regex', in: 'text', pattern: 'no longer available', flags: 'i', op: 'gt', value: 0 } }]);
    expect(v2.spec.steps[1].field.ways[0].when).toEqual({ kind: 'regex', in: 'text', pattern: '\\$', flags: 'i', op: 'gt', value: 0 });

    // On a gone product, Check says which rule held instead of "0 of 0 fields".
    await page.goto(`${origin}/site/gone-product.html`);
    await ui.getByRole('banner').getByRole('button', { name: 'Check', exact: true }).click();
    await ui.getByRole('button', { name: 'Check this page' }).click();
    const outcome = ui.getByTestId('pro-check-outcome');
    await expect(outcome).toContainText('Page rule "Gone" held: Unavailable');
    await expect(outcome).toContainText('the recipe says this is not a page to read');
    await expect(ui.getByTestId('pro-check-table')).toHaveCount(0);
    const items = ui.getByTestId('pro-check-item');
    await expect(items.nth(0)).toContainText('Page rule "Gone" held');

    // Kept as a sample that should hit it: now as it should be.
    await outcome.getByRole('button', { name: 'Keep as a sample that should hit "Gone"' }).click();
    await expect(outcome).toContainText('As this sample expects');
    await expect(ui.getByTestId('pro-check-kept')).toContainText('should hit "Gone"');
    expect((await proStore(ui, 'samples')).find(s => s.url === page.url())).toMatchObject({ expectRule: 'Gone' });

    // On the samples: the gone page passes by its rule and is not one of the pages read.
    await ui.getByRole('button', { name: 'Check 2 sample pages' }).click();
    const outcomes = ui.getByTestId('pro-grid-outcome');
    await expect(outcomes).toHaveCount(1, { timeout: 30_000 });
    await expect(outcomes.first()).toContainText('gone-product.html: Page rule "Gone" held: Unavailable. As this sample expects.');
    await expect(items.nth(1)).toContainText('Tested on 1 page; it needs 3.');
    await expect(items.nth(1)).not.toContainText('Gone');
    if (process.env.UX_SHOTS) await ui.screenshot({ path: `${process.env.UX_SHOTS}/pro-check-rule.png` });

    // In the editor, the sample says what it should be, and can go back to a page to read.
    await ui.getByRole('button', { name: 'Edit fields' }).click();
    await expect(ui.getByLabel('Sample 2 should be')).toHaveValue('Gone');
    await ui.getByLabel('Sample 2 should be').selectOption('');
    await expect.poll(async () => (await proStore(ui, 'samples')).find(s => s.url === page.url())?.expectRule).toBeUndefined();
    await ui.close();
    await page.close();
});

test('value checks: a price above its range is a problem on Check, and the diff names the check', async ({ panel, ext, origin }) => {
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
    ] } };
    await ui.getByTestId('recipe-import').setInputFiles({ name: 'o.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });

    await ui.getByRole('button', { name: 'Edit Overshirt' }).click();
    const price = ui.getByTestId('pro-field').nth(1);
    await price.getByRole('button').first().click();
    await price.getByLabel('Type').selectOption('money');
    await price.getByRole('button', { name: /^Value checks/ }).click();
    await price.getByLabel('Add a check').selectOption('range');
    await price.getByLabel('Check 1 at least').fill('1');
    await price.getByLabel('Check 1 at most').fill('50');
    await expect(price.getByTestId('pro-value-check-sentence')).toHaveText('Must be between 1 and 50');
    // A comparison offers the other fields.
    await price.getByLabel('Add a check').selectOption('compare');
    await expect(price.getByLabel('Check 2 other field')).toHaveValue('title');
    await price.getByRole('button', { name: 'Remove check 2' }).click();
    if (process.env.UX_SHOTS) await price.screenshot({ path: `${process.env.UX_SHOTS}/pro-value-checks.png` });
    await ui.getByLabel('What changed').fill('price range');
    await ui.getByRole('button', { name: 'Save version 2' }).click();
    await expect(ui.getByTestId('pro-diff')).toContainText('check added: between 1 and 50');

    await ui.getByRole('banner').getByRole('button', { name: 'Check', exact: true }).click();
    await ui.getByRole('button', { name: 'Check this page' }).click();
    const row = ui.getByTestId('pro-check-row').filter({ has: ui.getByText('price', { exact: true }) });
    await expect(row).toContainText('✗ above 50');
    await expect(ui.getByTestId('pro-check-item').first()).toContainText('1 with a problem');
    await ui.close();
    await page.close();
});

test('atlas import: a condition it cannot carry over is listed at once and marked "never holds" in the editor', async ({ panel }) => {
    const ui = panel.page;
    await ui.setViewportSize({ width: 400, height: 1000 });
    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html`);
    await proClear(ui);
    await ui.reload();
    const tpl = (t: Record<string, unknown>) => ({ extractMethodType: 'CSS_SLCTR', specialFormatting: '.*', asserts: [], assrtXprn: null, ...t });
    const atlas = { responseObj: { competitorShortName: 'SHOP', elements: [],
        attributes: [{ name: 'TITLE', type: 'A', templates: [tpl({ extractMethod: 'h1' })] }],
        errorPages: [
            { name: '404', templates: [tpl({ asserts: [{ assrtId: 1, type: 'REGEX_CNT', assrt: 'Not Found', assrtFnct: 'GREATER_THAN', assrtValue: '0' }], assrtXprn: 'NOT ASSERT1' })] },
            { name: 'CAPTCHA', templates: [tpl({ asserts: [{ assrtId: 1, type: 'CSS_SLCTR_CNT', assrt: '#captcha', assrtFnct: 'ROUGHLY', assrtValue: '1' }], assrtXprn: 'ASSERT1' })] },
        ] } };
    await ui.getByTestId('recipe-import').setInputFiles({ name: 'shop.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(atlas)) });
    const message = ui.getByTestId('pro-import-message');
    await expect(message).toContainText('1 condition that never holds');
    await expect(ui.getByTestId('pro-import-notes')).toContainText('assert function "ROUGHLY" is unknown; it never holds.');

    await ui.getByRole('button', { name: /^Edit / }).first().click();
    await ui.getByRole('button', { name: /^Page rules/ }).click();
    const rules = ui.getByTestId('pro-page-rule');
    await expect(rules).toHaveCount(2);
    // NOT carried over as "none of these"; the unknown function as a rule that never holds.
    await expect(rules.nth(0).getByTestId('pro-rule-sentence')).toHaveText('When none of: the HTML source has "Not Found"');
    await expect(rules.nth(0)).not.toContainText('never holds');
    await expect(rules.nth(1)).toContainText('never holds');
    await rules.nth(1).getByRole('button', { name: 'Edit condition' }).click();
    await expect(rules.nth(1).getByTestId('pro-condition-empty')).toContainText('An empty group never holds');
});

test('list rules: a list recipe\'s page rules are edited in Pro and saved as the next version', async ({ panel }) => {
    const ui = panel.page;
    await ui.setViewportSize({ width: 400, height: 1000 });
    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html`);
    await proClear(ui);
    await ui.reload();
    const file = { name: 'Lamp search', site: 'shop.test', built_on: 'https://shop.test/search?q=lamp', spec: { kind: 'list', pagination: { mode: 'auto' },
        lists: [{ id: 'L', container: ['#results'], items: ['li'], mode: 'list', fields: [{ id: 't', name: 'title', type: 'text', selector: 'h3' }] }] } };
    await ui.getByTestId('recipe-import').setInputFiles({ name: 'list.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });

    await ui.getByRole('button', { name: 'Edit Lamp search' }).click();
    await expect(ui.getByText('A list recipe\'s rows are edited by picking the list again.')).toBeVisible();
    const rules = ui.getByTestId('pro-page-rules');
    await rules.getByRole('button', { name: 'Add a rule' }).click();
    await rules.getByLabel('Name of rule 1').fill('No results');
    await rules.getByLabel('Condition 1 looks for').fill('No lamps match');
    await expect(ui.getByTestId('pro-editor-changes')).toHaveText('1 change: page rule No results');
    await ui.getByLabel('What changed').fill('empty search');
    await ui.getByRole('button', { name: 'Save version 2' }).click();
    await expect(ui.getByTestId('pro-diff')).toContainText('page rule No results');
    const [v2] = (await proStore(ui, 'versions')).filter(v => v.version === 2);
    expect(v2.spec.rules).toEqual([{ name: 'No results', status: 'not_found', when: { kind: 'regex', in: 'text', pattern: 'No lamps match', flags: 'i', op: 'gt', value: 0 } }]);
});

test('retailer recipes: the Amazon and Walmart files import with their targeting, setup, rules and checks', async ({ panel }) => {
    const ui = panel.page;
    await ui.setViewportSize({ width: 400, height: 1000 });
    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html`);
    await proClear(ui);
    await ui.reload();
    const files = ['amazon-product', 'walmart-product'].map(n => ({ name: `${n}.crawlpilot.json`, mimeType: 'application/json', buffer: readFileSync(`recipes/${n}.crawlpilot.json`) }));
    await ui.getByTestId('recipe-import').setInputFiles(files);
    await expect(ui.getByTestId('pro-import-message')).toContainText('Amazon product page: 1 version added');
    await expect(ui.getByTestId('pro-import-message')).toContainText('Walmart product page: 1 version added');
    const recipes = await proStore(ui, 'recipes');
    expect(recipes.map(r => [r.competitor, r.pageType]).sort()).toEqual([['amazon', 'product'], ['walmart', 'product']]);

    await ui.getByRole('button', { name: 'Edit Walmart product page' }).click();
    await ui.getByRole('button', { name: /^Page rules/ }).click();
    await expect(ui.getByTestId('pro-page-rule')).toHaveCount(5);
    await expect(ui.getByTestId('pro-page-rule').nth(3).getByTestId('pro-rule-sentence')).toHaveText('When the URL has "/account/login"');
    const sku = ui.getByTestId('pro-field').filter({ has: ui.getByText('SKU', { exact: true }) });
    await expect(sku).toContainText('1 check');
    await expect(ui.getByTestId('pro-editor-changes')).toHaveText('No changes yet.');
});

test('page data and JOLT: a field added from the page\'s JSON, the record shaped by a transform, shown on Check', async ({ panel, ext, origin }) => {
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
        { id: 'b', name: 'price', action: 'extract', type: 'text', selectors: ['p.price'] },
    ] } };
    await ui.getByTestId('recipe-import').setInputFiles({ name: 'o.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
    await ui.getByRole('button', { name: 'Edit Overshirt' }).click();

    // A field from the page's JSON-LD, found by its value.
    const add = ui.getByTestId('pro-add-data-field');
    await add.getByRole('button', { name: 'Add a field from the page\'s data' }).click();
    await add.getByLabel('Find in the page\'s data').fill('LX-2041');
    const entry = add.getByTestId('pro-page-data-entry').filter({ hasText: 'productGroupID' });
    await expect(entry).toHaveCount(1);
    await expect(entry).toContainText('JSON-LD');
    await entry.click();
    await expect(ui.getByTestId('pro-field')).toHaveCount(3);
    await expect(ui.getByTestId('pro-field').nth(2)).toContainText('product_group_id');

    // A transform: started from the fields, then shaped.
    const transform = ui.getByTestId('pro-transform-section');
    await transform.getByRole('button', { name: /^Transform \(JOLT\)/ }).click();
    await transform.getByRole('button', { name: 'Start from the fields' }).click();
    const jolt = transform.getByLabel('JOLT spec (JSON: one operation or a list)');
    await expect(jolt).toHaveValue(/"product_group_id": "product_group_id"/);
    await jolt.fill('not json');
    await expect(transform).toContainText('Not JSON');
    await expect(ui.getByRole('button', { name: 'Save version 2' })).toBeDisabled();
    await jolt.fill(JSON.stringify([
        { operation: 'shift', spec: { title: 'product.name', price: 'offer.price', product_group_id: 'product.id', '#overshirt': 'source' } },
        { operation: 'modify-overwrite-beta', spec: { product: { name: '=toUpper' } } },
    ]));
    await ui.getByRole('button', { name: 'Test on this page' }).click();
    const output = transform.getByTestId('pro-transform-output');
    await expect(output).toContainText('"name": "LINEN OVERSHIRT"');
    await expect(output).toContainText('"id": "LX-2041"');
    if (process.env.UX_SHOTS) await transform.screenshot({ path: `${process.env.UX_SHOTS}/pro-transform.png` });
    await ui.getByLabel('What changed').fill('group id and a transform');
    await ui.getByRole('button', { name: 'Save version 2' }).click();
    const diff = ui.getByTestId('pro-diff');
    await expect(diff).toContainText('product_group_id');
    await expect(diff).toContainText('JOLT none → shift, modify-overwrite-beta');

    // Check shows the record as the crawler will write it.
    await ui.getByRole('banner').getByRole('button', { name: 'Check', exact: true }).click();
    await ui.getByRole('button', { name: 'Check this page' }).click();
    const record = ui.getByTestId('pro-check-record');
    await expect(record).toContainText('"source": "overshirt"');
    await expect(record).toContainText('"price": "$79.00"');
    await ui.close();
    await page.close();
});

test('page data on Walmart: its JSON specifications become one name → value field, rows offered too', async ({ panel, ext, origin }) => {
    const page = await ext.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/corpus/pdp-walmart`);
    const tabId = await panel.tabId(page.url());
    await panel.toTab(tabId, 'PING');
    const ui = await ext.newPage();
    await ui.setViewportSize({ width: 400, height: 1100 });
    await ui.goto(`chrome-extension://${panel.extensionId}/sidepanel.html?tabId=${tabId}`);
    await proClear(ui);
    await ui.reload();
    const file = { name: 'Grill', site: 'walmart.com', built_on: page.url(), spec: { kind: 'page', settings: {}, elements: [
        { id: 'a', name: 'title', action: 'extract', type: 'text', selectors: ['h1'] },
    ] } };
    await ui.getByTestId('recipe-import').setInputFiles({ name: 'g.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
    await ui.getByRole('button', { name: 'Edit Grill' }).click();

    const add = ui.getByTestId('pro-add-data-field');
    await add.getByRole('button', { name: 'Add a field from the page\'s data' }).click();
    await add.getByLabel('Find in the page\'s data').fill('Fuel type');
    const specs = add.getByTestId('pro-page-data-entry').filter({ hasText: 'idml.specifications' }).filter({ hasText: 'name → value' });
    await expect(specs).toHaveCount(1);
    await expect(specs).toContainText('Fuel type: Propane');
    await expect(add.getByTestId('pro-page-data-entry').filter({ hasText: 'idml.specifications' }).filter({ hasText: 'rows' })).toHaveCount(1);
    if (process.env.UX_SHOTS) await add.screenshot({ path: `${process.env.UX_SHOTS}/pro-page-data-specs.png` });
    await specs.click();
    const field = ui.getByTestId('pro-field').filter({ hasText: 'specifications' });
    await expect(field).toContainText('object');

    await ui.getByRole('button', { name: 'Test on this page' }).click();
    await expect(ui.getByTestId('pro-test-summary')).toContainText('2 of 2 fields found');
    await field.getByRole('button').first().click();
    await expect(field.getByTestId('pro-field-result')).toContainText('"Fuel type":"Propane"');
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
    const form = ui.getByTestId('pro-new-recipe');
    await form.getByLabel('Competitor').fill('acme');
    await form.getByRole('button', { name: 'Pick it on this page' }).click();
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
    await ui.getByRole('button', { name: 'Next: save' }).click();

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
    // Cleanup, Pro's steps included: a Lua script, shown on the value just picked.
    const cleanup = fields.nth(0).getByTestId('pro-save-cleanup');
    await cleanup.getByRole('button', { name: /^Cleanup · none/ }).click();
    await cleanup.getByLabel('Add a step').selectOption('lua');
    await cleanup.getByLabel(/^Lua: the value is str/).fill('return string.upper(str)');
    await expect(cleanup.getByTestId('pro-cleaned-value')).toHaveText('On the picked value → LINEN OVERSHIRT');
    await expect(cleanup).toContainText('Cleanup · 1 step → LINEN OVERSHIRT');
    if (process.env.UX_SHOTS) await fields.nth(0).screenshot({ path: `${process.env.UX_SHOTS}/pro-save-cleanup.png` });
    await expect(ui.getByTestId('pro-save-version')).toContainText('For acme · product');
    await expect(ui.getByLabel('Recipe name')).toHaveValue('acme product');
    await ui.getByRole('button', { name: 'Save version' }).click();
    await expect(ui.getByRole('button', { name: 'Check it on this page' })).toBeVisible();
    // Saved with what it is for: the recipe is not "needed to submit: set the competitor".
    expect((await proStore(ui, 'recipes'))[0]).toMatchObject({ name: 'acme product', competitor: 'acme', pageType: 'product' });
    expect((await proStore(ui, 'samples')).map((x: any) => x.url)).toEqual([page.url()]);
    const [v1] = await proStore(ui, 'versions');
    expect(v1.spec.steps.map((s: any) => [s.field.name, s.field.type])).toEqual([['product_name', 'text'], ['price', 'money']]);
    expect(v1.spec.steps[0].field.ops).toEqual([{ op: 'lua', code: 'return string.upper(str)' }]);
    expect(v1.spec.steps[1].field.ops).toEqual([]);
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
