/**
 * Pro's Recipes screen in the built extension: it is the panel's home, the samples come in as version 1,
 * a re-import adds nothing, and a recipe exports as a format 2 file.
 */
import { readFileSync } from 'node:fs';
import { test, expect } from './harness';
import { proClear, proStore, serveMockBackend } from './pro';

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

    await ui.getByTestId('pro-version').first().getByRole('button', { name: 'Mark live' }).click();
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
    expect([...mock.backend.recipes.values()][0]).toMatchObject({ name: 'Submitted product', live: 1 });

    const refresh = ui.getByTestId('pro-crawls').getByRole('button', { name: 'Refresh' });
    await refresh.click();
    await expect(crawl).toContainText('queued');
    await refresh.click();
    await refresh.click();
    await expect(crawl).toContainText('done');
    await expect(crawl).toContainText('3 pages done · title 100%');
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
