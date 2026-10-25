/**
 * Runs a recipe built by build-recipe.mjs on other product pages of its site (links on the start page
 * matching the pattern), with the extension, and prints each page's record.
 * Usage: node scripts/samples/validate-recipe.mjs <site> <outDir> <link pattern> <how many> <start url>
 */
import { createRequire } from 'node:module';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const require = createRequire(`${ROOT}/package.json`);
const { chromium } = require('playwright');
const [site, out, pattern, n = '3'] = process.argv.slice(2);
const recipe = JSON.parse(fs.readFileSync(path.join(out, `${site}.recipe.json`), 'utf8'));
const extension = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-ext-'));
fs.cpSync(`${ROOT}/dist`, extension, { recursive: true });
const m = JSON.parse(fs.readFileSync(`${extension}/manifest.json`, 'utf8')); m.host_permissions = ['<all_urls>']; fs.writeFileSync(`${extension}/manifest.json`, JSON.stringify(m));
const context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'cp-prof-')), { headless: false, viewport: { width: 1280, height: 900 }, locale: 'en-US', args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--window-position=-2400,0'] });
const sw = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
const id = new URL(sw.url()).host;
const page = context.pages()[0];
const start = recipe.spec.settings?.urls?.[0] ?? process.argv[6];
await page.goto(process.argv[6], { waitUntil: 'domcontentloaded', timeout: 60000 }); await page.waitForTimeout(6000);
await page.mouse.wheel(0, 3000); await page.waitForTimeout(2500);
const urls = [...new Set(await page.$$eval('a[href]', (as, p) => as.map(a => a.href.split('?')[0].split('#')[0]).filter(h => new RegExp(p).test(h)), pattern))].filter(u => u !== process.argv[6].split('?')[0]).slice(0, Number(n));
console.log('urls', urls);
const panel = await context.newPage(); await panel.goto(`chrome-extension://${id}/sidepanel.html`);
await panel.evaluate(() => { window.__inbox = []; chrome.runtime.onMessage.addListener(m => { window.__inbox.push(m); }); });
const elements = recipe.spec.elements.map(e => ({ ...e, selectors: e.selectors ?? [] }));
const res = await panel.evaluate(([urls, elements]) => chrome.runtime.sendMessage({ type: 'BULK_EXTRACTION_START', payload: { urls, elements, config: { requestDelay: 1500, listOutput: 'nested' }, maxConcurrent: 2, customName: 'validate' } }), [urls, elements]);
console.log('start', JSON.stringify(res));
await panel.waitForFunction(() => window.__inbox.some(m => m.type === 'BULK_EXTRACTION_COMPLETE'), null, { timeout: 240000 });
const done = await panel.evaluate(() => window.__inbox.find(m => m.type === 'BULK_EXTRACTION_COMPLETE').payload);
const store = n => panel.evaluate(name => new Promise(res => { const o = indexedDB.open('crawl-pilot'); o.onsuccess = () => { const r = o.result.transaction(name).objectStore(name).getAll(); r.onsuccess = () => res(r.result); }; }), n);
const table = (await store('tables')).find(t => t.id === done.tableId);
const rows = (await store('rows')).filter(r => r.tableId === table.id).map(r => Object.fromEntries(table.columns.map(c => [c.name, r.data[c.id]])));
const job = (await store('jobs')).find(j => j.id === done.jobId);
fs.writeFileSync(path.join(out, `${site}.validate.json`), JSON.stringify({ urls, steps: job.stats.steps, rows }, null, 2));
for (const r of rows) { console.log('--', r['Source URL']); for (const [k, v] of Object.entries(r)) if (!['Source URL', 'Record ID'].includes(k)) console.log('   ', k.padEnd(24), JSON.stringify(v)?.slice(0, 110)); }
await context.close();
