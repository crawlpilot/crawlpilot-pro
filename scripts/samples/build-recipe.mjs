/**
 * Builds a product recipe with the extension itself, as a user does: Page Extractor → this page →
 * Smart detection (JSON attributes, named as the contract names them) → "Add a click" for each lazy
 * section, opened, then "Add field" on what it reveals → run. Writes the saved recipe, the run's rows
 * and the elements to <out>/<site>.*.json.
 * Usage: node build-recipe.mjs <site> <outDir>
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const require = createRequire(`${ROOT}/package.json`);
const { chromium } = require('playwright');

const SITES = {
    uniqlo: {
        url: 'https://www.uniqlo.com/in/en/products/E481040-000/00',
        more: ['https://www.uniqlo.com/in/en/products/E486125-000/00'],
        json: [
            ['brand.name', 'brand'], ['name', 'title'], ['description', 'description'], ['url', 'product_url'],
            ['productGroupID', 'product_code'], ['image', 'images'], ['hasVariant[*].offers.price', 'price', 'first'],
            ['hasVariant[*].color', 'color', 'first'], ['hasVariant[*].size', 'size', 'first'], ['material', 'composition'],
        ],
        steps: [
            { field: '#productFeatures-content p', keys: ['ArrowUp', 'ArrowUp', 'l'], name: 'highlights', type: 'text_array' },
            { click: '#productLongDescription' },
            { field: 'xpath=//*[@id="productLongDescription-content"]//p[contains(., "Product ID")]', name: 'product_id' },
            { field: 'xpath=//*[@id="productLongDescription-content"]//*[contains(., "Function details")]/following-sibling::*[1]', name: 'product_specifications' },
            { click: '#productMaterialDescription' },
            { field: 'xpath=//*[@id="productMaterialDescription-content"]//p[contains(., "wash")][last()]', name: 'care', type: 'text_array' },
            { click: '#productSustainabilityInfo' },
            { field: 'xpath=//*[@id="productSustainabilityInfo-content"]//p[starts-with(normalize-space(), "Production")]', name: 'origin' },
        ],
    },
    zara: {
        url: 'https://www.zara.com/in/en/straight-leg-jeans-p00774360.html',
        more: [],
        dismiss: '#onetrust-accept-btn-handler',
        json: [
            ['brand.name', 'brand'], ['name', 'title'], ['description', 'description'], ['url', 'product_url'],
            ['productGroupID', 'product_id'], ['image', 'images'], ['hasVariant[*].offers.price', 'price', 'first'],
            ['hasVariant[*].color', 'color', 'first'], ['hasVariant[*].size', 'size', 'first'],
            ['additionalProperty', 'product_specifications'], ['material', 'composition'],
        ],
        steps: [
            { field: '[data-qa-action="product-detail-info-color-copy"]', name: 'product_code' },
            { field: '.product-detail-description .expandable-text__inner-content p', name: 'highlights', type: 'text_array' },
            { click: '[data-qa-action="show-extra-detail"]', opens: '.product-detail-extra-detail' },
            { field: 'ul.structured-component-icon-list li span span', keys: ['ArrowUp', 'ArrowUp'], name: 'care', type: 'text_array' },
            { field: 'xpath=//div[contains(@class,"product-detail-extra-detail__section")][.//*[normalize-space()="ORIGIN"]]//*[starts-with(normalize-space(), "Made in")]', name: 'origin' },
        ],
    },
};

const [site, out] = process.argv.slice(2);
const cfg = SITES[site];
fs.mkdirSync(out, { recursive: true });
const log = (...a) => console.log(`[${site}]`, ...a);

const extension = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-ext-'));
fs.cpSync(`${ROOT}/dist`, extension, { recursive: true });
const manifest = JSON.parse(fs.readFileSync(`${extension}/manifest.json`, 'utf8'));
manifest.host_permissions = ['<all_urls>'];
fs.writeFileSync(`${extension}/manifest.json`, JSON.stringify(manifest));
const context = await chromium.launchPersistentContext(path.join(out, `${site}-profile`), {
    headless: false, viewport: { width: 1280, height: 900 }, locale: 'en-US',
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--window-position=-2400,0'],
});
const sw = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
const id = new URL(sw.url()).host;

const page = context.pages()[0] ?? await context.newPage();
await page.goto(cfg.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(5000);
if (cfg.dismiss) await page.locator(cfg.dismiss).click({ timeout: 5000 }).catch(() => log('no banner'));

const panel = await context.newPage();
await panel.goto(`chrome-extension://${id}/sidepanel.html`);
const tabId = await panel.evaluate(async u => (await chrome.tabs.query({})).find(t => t.url?.startsWith(u.split('?')[0]))?.id, page.url());
const ui = await context.newPage();
await ui.setViewportSize({ width: 420, height: 1000 });
await ui.goto(`chrome-extension://${id}/sidepanel.html?view=page-extractor&tabId=${tabId}`);
await ui.getByText('This page', { exact: true }).click();
await ui.getByRole('button', { name: 'Next: 1 page' }).click();
await ui.getByText('Pick the fields yourself').click();
await page.waitForTimeout(1500);
await page.waitForLoadState('load');
await page.waitForTimeout(4000);
if (cfg.dismiss) await page.locator(cfg.dismiss).click({ timeout: 3000 }).catch(() => undefined);

// 1. Smart detection: the JSON attributes, named as the contract names them.
await ui.getByTestId('smart-detection').click({ timeout: 30000 });
const dialog = ui.getByRole('dialog');
await dialog.getByLabel('All', { exact: true }).check();
await dialog.getByLabel('All', { exact: true }).uncheck();
for (const [key, name, mode] of cfg.json) {
    const box = dialog.getByLabel(`Extract ${key}`, { exact: true });
    if (!(await box.count())) { log('NOT FOUND in data:', key); continue; }
    await box.check();
    await dialog.getByLabel(`Column name for ${key}`, { exact: true }).fill(name);
    if (mode === 'first') await dialog.getByLabel(`How to read ${key}`).selectOption('first');
}
await ui.screenshot({ path: path.join(out, `${site}-smart.png`) });
await dialog.getByRole('button', { name: /^Add \d+ fields?$/ }).click();

// 2. Clicks that open lazy sections, and the fields they reveal, picked on the page.
const rows = () => ui.locator('.group.rounded-field');
async function hoverAndClick(target, keys) {
    const el = page.locator(target).first();
    await el.scrollIntoViewIfNeeded();
    const box = await el.boundingBox();
    if (!box) throw new Error(`${target} has no box`);
    const x = box.x + Math.min(box.width / 2, 30), y = box.y + Math.min(box.height / 2, 10);
    await page.mouse.move(x - 3, y - 3);
    await page.mouse.move(x, y);
    await page.waitForTimeout(300);
    if (!keys) { await page.mouse.click(x, y); return; }
    // Wider / read as a list with the picker's keys, as a user does, then select.
    for (const k of keys) { await page.keyboard.press(k); await page.waitForTimeout(250); }
    await page.keyboard.press('Enter');
}
for (const step of cfg.steps) {
    const before = await rows().count();
    await ui.getByRole('button', { name: step.click ? 'Add a click' : 'Add field', exact: true }).click();
    await page.waitForTimeout(500);
    try {
        await hoverAndClick(step.click ?? step.field, step.keys);
        await ui.waitForFunction(n => document.querySelectorAll('.group.rounded-field').length > n, before, { timeout: 15000 });
    } catch (e) {
        log('step failed', JSON.stringify(step), String(e).slice(0, 120));
        await ui.keyboard.press('Escape');
        continue;
    }
    if (step.click) {
        // The picker only recorded the click: open the section as a user would, to pick what it reveals.
        await page.waitForTimeout(1200);
        const btn = page.locator(step.click).first();
        const state = await btn.getAttribute('aria-expanded');
        if (state !== 'true' && !(step.opens && await page.locator(step.opens).first().isVisible())) await btn.click();
        await page.waitForTimeout(1500);
        log('click', step.click, 'expanded before:', state, 'after:', await btn.getAttribute('aria-expanded'));
        continue;
    }
    const last = rows().last();
    await last.getByRole('button', { name: 'Edit' }).click();
    await ui.getByLabel('Field name').fill(step.name);
    await ui.getByRole('button', { name: 'Save field' }).click();
    if (step.type) await rows().last().getByLabel('Type').selectOption(step.type);
    log('field', step.name, '=', (await rows().last().innerText()).replace(/\s+/g, ' ').slice(0, 140));
}
await ui.screenshot({ path: path.join(out, `${site}-fields.png`), fullPage: true });

// 3. Run on this page: the run saves the recipe.
await ui.getByRole('button', { name: 'Review & run' }).click();
await ui.getByRole('button', { name: 'Get 1 page' }).click();
await ui.getByRole('button', { name: 'Open the table' }).waitFor({ timeout: 120000 });

const store = n => panel.evaluate(name => new Promise((res, rej) => {
    const o = indexedDB.open('crawl-pilot');
    o.onsuccess = () => { const db = o.result; const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); };
}), n);
const recipes = await store('recipes');
const jobs = await store('jobs');
const tables = await store('tables');
const rowsAll = await store('rows');
const job = jobs.sort((a, b) => b.createdAt - a.createdAt)[0];
const recipe = recipes.find(r => r.id === job.recipeId);
const table = tables.find(t => t.id === job.tableId);
const data = rowsAll.filter(r => r.tableId === table.id).map(r => Object.fromEntries(table.columns.map(c => [c.name, r.data[c.id]])));
fs.writeFileSync(path.join(out, `${site}.recipe.json`), JSON.stringify(recipe, null, 2));
fs.writeFileSync(path.join(out, `${site}.rows.json`), JSON.stringify({ job: job.stats, rows: data }, null, 2));
log('recipe', recipe.name, 'elements', recipe.spec.elements.length, 'steps', JSON.stringify(job.stats.steps?.map(s => `${s.name}:${s.status ?? JSON.stringify(s)}`)));
await context.close();
